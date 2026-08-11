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

function cleanJid(jid: string): string {
  const colonIdx = jid.indexOf(':');
  const atIdx = jid.indexOf('@');
  if (colonIdx !== -1 && atIdx !== -1 && colonIdx < atIdx) {
    return jid.slice(0, colonIdx) + jid.slice(atIdx);
  }
  return jid;
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
    return jidToLidCache.get(cleaned) || null;
  },

  /**
   * Async hydration: loads a JID→LID mapping from Redis into the in-memory cache.
   * Call once at startup for the bot's own JID to ensure getLidForJid works
   * synchronously from the very first message.
   */
  async hydrateLidCache(jid: string): Promise<void> {
    if (!jid || !redis) return;
    const cleaned = cleanJid(jid);
    if (jidToLidCache.has(cleaned)) return; // Already hydrated
    const numericId = extractNumericId(jid);
    const reverseKey = `map:jid2lid:${numericId}`;
    const lid = await redis.get(reverseKey);
    if (lid) {
      jidToLidCache.set(cleaned, lid);
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
  async resolve(identifier: string | null | undefined) {
    if (!identifier) return null;

    // Groupes: pas de résolution nécessaire
    if (identifier.endsWith('@g.us')) return identifier;

    // Nettoyage (supprime le ':12' de '33612345678:12@s.whatsapp.net')
    const id = identifier.replace(/:\d+@/, '@');

    if (id.endsWith('@s.whatsapp.net')) return id;

    if (id.endsWith('@lid')) {
      const numericId = extractNumericId(id);
      const lidKey = `map:lid:${numericId}`;

      // A. Cache Redis
      const cachedJid = await redis?.get(lidKey);
      if (cachedJid) return cachedJid;

      // B. Fallback Supabase (Recherche d'une identité soeur)
      if (supabase) {
        // Trouver le user_id de ce LID
        const { data: lidIdentity } = await supabase
          .from('user_identities')
          .select('user_id')
          .eq('platform', 'whatsapp')
          .eq('platform_user_id', id)
          .single();

        if (lidIdentity?.user_id) {
          // Trouver le JID associé à ce même user_id
          const { data: phoneIdentity } = await supabase
            .from('user_identities')
            .select('platform_user_id')
            .eq('platform', 'whatsapp')
            .eq('user_id', lidIdentity.user_id)
            .like('platform_user_id', '%@s.whatsapp.net')
            .single();

          if (phoneIdentity?.platform_user_id) {
            await redis?.set(lidKey, phoneIdentity.platform_user_id, { EX: 86400 * 7 });
            return phoneIdentity.platform_user_id;
          }
        }
      }
      return id;
    }

    return id;
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
    await redis?.set(lidKey, phoneJid);

    // Reverse mapping: JID → LID (new — for bot self-identification in @mentions)
    const reverseKey = `map:jid2lid:${extractNumericId(phoneJid)}`;
    await redis?.set(reverseKey, deviceLid, { EX: 86400 * 30 });
    jidToLidCache.set(cleanJid(phoneJid), deviceLid);

    await syncIdentitiesHelper(deviceLid, phoneJid);
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
