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
   * Récupère ou génère le hash unique d'un utilisateur (pour Speaker Injection)
   * @param jid - JID de l'utilisateur
   * @returns Hash de 3 caractères (ex: "A7X")
   */
  async getSpeakerHash(jid: string | null | undefined): Promise<string> {
    if (!jid) return 'UNK';

    const resolvedJid = (await this.resolveLid(jid)) || jid;

    try {
      const cacheKey = `user:${resolvedJid}:data`;
      const cachedHash = await redis?.hGet(cacheKey, 'hash');
      if (cachedHash) return cachedHash;

      if (supabase) {
        const { data } = await supabase
          .from('users')
          .select('hash')
          .eq('jid', resolvedJid)
          .single();

        if (data?.hash) {
          await redis?.hSet(cacheKey, 'hash', data.hash);
          return data.hash;
        }
      }

      const crypto = await import('crypto');
      const hash = crypto
        .createHash('md5')
        .update(resolvedJid)
        .digest('hex')
        .substring(0, 3)
        .toUpperCase();

      await redis?.hSet(cacheKey, 'hash', hash);

      if (supabase) {
        await supabase
          .from('users')
          .upsert({ jid: resolvedJid, hash }, { onConflict: 'jid' })
          .select();
      }

      return hash;
    } catch (e: unknown) {
      console.error('[UserService] getSpeakerHash error:', extractErrorMessage(e));
      const crypto = await import('crypto');
      return crypto
        .createHash('md5')
        .update(resolvedJid)
        .digest('hex')
        .substring(0, 3)
        .toUpperCase();
    }
  },

  /**
   * Force la synchronisation (Wrapper vers StateManager)
   */
  async flushAll() {
    return await StateManager.processSyncQueue(1000);
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
