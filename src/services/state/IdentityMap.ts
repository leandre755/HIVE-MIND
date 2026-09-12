// services/state/IdentityMap.js
// ============================================================================
// SERVICE DE RÉSOLUTION D'IDENTITÉ (LID <-> JID)
// ============================================================================
//
// CONTEXTE WHATSAPP:
// - JID (Jabber ID) : Identifiant basé sur le numéro de téléphone (ex: 33612345678@s.whatsapp.net)
// - LID (Local ID)  : Identifiant de device cryptique (ex: 186101520123456@lid)
//
// PROBLÈME RÉSOLU:
// WhatsApp envoie parfois le LID au lieu du JID (notamment dans les groupes).
// Sans mapping, on créerait des profils "fantômes" distincts pour la même personne.
//
// SOLUTION:
// 1. resolve() : Convertit un LID en JID si le mapping existe
// 2. register(): Enregistre le lien LID<->JID et FUSIONNE les comptes fantômes
//
// ============================================================================

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

import { redis } from '../redisClient.js';
import { supabase } from '../supabase.js';
import { extractNumericId } from '../../utils/jidHelper.js';

/**
 * Service de mapping d'identité WhatsApp
 * Gère la correspondance entre LID (device) et JID (téléphone)
 */
// WHY: In-memory reverse cache (JID → LID) for synchronous hot-path access.
// _isBotMentioned is called on every group message and cannot afford async Redis lookups.
const jidToLidCache = new Map<string, string>();
// WHY: In-memory forward cache (LID → JID) to preserve canonical identities during transient failures.
const lidToJidCache = new Map<string, string>();

const MAX_CACHE_ENTRIES = 1000;

function cleanJid(jid: string): string {
  const colonIdx = jid.indexOf(':');
  const atIdx = jid.indexOf('@');
  if (colonIdx !== -1 && atIdx !== -1 && colonIdx < atIdx) {
    return jid.slice(0, colonIdx) + jid.slice(atIdx);
  }
  return jid;
}

function setBidirectionalCacheEntry(jid: string, lid: string): void {
  const cleanJ = cleanJid(jid);
  const cleanL = cleanJid(lid);

  // If existing keys point to different pairings, purge old mappings
  const oldLid = jidToLidCache.get(cleanJ);
  if (oldLid && oldLid !== cleanL) {
    lidToJidCache.delete(oldLid);
  }
  const oldJid = lidToJidCache.get(cleanL);
  if (oldJid && oldJid !== cleanJ) {
    jidToLidCache.delete(oldJid);
  }

  // Delete both entries first to refresh recency (LRU behavior)
  jidToLidCache.delete(cleanJ);
  lidToJidCache.delete(cleanL);

  // If at capacity, evict oldest entry from both caches
  while (jidToLidCache.size >= MAX_CACHE_ENTRIES) {
    const oldestJid = jidToLidCache.keys().next().value;
    if (oldestJid === undefined) break;
    const mappedLid = jidToLidCache.get(oldestJid);
    jidToLidCache.delete(oldestJid);
    if (mappedLid) lidToJidCache.delete(mappedLid);
  }
  while (lidToJidCache.size >= MAX_CACHE_ENTRIES) {
    const oldestLid = lidToJidCache.keys().next().value;
    if (oldestLid === undefined) break;
    const mappedJid = lidToJidCache.get(oldestLid);
    lidToJidCache.delete(oldestLid);
    if (mappedJid) jidToLidCache.delete(mappedJid);
  }

  jidToLidCache.set(cleanJ, cleanL);
  lidToJidCache.set(cleanL, cleanJ);
}

async function resolveLidFromRedis(numericId: string): Promise<string | null> {
  if (!redis) return null;
  try {
    const cachedJid = await redis.get(`map:lid:${numericId}`);
    return cachedJid ? cleanJid(cachedJid) : null;
  } catch {
    return null;
  }
}

async function resolveLidFromSupabase(rawLid: string): Promise<string | null> {
  if (!supabase) return null;
  try {
    const { data: lidIdentity } = await supabase
      .from('user_identities')
      .select('user_id')
      .eq('platform', 'whatsapp')
      .eq('platform_user_id', rawLid)
      .single();

    if (!lidIdentity?.user_id) return null;

    const { data: phoneIdentity } = await supabase
      .from('user_identities')
      .select('platform_user_id')
      .eq('platform', 'whatsapp')
      .eq('user_id', lidIdentity.user_id)
      .like('platform_user_id', '%@s.whatsapp.net')
      .single();

    return phoneIdentity?.platform_user_id ? cleanJid(phoneIdentity.platform_user_id) : null;
  } catch {
    return null;
  }
}

async function resolveLidIdentifier(id: string): Promise<string> {
  const cleanedId = cleanJid(id);
  const memoryJid = lidToJidCache.get(cleanedId);
  if (memoryJid) {
    setBidirectionalCacheEntry(memoryJid, cleanedId);
    return memoryJid;
  }

  const numericId = extractNumericId(id);
  const lidKey = `map:lid:${numericId}`;

  const redisJid = await resolveLidFromRedis(numericId);
  if (redisJid) {
    setBidirectionalCacheEntry(redisJid, cleanedId);
    return redisJid;
  }

  const dbJid = await resolveLidFromSupabase(id);
  if (dbJid) {
    setBidirectionalCacheEntry(dbJid, cleanedId);
    try {
      await redis?.set(lidKey, dbJid, { EX: 86400 * 7 });
    } catch {
      // Keep the successful Supabase resolution even if Redis write fails
    }
    return dbJid;
  }

  return id;
}

export const IdentityMap = {
  /**
   * Synchronous reverse lookup: given a phone JID, returns the known LID (if any).
   * WHY: Modern WhatsApp puts the LID (not the phone JID) in contextInfo.mentionedJid
   * and contextInfo.participant. The bot needs to compare its own LID against those.
   * Returns null if no mapping is known.
   */
  getLidForJid(jid: string | null | undefined): string | null {
    if (!jid) return null;
    const cleaned = cleanJid(jid);
    const lid = jidToLidCache.get(cleaned);
    if (lid) {
      setBidirectionalCacheEntry(cleaned, lid);
      return lid;
    }
    return null;
  },

  /**
   * Async hydration: loads a JID↔LID mapping from Redis into the in-memory cache symmetrically.
   * Call once at startup for the bot's own JID to ensure getLidForJid works
   * synchronously from the very first message.
   */
  async hydrateLidCache(identifier: string): Promise<void> {
    if (!identifier || !redis) return;
    const cleaned = cleanJid(identifier);

    if (cleaned.endsWith('@lid')) {
      const existingJid = lidToJidCache.get(cleaned);
      if (existingJid) {
        setBidirectionalCacheEntry(existingJid, cleaned);
        return;
      }
      const numericId = extractNumericId(cleaned);
      const lidKey = `map:lid:${numericId}`;
      const resolvedJid = await redis.get(lidKey);
      if (resolvedJid) {
        setBidirectionalCacheEntry(resolvedJid, cleaned);
      }
      return;
    }

    const existingLid = jidToLidCache.get(cleaned);
    if (existingLid) {
      setBidirectionalCacheEntry(cleaned, existingLid);
      return;
    }

    const numericId = extractNumericId(cleaned);
    const reverseKey = `map:jid2lid:${numericId}`;
    const lid = await redis.get(reverseKey);
    if (lid) {
      setBidirectionalCacheEntry(cleaned, lid);
    }
  },
  /**
   * Résout un identifiant vers le JID canonique (clé primaire DB)
   *
   * @param {string} identifier - JID, LID, ou identifiant brut
   * @returns {Promise<string>} Le JID canonique ou l'identifiant original si non résolu
   *
   * @example
   * // Si mapping existe: 186...@lid -> 336...@s.whatsapp.net
   * await IdentityMap.resolve('186101520...@lid'); // '33612345678@s.whatsapp.net'
   *
   * // Si pas de mapping, retourne l'original
   * await IdentityMap.resolve('inconnu@lid'); // 'inconnu@lid'
   */
  async resolve<T extends string | null | undefined>(
    identifier: T,
  ): Promise<T extends string ? string : null> {
    if (identifier == null) return null as T extends string ? string : null;

    // Groupes: pas de résolution nécessaire
    if (identifier.endsWith('@g.us')) {
      return identifier as unknown as T extends string ? string : null;
    }

    // Nettoyage (supprime le ':12' de '33612345678:12@s.whatsapp.net')
    const id = identifier.replace(/:\d+@/, '@');

    if (id.endsWith('@s.whatsapp.net')) return id as T extends string ? string : null;

    if (id.endsWith('@lid')) {
      const resolved = await resolveLidIdentifier(id);
      return resolved as T extends string ? string : null;
    }

    return id as T extends string ? string : null;
  },

  // ========================================================================
  // MÉTHODE DE FUSION D'IDENTITÉ (Ghost User Merge)
  // ========================================================================

  async register(id1: string | null | undefined, id2: string | null | undefined) {
    if (!id1 || !id2) return;

    let phoneJid: string | null = null;
    let deviceLid: string | null = null;

    if (id1.includes('@s.whatsapp.net')) phoneJid = id1;
    else if (id1.includes('@lid')) deviceLid = id1;

    if (id2.includes('@s.whatsapp.net')) phoneJid = id2;
    else if (id2.includes('@lid')) deviceLid = id2;

    if (!phoneJid || !deviceLid) return;

    // Forward mapping: LID → JID (existing)
    const lidKey = `map:lid:${extractNumericId(deviceLid)}`;
    try {
      await redis?.set(lidKey, phoneJid);
    } catch {
      // Ignorer l'erreur d'écriture Redis
    }

    // Reverse mapping: JID → LID (new — for bot self-identification in @mentions)
    const reverseKey = `map:jid2lid:${extractNumericId(phoneJid)}`;
    try {
      await redis?.set(reverseKey, deviceLid, { EX: 86400 * 30 });
    } catch {
      // Ignorer l'erreur d'écriture Redis
    }
    setBidirectionalCacheEntry(phoneJid, deviceLid);

    await syncIdentitiesHelper(deviceLid, phoneJid);
  },

  _clearCacheForTesting() {
    jidToLidCache.clear();
    lidToJidCache.clear();
  },
};
async function syncIdentitiesHelper(deviceLid: string, phoneJid: string): Promise<void> {
  if (!supabase) return;
  try {
    const { data: ghostIdentity } = await supabase
      .from('user_identities')
      .select('id, user_id, users(interaction_count)')
      .eq('platform', 'whatsapp')
      .eq('platform_user_id', deviceLid)
      .single();

    const { data: realIdentity } = await supabase
      .from('user_identities')
      .select('id, user_id, users(interaction_count)')
      .eq('platform', 'whatsapp')
      .eq('platform_user_id', phoneJid)
      .single();

    if (ghostIdentity && realIdentity && ghostIdentity.user_id !== realIdentity.user_id) {
      const debugIdentity = (await redis?.get('config:debug:identity')) === 'true';
      if (debugIdentity)
        console.log(`[IdentityMap] 👻 Fusion fantôme: ${deviceLid} -> ${phoneJid}`);

      const ghostUsers = ghostIdentity.users as unknown as { interaction_count?: number } | null;
      const realUsers = realIdentity.users as unknown as { interaction_count?: number } | null;
      const ghostXp = parseInt(String(ghostUsers?.interaction_count || 0));
      const realXp = parseInt(String(realUsers?.interaction_count || 0));
      const newXp = ghostXp + realXp;

      await supabase
        .from('user_identities')
        .update({ user_id: realIdentity.user_id })
        .eq('id', ghostIdentity.id);

      await supabase
        .from('users')
        .update({ interaction_count: newXp })
        .eq('id', realIdentity.user_id);

      await supabase.from('users').delete().eq('id', ghostIdentity.user_id);
      return;
    }

    if (ghostIdentity && !realIdentity) {
      await supabase.from('user_identities').insert({
        user_id: ghostIdentity.user_id,
        platform: 'whatsapp',
        platform_user_id: phoneJid,
      });
      return;
    }

    if (realIdentity && !ghostIdentity) {
      await supabase.from('user_identities').insert({
        user_id: realIdentity.user_id,
        platform: 'whatsapp',
        platform_user_id: deviceLid,
      });
      return;
    }

    if (!realIdentity && !ghostIdentity) {
      const { data: newUser } = await supabase
        .from('users')
        .insert({ username: phoneJid })
        .select()
        .single();
      if (newUser) {
        await supabase.from('user_identities').insert([
          { user_id: newUser.id, platform: 'whatsapp', platform_user_id: phoneJid },
          { user_id: newUser.id, platform: 'whatsapp', platform_user_id: deviceLid },
        ]);
      }
    }
  } catch (error: unknown) {
    console.error('[IdentityMap] Erreur process identity:', extractErrorMessage(error));
  }
}
