// services/groupService.ts
// ============================================================================
// SERVICE GROUPE UNIFIÉ (Cache + Aggressive Identity Linking)
// ============================================================================
//
// RESPONSABILITÉS:
// 1. Cacher les métadonnées des groupes WhatsApp dans Redis (24h TTL)
// 2. Déclencher l'"Aggressive Linking" : à chaque scan de groupe, on lie
//    automatiquement les LID aux JID pour tous les membres
// 3. Fournir le contexte social pour le prompt système de l'IA
// 4. Gérer les missions bot par groupe (Supabase)
//
// INJECTION DE DÉPENDANCES:
// Ce service utilise setContainer() pour recevoir une référence au conteneur DI.
// Cela évite les imports circulaires avec userService.
//
// MÉTHODES PRINCIPALES:
// - updateGroup(): Appelé quand on reçoit les métadonnées WhatsApp
// - getContext(): Construit le bloc "CONTEXTE SOCIAL" pour le prompt
// - getGroupMembers(): Retourne la liste des membres (depuis cache Redis)
// - trackActivity(): Incrémente le leaderboard du groupe (Redis ZSET)
//
// ============================================================================

import { redis } from './redisClient.js';
import { StateManager } from './state/StateManager.js';
import { supabase, db as supabaseDb } from './supabase.js';
export interface GroupServiceContainer {
  get<T = unknown>(name: string): T;
  has(name: string): boolean;
}
import { logger } from '../utils/logger.js';

// ============================================================================
// Type Definitions
// ============================================================================

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Participant brut tel que retourné par l'API WhatsApp */
interface WaParticipant {
  id: string;
  jid?: string;
  lid?: string;
  name?: string;
  notify?: string;
  admin?: string | null;
}

/** Métadonnées WhatsApp d'un groupe */
interface WaGroupMetadata {
  subject?: string;
  desc?: Buffer | string;
  owner?: string;
  subjectOwner?: string;
  creation?: number;
  participants: WaParticipant[];
}

/** Membre enrichi stocké dans le cache Redis */
interface GroupMember {
  jid: string;
  lid: string | null;
  phoneNumber: string | null;
  name: string | null;
  isAdmin: boolean;
}

/** Contexte social retourné par getContext */
interface SocialContext {
  type: 'GROUP' | 'PRIVATE';
  sender: UserProfile;
  group: GroupContextData | null;
  senderIsAdmin: boolean;
  senderLid: string | null;
}

/** Données du groupe dans le contexte social */
interface GroupContextData {
  jid: string;
  name: string;
  description: string;
  owner: string;
  admins: string[];
  member_count: number;
  tasks: unknown[];
  bot_mission?: string;
}

/** Profil utilisateur simplifié */
interface UserProfile {
  jid: string;
  names?: string[];
  interaction_count?: number;
  last_seen?: string;
  language?: string;
  timezone?: string;
}

/** Résultat d'une mission bot */
interface BotMissionResult {
  title: string | null;
  description: string | null;
  author: string | null;
}

/** Entrée de leaderboard */
interface LeaderboardEntry {
  value: string;
  score: number;
}

/** Wrapper Supabase minimal pour les appels du groupService */
interface SupabaseGroupWrapper {
  getGroupConfig(jid: string): Promise<Record<string, unknown> | null>;
}

// ============================================================================
// Service Implementation
// ============================================================================

export const groupService = {
  container: null as GroupServiceContainer | null,

  setContainer(container: GroupServiceContainer) {
    this.container = container;
  },

  get userService() {
    return this.container?.get('userService') as
      | {
          registerLid(jid: string, lid: string): Promise<void>;
          resolveLid(identifier: string): Promise<string | null>;
          getProfile(identifier: string): Promise<UserProfile>;
        }
      | undefined;
  },

  async _resolveFounderJid(founder: string | undefined): Promise<string | null> {
    if (!founder) return null;
    if (founder.includes('@s.whatsapp.net')) return founder;
    if (founder.endsWith('@lid') && this.userService) {
      const resolved = await this.userService.resolveLid(founder);
      if (resolved) return resolved;
    }
    return null;
  },

  async _syncGroupToSupabase(groupJid: string, waMetadata: WaGroupMetadata, admins: string[]) {
    if (!supabase) return;
    const founder = waMetadata.owner || waMetadata.subjectOwner;
    const validFounderJid = await this._resolveFounderJid(founder);

    if (validFounderJid && this.userService) {
      await this.userService.getProfile(validFounderJid);
    }

    await supabase.from('groups').upsert(
      {
        platform: 'whatsapp',
        platform_group_id: groupJid,
        jid: groupJid,
        name: waMetadata.subject || '',
        founder_jid: validFounderJid || null,
        created_at: waMetadata.creation
          ? new Date(waMetadata.creation * 1000).toISOString()
          : new Date().toISOString(),
      },
      { onConflict: 'platform,platform_group_id' },
    );

    await this.syncAdminsToSupabase(groupJid, admins);
  },

  /**
   * Met à jour le cache groupe avec les métadonnées WhatsApp
   */
  async updateGroup(groupJid: string, waMetadata: WaGroupMetadata) {
    const cacheKey = `group:${groupJid}:meta`;

    try {
      const admins = waMetadata.participants
        .filter((p) => p.admin === 'admin' || p.admin === 'superadmin')
        .map((p) => p.id);

      const members: GroupMember[] = waMetadata.participants.map((p) => {
        const realJid = p.jid || p.id;
        const lid = p.lid || (p.id.endsWith('@lid') ? p.id : null);

        if (realJid.endsWith('@s.whatsapp.net') && lid && this.userService) {
          this.userService.registerLid(realJid, lid).catch(() => {
            /* fire-and-forget registration */
          });
        }

        const phoneJid = realJid.endsWith('@s.whatsapp.net') ? realJid : null;
        return {
          jid: realJid,
          lid,
          phoneNumber: phoneJid,
          name: p.name || p.notify || null,
          isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
        };
      });

      if (this.userService) {
        await Promise.all(
          members.map(async (m) => {
            if (!m.phoneNumber && m.jid.endsWith('@lid')) {
              const resolved = await this.userService!.resolveLid(m.jid);
              if (resolved && resolved.endsWith('@s.whatsapp.net')) {
                m.phoneNumber = resolved;
              }
            }
          }),
        );
      }

      const groupData: Record<string, string> = {
        jid: groupJid,
        name: waMetadata.subject || '',
        description: waMetadata.desc ? waMetadata.desc.toString() : '',
        owner: waMetadata.owner || '',
        admins: JSON.stringify(admins),
        members: JSON.stringify(members),
        member_count: waMetadata.participants.length.toString(),
        last_updated: Date.now().toString(),
      };

      await redis.hSet(cacheKey, groupData);
      await redis.expire(cacheKey, 86400);

      await this._syncGroupToSupabase(groupJid, waMetadata, admins);

      logger.debug(
        'social',
        `[GroupService] Groupe mis à jour (Redis + DB): ${waMetadata.subject}`,
      );
    } catch (error: unknown) {
      console.error('[GroupService] updateGroup error:', extractErrorMessage(error));
    }
  },

  /**
   * Vérifie si les données du groupe nécessitent une mise à jour
   */
  async needsUpdate(groupJid: string): Promise<boolean> {
    const cacheKey = `group:${groupJid}:meta`;

    try {
      const [lastUpdated, members] = await Promise.all([
        redis.hGet(cacheKey, 'last_updated'),
        redis.hGet(cacheKey, 'members'),
      ]);

      if (!lastUpdated) return true;

      if (!members || members === '[]') {
        logger.debug('social', `[GroupService] Cache obsolète (pas de membres): ${groupJid}`);
        return true;
      }

      const ONE_DAY = 24 * 60 * 60 * 1000;
      if (Date.now() - parseInt(lastUpdated) > ONE_DAY) {
        return true;
      }

      if (members.includes('@lid"')) {
        try {
          const parsedMembers = JSON.parse(members) as GroupMember[];
          const hasBadData = parsedMembers.some((m) => m.jid && m.jid.endsWith('@lid'));
          if (hasBadData) {
            logger.debug(
              'social',
              `[GroupService] Cache corrompu détecté (LID as JID): ${groupJid} -> Force Sync`,
            );
            return true;
          }
        } catch {
          // JSON parse échoué → cache corrompu, forcer sync
          return true;
        }
      }

      if (supabase) {
        const { count, error } = await supabase
          .from('groups')
          .select('jid', { count: 'exact', head: true })
          .eq('jid', groupJid);

        if (!error && count === 0) {
          logger.debug(
            'social',
            `[GroupService] Groupe absent de la DB: ${groupJid} -> Force Sync`,
          );
          return true;
        }
      }

      return false;
    } catch {
      return true;
    }
  },

  /**
   * Invalide le cache d'un groupe
   */
  async invalidateCache(groupJid: string) {
    const cacheKey = `group:${groupJid}:meta`;

    try {
      await redis.del(cacheKey);
      logger.debug('social', `[GroupService] Cache invalidé pour: ${groupJid}`);
    } catch (error: unknown) {
      console.error('[GroupService] invalidateCache error:', extractErrorMessage(error));
    }
  },

  /**
   * Récupère la config/settings d'un groupe (Proxy vers Supabase)
   */
  async getGroupSettings(groupJid: string): Promise<Record<string, unknown>> {
    if (!supabase) return {};
    try {
      const config = await (supabaseDb as unknown as SupabaseGroupWrapper).getGroupConfig(groupJid);
      return config || {};
    } catch (error: unknown) {
      console.error('[GroupService] getGroupSettings error:', extractErrorMessage(error));
      return {};
    }
  },

  /**
   * Récupère le contexte complet pour le prompt système
   */
  async getContext(
    chatJid: string,
    senderJid: string,
    userProfile: UserProfile,
  ): Promise<SocialContext> {
    const isGroup = chatJid.endsWith('@g.us');

    const context: SocialContext = {
      type: isGroup ? 'GROUP' : 'PRIVATE',
      sender: userProfile,
      group: null,
      senderIsAdmin: false,
      senderLid: null,
    };

    if (!isGroup) return context;

    const cacheKey = `group:${chatJid}:meta`;

    try {
      const cached = await redis.hGetAll(cacheKey);

      if (cached && Object.keys(cached).length > 0) {
        const admins = JSON.parse(cached.admins || '[]') as string[];

        context.group = {
          jid: cached.jid,
          name: cached.name,
          description: cached.description || 'Aucune description',
          owner: cached.owner,
          admins,
          member_count: parseInt(cached.member_count) || 0,
          tasks: [],
        };

        context.senderIsAdmin = admins.includes(senderJid);

        if (supabase) {
          const { data: config } = await supabase
            .from('groups')
            .select('bot_mission')
            .eq('platform_group_id', chatJid)
            .single();

          if (config?.bot_mission && context.group) {
            context.group.bot_mission = config.bot_mission;
          }
        }
      }
    } catch (error: unknown) {
      console.error('[GroupService] getContext error:', extractErrorMessage(error));
    }

    return context;
  },

  /**
   * Récupère la liste des membres d'un groupe (depuis le cache Redis)
   */
  async getGroupMembers(groupJid: string): Promise<GroupMember[]> {
    const cacheKey = `group:${groupJid}:meta`;

    try {
      const membersJson = await redis.hGet(cacheKey, 'members');

      if (membersJson) {
        const members = JSON.parse(membersJson) as GroupMember[];

        if (this.userService) {
          const enrichedMembers = await Promise.all(
            members.map(async (member) => {
              if (member.name && member.name !== 'Inconnu') {
                return member;
              }

              try {
                const profile = await this.userService!.getProfile(member.jid);
                if (profile?.names?.[0] && profile.names[0] !== 'Inconnu') {
                  return { ...member, name: profile.names[0] };
                }
              } catch {
                // Ignore errors, garder le membre tel quel
              }

              return member;
            }),
          );

          return enrichedMembers;
        }

        return members;
      }

      return [];
    } catch (error: unknown) {
      console.error('[GroupService] getGroupMembers error:', extractErrorMessage(error));
      return [];
    }
  },

  /**
   * Récupère la mission bot d'un groupe (depuis Supabase)
   */
  async getBotMission(groupJid: string): Promise<BotMissionResult | null> {
    if (!supabase) return null;

    try {
      const { data, error } = await supabase
        .from('groups')
        .select('name, bot_mission')
        .eq('platform_group_id', groupJid)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('[GroupService] getBotMission error:', error);
      }

      if (!data) return null;

      return {
        title: data.name,
        description: data.bot_mission,
        author: null,
      };
    } catch (error: unknown) {
      console.error('[GroupService] getBotMission error:', extractErrorMessage(error));
      return null;
    }
  },

  /**
   * Définit la mission bot d'un groupe
   */
  async setBotMission(groupJid: string, title: string, description: string, _author: string) {
    if (!supabase) return;

    try {
      const { error } = await supabase.from('groups').upsert(
        {
          platform: 'whatsapp',
          platform_group_id: groupJid,
          name: title,
          bot_mission: description,
        },
        { onConflict: 'platform,platform_group_id' },
      );

      if (error) {
        console.error('[GroupService] setBotMission error:', error);
      }
    } catch (error: unknown) {
      console.error('[GroupService] setBotMission error:', extractErrorMessage(error));
    }
  },

  // ======== GROUP_ADMINS TABLE (Phase 2) ========

  /**
   * Synchronise les admins WhatsApp vers la table group_admins
   */
  async syncAdminsToSupabase(
    groupJid: string,
    adminJids: string[],
    promotedBy: string | null = null,
  ) {
    if (!supabase) return;

    try {
      const { data: existingAdmins, error: fetchError } = await supabase
        .from('group_admins')
        .select('user_jid')
        .eq('group_jid', groupJid);

      if (fetchError) {
        if (fetchError.message.includes('does not exist')) {
          console.warn('[GroupService] Table group_admins manquante, sync ignoré.');
          return;
        }
        throw fetchError;
      }

      const existingSet = new Set<string>(
        (existingAdmins || []).map((a: { user_jid: string }) => a.user_jid),
      );
      const newSet = new Set<string>(adminJids);

      const toAdd = adminJids.filter((jid) => !existingSet.has(jid));
      if (toAdd.length > 0) {
        const insertData = toAdd.map((jid) => ({
          group_jid: groupJid,
          user_jid: jid,
          role: 'admin',
          promoted_at: new Date().toISOString(),
          promoted_by: promotedBy,
        }));

        await supabase.from('group_admins').insert(insertData);
        logger.debug('social', `[GroupService] ${toAdd.length} admin(s) ajouté(s) à group_admins`);
      }

      const toRemove = [...existingSet].filter((jid) => !newSet.has(jid));
      if (toRemove.length > 0) {
        await supabase
          .from('group_admins')
          .delete()
          .eq('group_jid', groupJid)
          .in('user_jid', toRemove);

        console.log(`[GroupService] ${toRemove.length} admin(s) retiré(s) de group_admins`);
      }
    } catch (error: unknown) {
      console.error('[GroupService] syncAdminsToSupabase error:', extractErrorMessage(error));
    }
  },

  /**
   * Vérifie si un utilisateur est admin dans un groupe (via Supabase)
   */
  async isGroupAdmin(groupJid: string, userJid: string): Promise<boolean> {
    if (!supabase) return false;

    try {
      const { data, error } = await supabase
        .from('group_admins')
        .select('user_jid')
        .eq('group_jid', groupJid)
        .eq('user_jid', userJid)
        .maybeSingle();

      if (error) {
        const cacheKey = `group:${groupJid}:meta`;
        const adminsJson = await redis.hGet(cacheKey, 'admins');
        if (adminsJson) {
          const admins = JSON.parse(adminsJson) as string[];
          return admins.includes(userJid);
        }
        return false;
      }

      return !!data;
    } catch {
      return false;
    }
  },

  /**
   * Liste tous les groupes où un utilisateur est admin
   */
  async getAdminGroups(userJid: string): Promise<string[]> {
    if (!supabase) return [];

    try {
      const { data } = await supabase
        .from('group_admins')
        .select('group_jid')
        .eq('user_jid', userJid);

      return (data || []).map((d: { group_jid: string }) => d.group_jid);
    } catch (error: unknown) {
      console.error('[GroupService] getAdminGroups error:', extractErrorMessage(error));
      return [];
    }
  },

  /**
   * Compte le nombre d'admins par groupe
   */
  async countAdmins(groupJid: string): Promise<number> {
    if (!supabase) return 0;

    try {
      const { count } = await supabase
        .from('group_admins')
        .select('*', { count: 'exact', head: true })
        .eq('group_jid', groupJid);

      return count || 0;
    } catch {
      return 0;
    }
  },

  /**
   * Enregistre une activité (Appelé par BotCore à chaque message de groupe)
   */
  async trackActivity(groupJid: string, userJid: string) {
    await StateManager.recordGroupActivity(groupJid, userJid);
  },

  _getMedal(i: number): string {
    if (i === 0) return '🥇';
    if (i === 1) return '🥈';
    if (i === 2) return '🥉';
    return `${i + 1}.`;
  },

  async _formatLeaderboardEntry(entry: LeaderboardEntry, i: number): Promise<string> {
    const jid = entry.value;
    const score = entry.score;
    let name = jid.split('@')[0];

    if (this.userService) {
      const profile = await this.userService.getProfile(jid);
      if (profile?.names?.[0]) {
        name = profile.names[0];
      }
    }

    const medal = this._getMedal(i);
    return `\n${medal} ${name} : ${score} msgs`;
  },

  /**
   * Génère le rapport de stats pour la commande .stats ou gm_stats
   */
  async getStatsReport(groupJid: string): Promise<string> {
    const leaderboard = (await StateManager.getGroupLeaderboard(
      groupJid,
      10,
    )) as LeaderboardEntry[];

    if (!leaderboard || leaderboard.length === 0) {
      return '📊 Pas encore de statistiques pour ce groupe.';
    }

    let report = '📊 **TOP 10 MEMBRES ACTIFS**\n';
    for (let i = 0; i < leaderboard.length; i++) {
      const entry = leaderboard.at(i);
      if (entry) {
        report += await this._formatLeaderboardEntry(entry, i);
      }
    }

    return report;
  },
};

export default groupService;
