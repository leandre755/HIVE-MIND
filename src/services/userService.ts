// services/userService.ts
// ============================================================================
// SERVICE UTILISATEUR UNIFIÉ (Façade)
// ============================================================================
//
// RÔLE: Interface principale pour la gestion des utilisateurs.
// Délègue aux services spécialisés:
// - StateManager: Gestion d'état (cache Redis, sync Supabase)
// - IdentityMap: Résolution LID <-> JID
//
// ============================================================================

import { createHash } from 'node:crypto';
import { StateManager } from './state/StateManager.js';
import { IdentityMap } from './state/IdentityMap.js';
import { supabase } from './supabase.js';
import { redis } from './redisClient.js';

// ============================================================================
// Type Definitions
// ============================================================================

interface UserProfile {
  jid: string;
  names: string[];
  interaction_count: number;
  last_seen?: string;
  language?: string;
  timezone?: string;
}

interface UserCandidate {
  jid: string;
  name: string;
  confidence: number;
}

interface SupabaseUserRow {
  jid: string;
  username?: string;
  interaction_count?: number;
}

interface GroupMember {
  jid: string;
}

// ============================================================================
// Helpers
// ============================================================================

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

type CachedHashResult =
  { status: 'found'; hash: string } | { status: 'legacy'; hash: string } | { status: 'not_found' };

type PersistedHashResult =
  | { status: 'found'; hash: string }
  | { status: 'legacy'; hash: string }
  | { status: 'not_found' }
  | { status: 'error' };

function classifySpeakerHash(hash: string): 'found' | 'legacy' | 'not_found' {
  const normalized = hash.trim().toUpperCase();
  if (/^[0-9A-F]{8,64}$/.test(normalized)) {
    return 'found';
  }
  if (/^[0-9A-F]{3,7}$/.test(normalized)) {
    return 'legacy';
  }
  return 'not_found';
}

async function readCachedSpeakerHash(cacheKey: string): Promise<CachedHashResult> {
  try {
    const cached = await redis?.hGet(cacheKey, 'hash');
    if (!cached) return { status: 'not_found' };
    const classification = classifySpeakerHash(cached);
    const normalized = cached.trim().toUpperCase();
    if (classification === 'found') {
      return { status: 'found', hash: normalized };
    }
    if (classification === 'legacy') {
      return { status: 'legacy', hash: normalized };
    }
    return { status: 'not_found' };
  } catch (redisErr: unknown) {
    console.error('[UserService] getSpeakerHash error:', extractErrorMessage(redisErr));
    return { status: 'not_found' };
  }
}

async function readPersistedSpeakerHash(resolvedJid: string): Promise<PersistedHashResult> {
  if (!supabase) return { status: 'not_found' };
  try {
    const { data, error } = await supabase
      .from('users')
      .select('hash')
      .eq('jid', resolvedJid)
      .single();

    if (error) {
      const isNotFound =
        (typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'PGRST116') ||
        (typeof error.message === 'string' &&
          (error.message.includes('0 rows') || error.message.includes('JSON object requested')));
      if (isNotFound) {
        return { status: 'not_found' };
      }
      console.warn('[UserService] Supabase getSpeakerHash read error:', extractErrorMessage(error));
      return { status: 'error' };
    }

    if (!data?.hash) return { status: 'not_found' };

    const classification = classifySpeakerHash(String(data.hash));
    const normalized = String(data.hash).trim().toUpperCase();
    if (classification === 'found') {
      return { status: 'found', hash: normalized };
    }
    if (classification === 'legacy') {
      return { status: 'legacy', hash: normalized };
    }
    return { status: 'not_found' };
  } catch (dbErr: unknown) {
    console.warn('[UserService] Supabase getSpeakerHash read error:', extractErrorMessage(dbErr));
    return { status: 'error' };
  }
}

// Cache en mémoire des correspondances LID -> JID canonique pour préserver l'identité
// lors de pannes transitoires du résolveur et éviter les identités dupliquées
const lidToCanonicalJidCache = new Map<string, string>();
const MAX_LID_CACHE_ENTRIES = 1000;

function setLidCacheEntry(key: string, value: string): void {
  if (lidToCanonicalJidCache.has(key)) {
    lidToCanonicalJidCache.delete(key);
  } else if (lidToCanonicalJidCache.size >= MAX_LID_CACHE_ENTRIES) {
    const oldestKey = lidToCanonicalJidCache.keys().next().value;
    if (oldestKey !== undefined) {
      lidToCanonicalJidCache.delete(oldestKey);
    }
  }
  lidToCanonicalJidCache.set(key, value);
}

async function persistSpeakerHash(
  cacheKey: string,
  resolvedJid: string,
  hash: string,
): Promise<void> {
  // Les LIDs bruts non résolus ne doivent jamais créer d'identité durable (ni Redis ni Supabase)
  if (resolvedJid.endsWith('@lid')) {
    return;
  }

  try {
    await redis?.hSet(cacheKey, 'hash', hash);
  } catch {
    // Ignorer l'erreur d'écriture Redis
  }

  if (supabase) {
    try {
      await supabase
        .from('users')
        .upsert({ jid: resolvedJid, hash }, { onConflict: 'jid' })
        .select();
    } catch (upsertErr: unknown) {
      console.warn('[UserService] getSpeakerHash upsert error:', extractErrorMessage(upsertErr));
    }
  }
}

interface ResolvedSpeakerIdentity {
  resolvedJid: string;
  isLid: boolean;
  resolutionFailed: boolean;
  hasCanonicalMapping: boolean;
}

async function resolveSpeakerIdentity(
  userServiceInstance: typeof userService,
  jid: string,
): Promise<ResolvedSpeakerIdentity> {
  const normalizedJid = jid.replace(/:\d+@/, '@');
  const isLid = normalizedJid.endsWith('@lid');
  const knownCanonical = isLid
    ? (lidToCanonicalJidCache.get(normalizedJid) ?? lidToCanonicalJidCache.get(jid))
    : undefined;

  let resolvedJid: string;
  let resolutionFailed = false;

  try {
    const resolved = await userServiceInstance.resolveLid(jid);
    const normalizedResolved = resolved?.replace(/:\d+@/, '@');
    if (normalizedResolved && !normalizedResolved.endsWith('@lid')) {
      resolvedJid = normalizedResolved;
      if (isLid) {
        setLidCacheEntry(normalizedJid, resolvedJid);
        setLidCacheEntry(jid, resolvedJid);
      }
    } else if (knownCanonical) {
      resolvedJid = knownCanonical;
    } else {
      resolvedJid = normalizedResolved ?? normalizedJid;
    }
  } catch {
    resolutionFailed = true;
    resolvedJid = knownCanonical ?? normalizedJid;
  }

  const hasCanonicalMapping = Boolean(
    knownCanonical || (resolvedJid !== normalizedJid && !resolvedJid.endsWith('@lid')),
  );

  return {
    resolvedJid,
    isLid,
    resolutionFailed,
    hasCanonicalMapping,
  };
}

// ============================================================================
// User Service Implementation
// ============================================================================

/**
 * Service utilisateur - Point d'entrée principal pour la gestion des profils
 * @namespace userService
 */
export const userService = {
  /**
   * Enregistre une interaction utilisateur via StateManager (Buffer Redis)
   * @param identifier - Identifiant utilisateur (JID ou LID)
   * @param pushName - Nom d'affichage WhatsApp
   * @param _groupJid - JID du groupe (optionnel, non utilisé)
   */
  async recordInteraction(identifier: string, pushName: string, _groupJid: string | null = null) {
    try {
      const resolvedJid = (await this.resolveLid(identifier)) || identifier;

      await StateManager.updateUserInteraction(resolvedJid, pushName);
    } catch (e: unknown) {
      console.error('[UserService] Error recording interaction:', extractErrorMessage(e));
    }
  },

  /**
   * Récupère le profil via StateManager (Cache-First)
   * @param identifier - Identifiant utilisateur
   * @returns Profil utilisateur ou fallback sûr
   */
  async getProfile(identifier: string): Promise<UserProfile> {
    try {
      const user = await StateManager.getUser(identifier);
      return {
        jid: String(user.jid),
        names: [user.last_pushname || user.username].filter(Boolean) as string[],
        interaction_count: user.interaction_count || 0,
        last_seen: typeof user.last_seen === 'number' ? String(user.last_seen) : undefined,
        language: user.language ?? undefined,
        timezone: user.timezone ?? undefined,
      };
    } catch (e: unknown) {
      console.error('[UserService] Error fetching profile:', extractErrorMessage(e));
      const fallbackId = identifier ? identifier.split(':')[0] : 'unknown';
      return { jid: fallbackId, names: ['Inconnu'], interaction_count: 0 };
    }
  },

  async updatePreferences(
    identifier: string,
    preferences: { language?: string; timezone?: string },
  ) {
    await StateManager.updatePreferences(identifier, preferences);
  },

  async registerLid(jid: string, lid: string) {
    if (jid && lid) {
      const cleanLid = lid.replace(/:\d+@/, '@');
      const cleanJid = jid.replace(/:\d+@/, '@');
      setLidCacheEntry(cleanLid, cleanJid);
      setLidCacheEntry(lid, cleanJid);
      redis?.del(`user:${cleanLid}:data`).catch(() => {});
    }
    await IdentityMap.register(jid, lid);
  },

  /**
   * Synchronous reverse lookup: JID → LID.
   * WHY: _isBotMentioned needs to compare the bot's JID against LID-based
   * @mentions that modern WhatsApp sends. Must be synchronous for hot-path.
   */
  getLidForJid(jid: string | null | undefined): string | null {
    return IdentityMap.getLidForJid(jid);
  },

  async resolveLid(identifier: string): Promise<string | null> {
    return await IdentityMap.resolve(identifier);
  },

  /**
   * Calcule de maniere deterministe le hash d'un speaker (SHA-256 tronque a 8 car. majuscules)
   * @param identifier - Identifiant utilisateur (JID)
   * @returns Hash de 8 caracteres majuscules (ex: "1B581DBD")
   */
  computeSpeakerHash(identifier: string): string {
    return createHash('sha256').update(identifier).digest('hex').substring(0, 8).toUpperCase();
  },

  /**
   * Recupere ou genere le hash unique d'un utilisateur (pour Speaker Injection)
   * @param jid - JID de l'utilisateur
   * @returns Hash de 8 caracteres
   */
  async getSpeakerHash(jid: string | null | undefined): Promise<string> {
    if (!jid) return 'UNK';

    const identity = await resolveSpeakerIdentity(this, jid);

    // Si la résolution a échoué (erreur temporaire) pour un LID sans mapping canonique disponible :
    // Éviter de créer une identité durable (ni dans Redis, ni dans Supabase)
    // Renvoyer un hash déterministe éphémère jusqu'au rétablissement du résolveur
    if (identity.resolutionFailed && !identity.hasCanonicalMapping && identity.isLid) {
      return this.computeSpeakerHash(identity.resolvedJid);
    }

    const resolvedJid = identity.resolvedJid;
    const cacheKey = `user:${resolvedJid}:data`;

    // 1. Tenter la lecture depuis le cache Redis (L1)
    const cached = await readCachedSpeakerHash(cacheKey);
    if (cached.status === 'found') {
      return cached.hash;
    }

    // 2. Tenter la lecture depuis Supabase (L2 - Persistance)
    // Note: Si Redis contient un hash legacy, nous consultons d'abord Supabase
    // pour preserver un hash courant valide eventuellement present dans la base.
    const persisted = await readPersistedSpeakerHash(resolvedJid);
    if (persisted.status === 'found') {
      redis?.hSet(cacheKey, 'hash', persisted.hash).catch(() => {});
      return persisted.hash;
    }

    // En cas d'erreur de lecture Supabase (panne transitoire) :
    // Calculer le hash deterministe sans persister pour eviter d'ecraser l'identite existante
    if (persisted.status === 'error') {
      return this.computeSpeakerHash(resolvedJid);
    }

    // Si Supabase ou Redis contient un hash legacy, migrer vers le hash deterministe 8-car
    if (persisted.status === 'legacy' || cached.status === 'legacy') {
      const migratedHash = this.computeSpeakerHash(resolvedJid);
      await persistSpeakerHash(cacheKey, resolvedJid, migratedHash);
      return migratedHash;
    }

    // 4. Absence confirmee dans le cache et la base : nouvel utilisateur
    try {
      const hash = this.computeSpeakerHash(resolvedJid);
      await persistSpeakerHash(cacheKey, resolvedJid, hash);
      return hash;
    } catch (e: unknown) {
      console.error('[UserService] getSpeakerHash generation error:', extractErrorMessage(e));
      return this.computeSpeakerHash(resolvedJid);
    }
  },

  /**
   * Force la synchronisation (Wrapper vers StateManager)
   */
  async flushAll() {
    return await StateManager.processSyncQueue(1000);
  },

  _clearLidCacheForTesting() {
    lidToCanonicalJidCache.clear();
  },

  // ======== FONCTIONS LEGACY / NON-MIGRÉES ========
  // Ces fonctions accèdent encore directement à Supabase/Redis pour des cas spécifiques

  /**
   * Vérifie si un utilisateur a été soft-deleted
   */
  async isDeleted(_userJid: string) {
    return false;
  },

  /**
   * Soft delete un utilisateur
   */
  async softDelete(_userJid: string) {
    console.warn('[UserService] Soft delete not supported in V2 schema');
    return false;
  },

  async listDeleted(_limit: number = 20) {
    return [];
  },

  async _filterCandidatesByGroup(
    candidates: UserCandidate[],
    groupJid: string,
  ): Promise<UserCandidate[]> {
    const groupKey = `group:${groupJid}:meta`;
    const membersJson = await redis?.hGet(groupKey, 'members');
    if (!membersJson) return candidates;
    const members = JSON.parse(membersJson) as GroupMember[];
    const memberJids = new Set(members.map((m) => m.jid));
    return candidates.filter((c) => memberJids.has(c.jid));
  },

  // ======== RESOLUTION NOM -> JID (Gardé tel quel car lecture seule complexe) ========
  async resolveByName(name: string, groupJid: string | null = null): Promise<UserCandidate[]> {
    if (!name || name.length < 2) return [];
    const searchName = name.toLowerCase().trim();
    let candidates: UserCandidate[] = [];

    try {
      if (supabase) {
        const { data: exactMatches } = await supabase
          .from('users')
          .select('jid, username, interaction_count')
          .or(`username.ilike.${searchName}`)
          .limit(10);

        if (exactMatches) {
          for (const user of exactMatches as SupabaseUserRow[]) {
            const matchedName = user.username || 'Inconnu';
            candidates.push({
              jid: user.jid,
              name: matchedName,
              confidence: matchedName.toLowerCase() === searchName ? 1.0 : 0.9,
            });
          }
        }
      }

      if (groupJid && candidates.length > 0) {
        candidates = await this._filterCandidatesByGroup(candidates, groupJid);
      }
      return candidates.sort((a, b) => b.confidence - a.confidence);
    } catch (error: unknown) {
      console.error('[UserService] resolveByName error:', extractErrorMessage(error));
      return [];
    }
  },

  async resolveToJid(name: string, groupJid: string | null = null): Promise<string | null> {
    const candidates = await this.resolveByName(name, groupJid);
    if (candidates.length > 0 && candidates[0].confidence > 0.7) return candidates[0].jid;
    return null;
  },
};

export default userService;
