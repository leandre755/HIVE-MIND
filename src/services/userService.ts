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
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
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

// Cache en mémoire des correspondances Hash -> JID propriétaire pour détecter et résoudre les collisions
const hashToOwnerMap = new Map<string, string>();
const jidToVerifiedHashMap = new Map<string, string>();
const MAX_HASH_OWNER_ENTRIES = 1000;

function setHashOwnerEntry(hash: string, jid: string): void {
  if (hashToOwnerMap.has(hash)) {
    hashToOwnerMap.delete(hash);
  } else if (hashToOwnerMap.size >= MAX_HASH_OWNER_ENTRIES) {
    const oldestKey = hashToOwnerMap.keys().next().value;
    if (oldestKey !== undefined) {
      hashToOwnerMap.delete(oldestKey);
    }
  }
  hashToOwnerMap.set(hash, jid);

  if (jidToVerifiedHashMap.has(jid)) {
    jidToVerifiedHashMap.delete(jid);
  } else if (jidToVerifiedHashMap.size >= MAX_HASH_OWNER_ENTRIES) {
    const oldestKey = jidToVerifiedHashMap.keys().next().value;
    if (oldestKey !== undefined) {
      jidToVerifiedHashMap.delete(oldestKey);
    }
  }
  jidToVerifiedHashMap.set(jid, hash);
}

async function checkSupabaseCandidateOwner(
  hash: string,
  resolvedJid: string,
): Promise<'available' | 'collision' | 'error'> {
  if (!supabase) return 'available';
  try {
    const { data, error } = await supabase.from('users').select('jid').eq('hash', hash).limit(10);

    if (error) {
      const isNotFound =
        (typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'PGRST116') ||
        (typeof error.message === 'string' &&
          (error.message.includes('0 rows') || error.message.includes('JSON object requested')));
      if (isNotFound) {
        return 'available';
      }
      return 'error';
    }

    if (Array.isArray(data) && data.length > 0) {
      const conflicting = data.find((row) => {
        const rawOwner = (row as { jid?: string })?.jid;
        const normalizedOwner = rawOwner ? rawOwner.replace(/:\d+@/, '@') : undefined;
        return Boolean(normalizedOwner && normalizedOwner !== resolvedJid);
      });
      const conflictingJid = (conflicting as { jid?: string })?.jid;
      if (conflictingJid) {
        setHashOwnerEntry(hash, conflictingJid);
        return 'collision';
      }
    }
    return 'available';
  } catch {
    return 'error';
  }
}

async function claimCandidateInRedis(
  hash: string,
  resolvedJid: string,
): Promise<'claimed' | 'unreserved' | 'collision'> {
  if (!redis) {
    setHashOwnerEntry(hash, resolvedJid);
    return 'unreserved';
  }
  try {
    const key = `hash:owner:${hash}`;
    const setRes = await redis.set(key, resolvedJid, { NX: true });
    if (setRes === 'OK') {
      setHashOwnerEntry(hash, resolvedJid);
      return 'claimed';
    }

    const currentOwner = await redis.get(key);
    if (currentOwner === resolvedJid) {
      setHashOwnerEntry(hash, resolvedJid);
      return 'claimed';
    }
    if (currentOwner && currentOwner !== resolvedJid) {
      setHashOwnerEntry(hash, currentOwner);
      return 'collision';
    }
    return 'unreserved';
  } catch {
    return 'unreserved';
  }
}

async function checkStoredRedisCollision(hash: string, resolvedJid: string): Promise<boolean> {
  if (!redis) return false;
  try {
    const key = `hash:owner:${hash}`;
    const currentOwner = await redis.get(key);
    if (currentOwner) {
      const normalizedCurrentOwner = currentOwner.replace(/:\d+@/, '@');
      if (normalizedCurrentOwner !== resolvedJid) {
        setHashOwnerEntry(hash, currentOwner);
        return true;
      }
    }
  } catch {
    // Ignorer l'erreur Redis
  }
  return false;
}

async function checkStoredSupabaseCollision(hash: string, resolvedJid: string): Promise<boolean> {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.from('users').select('jid').eq('hash', hash).limit(10);
    if (error || !Array.isArray(data) || data.length === 0) {
      return false;
    }

    const conflicting = data.find((row) => {
      const rawOwner = (row as { jid?: string })?.jid;
      const normalizedOwner = rawOwner ? rawOwner.replace(/:\d+@/, '@') : undefined;
      return Boolean(normalizedOwner && normalizedOwner !== resolvedJid);
    });
    const conflictingJid = (conflicting as { jid?: string })?.jid;
    if (conflictingJid) {
      setHashOwnerEntry(hash, conflictingJid);
      return true;
    }
  } catch {
    // Ignorer l'erreur Supabase
  }
  return false;
}

async function isStoredHashColliding(hash: string, resolvedJid: string): Promise<boolean> {
  const inMemoryOwner = hashToOwnerMap.get(hash);
  if (inMemoryOwner && inMemoryOwner.replace(/:\d+@/, '@') !== resolvedJid) {
    return true;
  }

  const hasRedisCollision = await checkStoredRedisCollision(hash, resolvedJid);
  if (hasRedisCollision) {
    return true;
  }

  const hasSupabaseCollision = await checkStoredSupabaseCollision(hash, resolvedJid);
  if (hasSupabaseCollision) {
    return true;
  }

  setHashOwnerEntry(hash, resolvedJid);
  redis?.set(`hash:owner:${hash}`, resolvedJid, { NX: true }).catch(() => {});
  return false;
}

function isUniqueConstraintViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const errorObj = err as { code?: string; message?: string };
  if (errorObj.code === '23505') return true;
  if (typeof errorObj.message === 'string') {
    const msg = errorObj.message.toLowerCase();
    return (
      msg.includes('unique') || msg.includes('duplicate key') || msg.includes('users_hash_key')
    );
  }
  return false;
}

async function verifyAndReserveCandidate(
  hash: string,
  resolvedJid: string,
): Promise<'claimed' | 'unreserved' | 'collision' | 'error'> {
  const inMemoryOwner = hashToOwnerMap.get(hash);
  if (inMemoryOwner && inMemoryOwner !== resolvedJid) {
    return 'collision';
  }

  const supabaseResult = await checkSupabaseCandidateOwner(hash, resolvedJid);
  if (supabaseResult === 'collision' || supabaseResult === 'error') {
    return supabaseResult;
  }

  return await claimCandidateInRedis(hash, resolvedJid);
}

async function upsertSpeakerHashToSupabase(
  resolvedJid: string,
  hash: string,
  reservation: 'claimed' | 'unreserved',
): Promise<'persisted' | 'collision' | 'error'> {
  if (!supabase) return 'persisted';
  try {
    const { error } = await supabase
      .from('users')
      .upsert({ jid: resolvedJid, hash }, { onConflict: 'jid' })
      .select();

    if (error) {
      if (isUniqueConstraintViolation(error)) {
        return 'collision';
      }
      console.warn('[UserService] getSpeakerHash upsert error:', extractErrorMessage(error));
      return 'error';
    }

    if (reservation === 'unreserved') {
      const postCheck = await checkSupabaseCandidateOwner(hash, resolvedJid);
      if (postCheck === 'collision') {
        return 'collision';
      }
    }
    return 'persisted';
  } catch (upsertErr: unknown) {
    if (isUniqueConstraintViolation(upsertErr)) {
      return 'collision';
    }
    console.warn('[UserService] getSpeakerHash upsert error:', extractErrorMessage(upsertErr));
    return 'error';
  }
}

async function persistSpeakerHash(
  cacheKey: string,
  resolvedJid: string,
  hash: string,
  reservation: 'claimed' | 'unreserved',
): Promise<'persisted' | 'collision' | 'error'> {
  // Les LIDs bruts non résolus ne doivent jamais créer d'identité durable (ni Redis ni Supabase)
  if (resolvedJid.endsWith('@lid')) {
    return 'persisted';
  }

  const supabaseResult = await upsertSpeakerHashToSupabase(resolvedJid, hash, reservation);
  if (supabaseResult !== 'persisted') {
    return supabaseResult;
  }

  setHashOwnerEntry(hash, resolvedJid);

  try {
    await redis?.hSet(cacheKey, 'hash', hash);
    await redis?.set(`hash:owner:${hash}`, resolvedJid);
  } catch {
    // Ignorer l'erreur d'écriture Redis
  }

  return 'persisted';
}

const COMPARE_AND_DELETE_LUA_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

async function releaseCandidateReservation(hash: string, resolvedJid: string): Promise<void> {
  if (!hash || !resolvedJid) return;
  const currentMemoryOwner = hashToOwnerMap.get(hash);
  if (currentMemoryOwner && currentMemoryOwner.replace(/:\d+@/, '@') === resolvedJid) {
    hashToOwnerMap.delete(hash);
  }
  if (!redis) return;
  try {
    const key = `hash:owner:${hash}`;
    if (typeof redis.eval === 'function') {
      await redis.eval(COMPARE_AND_DELETE_LUA_SCRIPT, {
        keys: [key],
        arguments: [resolvedJid],
      });
    }
  } catch {
    // Ignorer l'erreur de liberation Redis
  }
}

async function generateUniqueSpeakerHash(
  userServiceInstance: typeof userService,
  resolvedJid: string,
  cacheKey: string,
): Promise<string> {
  const MAX_COLLISION_ATTEMPTS = 10;
  let encounteredLookupError = false;

  for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt++) {
    const candidate = userServiceInstance.computeSpeakerHash(resolvedJid, attempt);
    const reservation = await verifyAndReserveCandidate(candidate, resolvedJid);
    if (reservation === 'collision') {
      continue;
    }
    if (reservation === 'error') {
      encounteredLookupError = true;
      continue;
    }

    const persistResult = await persistSpeakerHash(cacheKey, resolvedJid, candidate, reservation);
    if (persistResult === 'collision' || persistResult === 'error') {
      await releaseCandidateReservation(candidate, resolvedJid);
      if (persistResult === 'error') {
        encounteredLookupError = true;
      }
      continue;
    }

    return candidate;
  }

  if (encounteredLookupError) {
    throw new Error(
      `Unable to verify speaker hash availability for ${resolvedJid} due to lookup error`,
    );
  }
  throw new Error(
    `Unable to allocate a unique speaker hash for ${resolvedJid} after ${MAX_COLLISION_ATTEMPTS} attempts`,
  );
}

function computeOutageSpeakerHash(
  userServiceInstance: typeof userService,
  resolvedJid: string,
): string {
  const verifiedInMemory = jidToVerifiedHashMap.get(resolvedJid);
  if (verifiedInMemory) {
    return verifiedInMemory;
  }

  const MAX_ATTEMPTS = 10;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate = userServiceInstance.computeSpeakerHash(resolvedJid, attempt);
    const owner = hashToOwnerMap.get(candidate);
    if (!owner || owner === resolvedJid) {
      setHashOwnerEntry(candidate, resolvedJid);
      return candidate;
    }
  }

  return userServiceInstance.computeSpeakerHash(resolvedJid);
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
   * En cas de collision detectee sur attempt 0, un sel deterministe ':attempt' est ajoute.
   * @param identifier - Identifiant utilisateur (JID)
   * @param attempt - Index de tentative en cas de collision (defaut: 0)
   * @returns Hash de 8 caracteres majuscules (ex: "1B581DBD")
   */
  computeSpeakerHash(identifier: string, attempt: number = 0): string {
    const input = attempt === 0 ? identifier : `${identifier}:${attempt}`;
    return createHash('sha256').update(input).digest('hex').substring(0, 8).toUpperCase();
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
      const isColliding = await isStoredHashColliding(cached.hash, resolvedJid);
      if (!isColliding) {
        return cached.hash;
      }
    }

    // 2. Tenter la lecture depuis Supabase (L2 - Persistance)
    // Note: Si Redis contient un hash legacy, nous consultons d'abord Supabase
    // pour preserver un hash courant valide eventuellement present dans la base.
    const persisted = await readPersistedSpeakerHash(resolvedJid);
    if (persisted.status === 'found') {
      const isColliding = await isStoredHashColliding(persisted.hash, resolvedJid);
      if (!isColliding) {
        redis?.hSet(cacheKey, 'hash', persisted.hash).catch(() => {});
        redis?.set(`hash:owner:${persisted.hash}`, resolvedJid, { NX: true }).catch(() => {});
        return persisted.hash;
      }
    }

    // En cas d'erreur de lecture Supabase (panne transitoire) :
    // Renvoyer le hash vérifié ou déterministe en mémoire sans persister pour maintenir
    // une attribution stable tout au long de la panne et préserver la résolution de collision.
    if (persisted.status === 'error') {
      return computeOutageSpeakerHash(this, resolvedJid);
    }

    // 3. Migration (hash legacy), nouvel utilisateur, ou réparation d'une collision stockée
    try {
      return await generateUniqueSpeakerHash(this, resolvedJid, cacheKey);
    } catch (allocErr: unknown) {
      console.warn(
        '[UserService] generateUniqueSpeakerHash failed, falling back to outage hash:',
        extractErrorMessage(allocErr),
      );
      return computeOutageSpeakerHash(this, resolvedJid);
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
    hashToOwnerMap.clear();
    jidToVerifiedHashMap.clear();
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
