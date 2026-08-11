// services/state/StateManager.js
// ============================================================================
// GESTIONNAIRE D'ÉTAT DISTRIBUÉ (Redis + Supabase)
// ============================================================================
//
// ARCHITECTURE:
// ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
// │   BotCore   │ --> │ StateManager │ --> │    Redis    │ (Cache rapide)
// └─────────────┘     └─────────────┘     └─────────────┘
//                            │                    │
//                            │  (Sync Worker)     │
//                            ▼                    ▼
//                     ┌─────────────┐     ┌─────────────┐
//                     │  Supabase   │ <-- │ Dirty Queue │
//                     └─────────────┘     └─────────────┘
//
// PRINCIPE:
// - Toutes les écritures vont d'abord dans Redis (rapide, <1ms)
// - Un worker périodique synchronise les données modifiées vers Supabase
// - Les lectures utilisent Redis en cache-first (fallback Supabase si miss)
//
// AVANTAGES:
// - Performance: ~1ms vs ~200ms pour Supabase direct
// - Résilience: Données tamponnées même si Supabase est down temporairement
// - Économie: Moins d'appels DB, batch upserts groupés
//
// ============================================================================

import { redis } from '../redisClient.js';
import dbClient, { supabase } from '../supabase.js';
import { LockManager } from './LockManager.js';
import { IdentityMap } from './IdentityMap.js';

// Verrou pour éviter les races conditions lors du chargement initial
const userLock = new LockManager('user');

// Clé Redis pour la queue de synchronisation (Set pour dédupliquer)
const SYNC_QUEUE_KEY = 'queue:sync:users';

interface UserData {
  id?: string;
  jid: string;
  names: string[];
  interaction_count: number;
  last_seen?: number;
  last_pushname?: string;
  username?: string;
  language?: string | null;
  timezone?: string | null;
  updated_at?: string;
}

interface SyncUpdate {
  id: string;
  username: string;
  interaction_count: number;
  language: string | null;
  timezone: string | null;
  updated_at: string;
}

interface LeaderboardEntry {
  value: string;
  score: number;
}

/**
 * Gestionnaire d'état centralisé pour les données utilisateur
 * Implémente le pattern "Write-Behind Cache"
 */
export const StateManager = {
  /**
   * Récupère un profil utilisateur complet et sûr
   */
  async getUser(identifier: string): Promise<UserData> {
    const jid = await IdentityMap.resolve(identifier);
    const resolved = await dbClient.resolveContextFromLegacyId(jid);

    if (!resolved || resolved.type !== 'user') {
      return { jid, names: ['Inconnu'], interaction_count: 0 };
    }

    const uuid = resolved.context_id;
    const cacheKey = `user:${uuid}:data`;

    // 1. Lecture Cache
    let userData: Record<string, string> | null = (await redis?.hGetAll(cacheKey)) ?? null;

    // 2. Cache Miss: Lecture DB + Hydratation
    if (!userData || Object.keys(userData).length === 0) {
      // Verrouillage pour éviter "Thundering Herd" si 50 messages arrivent en même temps
      const lockId = await userLock.acquireWait(uuid);
      if (!lockId) {
        // Fallback si lock fail: retour mininal
        return { jid, id: uuid, names: ['Inconnu'], interaction_count: 0 };
      }

      try {
        // Double check après lock
        userData = (await redis?.hGetAll(cacheKey)) ?? null;
        if (!userData || Object.keys(userData).length === 0) {
          if (supabase) {
            const { data } = await supabase.from('users').select('*').eq('id', uuid).single();
            if (data) {
              userData = this._flattenForRedis(data);
              await redis?.hSet(cacheKey, userData);
              await redis?.expire(cacheKey, 86400); // 24h
            }
          }
        }
      } finally {
        await userLock.release(uuid, lockId);
      }
    }

    const unflattened = this._unflattenFromRedis(userData);
    return {
      jid,
      id: uuid,
      names: unflattened.names ?? ['Inconnu'],
      interaction_count: unflattened.interaction_count ?? 0,
      ...unflattened,
    };
  },

  /**
   * Met à jour l'utilisateur (Atomique & Persistent)
   */
  async updateUserInteraction(identifier: string, pushName: string | null): Promise<void> {
    const jid = await IdentityMap.resolve(identifier);
    const resolved = await dbClient.resolveContextFromLegacyId(jid);
    if (!resolved || resolved.type !== 'user') return;

    const uuid = resolved.context_id;
    const cacheKey = `user:${uuid}:data`;

    if (!redis?.isOpen) return; // Fail safe

    // Pas besoin de lock global pour HINCRBY (c'est atomique dans Redis)
    const pipeline = redis.multi();

    // 1. Mise à jour atomique du compteur
    pipeline.hIncrBy(cacheKey, 'interaction_count', 1);
    pipeline.hSet(cacheKey, 'last_seen', Date.now());

    // 2. Mise à jour conditionnelle du nom
    if (pushName) {
      pipeline.hSet(cacheKey, 'last_pushname', pushName);
      // On ne touche pas username ici, c'est pour l'enregistrement initial ou explicite
    }

    // 3. Reset TTL
    pipeline.expire(cacheKey, 86400);

    // 4. Ajouter à la "Dirty Queue" (Set pour éviter doublons)
    // Ceci remplace le buffer RAM. On stocke le UUID.
    pipeline.sAdd(SYNC_QUEUE_KEY, uuid);

    await pipeline.exec();
  },

  /**
   * Met à jour les préférences de l'utilisateur (Langue, TZ)
   */
  async updatePreferences(
    identifier: string,
    preferences: { language?: string; timezone?: string },
  ): Promise<void> {
    const jid = await IdentityMap.resolve(identifier);
    const resolved = await dbClient.resolveContextFromLegacyId(jid);
    if (!resolved || resolved.type !== 'user') return;

    const uuid = resolved.context_id;
    const cacheKey = `user:${uuid}:data`;

    if (!redis?.isOpen) return;

    const pipeline = redis.multi();
    if (preferences.language) pipeline.hSet(cacheKey, 'language', preferences.language);
    if (preferences.timezone) pipeline.hSet(cacheKey, 'timezone', preferences.timezone);

    pipeline.sAdd(SYNC_QUEUE_KEY, uuid);
    await pipeline.exec();
  },

  /**
   * Worker de synchronisation (à appeler périodiquement)
   * Vide la queue Redis vers Supabase
   */
  async processSyncQueue(batchSize: number = 50): Promise<void> {
    if (!redis?.isOpen) return;

    // 1. Récupérer N items de la queue (ce sont des UUIDs maintenant)
    const uuids = await redis.sPop(SYNC_QUEUE_KEY, batchSize);
    if (!uuids || uuids.length === 0) return;

    console.log(`[StateManager] Syncing ${uuids.length} users to DB...`);

    const updates: SyncUpdate[] = [];

    // 2. Construire le batch
    const pipeline = redis.multi();
    uuids.forEach((uuid: string) => pipeline.hGetAll(`user:${uuid}:data`));
    const results = await pipeline.exec();

    for (let i = 0; i < uuids.length; i++) {
      const data = results.at(i) as unknown as Record<string, string> | null;
      const uuid = uuids.at(i);

      if (data && uuid && Object.keys(data).length > 0) {
        updates.push({
          id: uuid,
          username: data.last_pushname || 'Inconnu', // Legacy logic
          interaction_count: parseInt(data.interaction_count || '0', 10),
          language: data.language || null,
          timezone: data.timezone || null,
          updated_at: new Date().toISOString(),
        });
      }
    }

    // 3. Batch Upsert Supabase (onConflict: 'id')
    if (updates.length > 0 && supabase) {
      const { error } = await supabase.from('users').upsert(updates, { onConflict: 'id' });
      if (error) {
        console.error('[StateManager] Sync Error:', error);
        // ROLLBACK: Remettre les UUIDs dans la queue pour réessayer
        await redis.sAdd(SYNC_QUEUE_KEY, uuids);
      }
    }
  },

  // Helpers privés pour gérer les types Redis (tout est string)
  _flattenForRedis(obj: Record<string, unknown>): Record<string, string> {
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== null && v !== undefined) Reflect.set(flat, k, String(v));
    }
    return flat;
  },
  _unflattenFromRedis(obj: Record<string, string> | null): Partial<UserData> {
    if (!obj) return {};
    const result: Partial<UserData> = {
      ...obj,
      interaction_count: parseInt(obj.interaction_count || '0', 10),
      // ajouter d'autres conversions de type si nécessaire
    };
    // Conversion last_seen si num
    if (obj.last_seen && !isNaN(Number(obj.last_seen))) {
      result.last_seen = parseInt(obj.last_seen, 10);
    }
    return result;
  },
  /**
   * Incrémente l'activité d'un utilisateur DANS un groupe spécifique
   * Utilise Redis ZSET pour gérer le classement automatiquement
   */
  async recordGroupActivity(groupJid: string, userJid: string): Promise<void> {
    const key = `group:${groupJid}:leaderboard`;

    // ZINCRBY : Incrémente le score de l'utilisateur de 1.
    // Si l'utilisateur n'existe pas, il est ajouté avec score 1.
    // Complexité : O(log(N)) -> Extrêmement rapide même avec 1000 membres
    await redis.zIncrBy(key, 1, userJid);

    // Optionnel : Expirer le classement après 30 jours d'inactivité du groupe
    await redis.expire(key, 86400 * 30);
  },

  /**
   * Récupère le classement (Top Talkers)
   */
  async getGroupLeaderboard(groupJid: string, limit: number = 10): Promise<LeaderboardEntry[]> {
    const key = `group:${groupJid}:leaderboard`;

    // ZREVRANGE : Récupère les membres triés du plus grand au plus petit score
    // WITHSCORES : Retourne aussi le nombre de messages
    const result = await redis.zRangeWithScores(key, 0, limit - 1, {
      REV: true,
    });

    // Format result: [{value: 'jid1', score: 150}, {value: 'jid2', score: 120}]
    return result;
  },

  /**
   * Récupère le score spécifique d'un utilisateur dans un groupe
   */
  async getUserGroupScore(groupJid: string, userJid: string): Promise<number> {
    const key = `group:${groupJid}:leaderboard`;
    const score = await redis.zScore(key, userJid);
    return score || 0;
  },
};
