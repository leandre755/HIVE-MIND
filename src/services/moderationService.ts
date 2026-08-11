import { supabase } from './supabase.js';
import { redis } from './redisClient.js';
import { workingMemory } from './workingMemory.js';

// ============================================================================
// Type Definitions
// ============================================================================

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function requireSupabase(): NonNullable<typeof supabase> {
  if (!supabase) throw new Error('[ModerationService] Supabase client not initialized');
  return supabase;
}

interface Logger {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  log: (...args: unknown[]) => void;
}

interface ModerationTransport {
  banUser(chatId: string, userJid: string, reason?: string): Promise<unknown>;
  updateGroupSetting(chatId: string, setting: string): Promise<unknown>;
}

interface ServiceContainer {
  get(name: string): unknown;
}

interface BanResult {
  success: boolean;
  userJid: string;
  reason: string;
}

interface KickResult {
  success: boolean;
  userJid: string;
  reason: string;
}

interface MuteResult {
  success: boolean;
  userJid: string;
  durationMinutes: number;
}

interface UnmuteResult {
  success: boolean;
  userJid: string;
}

interface WarnResult {
  success: boolean;
  warnCount: number;
}

interface LockResult {
  success: boolean;
  locked: boolean;
}

interface GroupFilter {
  id: string;
  group_jid: string;
  keyword: string;
  severity: string;
  context_rule: string;
  created_by: string | null;
  created_at: string;
}

type FilterSeverity = 'warn' | 'kick' | 'ban' | 'mute';

// ============================================================================
// ModerationService
// ============================================================================

export class ModerationService {
  private readonly logger: Logger;
  private container: ServiceContainer | null;

  constructor(logger?: Logger) {
    this.logger = logger ?? console;
    this.container = null;
  }

  setContainer(container: ServiceContainer): void {
    this.container = container;
  }

  /**
   * Bannit un utilisateur d'un groupe
   */
  async banUser(
    chatId: string,
    userJid: string,
    reason: string,
    transport: ModerationTransport,
  ): Promise<BanResult> {
    try {
      await transport.banUser(chatId, userJid);
      await this.logAction(chatId, userJid, 'ban', reason);
      return { success: true, userJid, reason };
    } catch (error: unknown) {
      this.logger.error(`[ModerationService] Erreur ban: ${extractErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Expulse un utilisateur
   */
  async kickUser(
    chatId: string,
    userJid: string,
    reason: string,
    transport: ModerationTransport,
  ): Promise<KickResult> {
    try {
      await transport.banUser(chatId, userJid);
      await this.logAction(chatId, userJid, 'remove', reason);
      return { success: true, userJid, reason };
    } catch (error: unknown) {
      this.logger.error(`[ModerationService] Erreur kick: ${extractErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Mute un utilisateur
   */
  async muteUser(
    chatId: string,
    userJid: string,
    durationMinutes: number = 30,
  ): Promise<MuteResult> {
    try {
      await workingMemory.muteUser(chatId, userJid, durationMinutes);
      return { success: true, userJid, durationMinutes };
    } catch (error: unknown) {
      this.logger.error(`[ModerationService] Erreur mute: ${extractErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Unmute un utilisateur
   */
  async unmuteUser(chatId: string, userJid: string): Promise<UnmuteResult> {
    try {
      const muteKey = `mute:${chatId}:${userJid}`;
      await redis.del(muteKey);
      return { success: true, userJid };
    } catch (error: unknown) {
      this.logger.error(`[ModerationService] Erreur unmute: ${extractErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Ajoute un avertissement (Warn)
   */
  async warnUser(
    chatId: string,
    userJid: string,
    reason: string,
    _moderatorJid: string,
  ): Promise<WarnResult> {
    try {
      const { error } = await requireSupabase().from('user_warnings').insert({
        group_jid: chatId,
        user_jid: userJid,
        reason,
      });

      if (error) throw error;

      const count = await this.getWarningCount(chatId, userJid);
      return { success: true, warnCount: count };
    } catch (error: unknown) {
      this.logger.error(`[ModerationService] Erreur warn: ${extractErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Récupère le nombre de warnings d'un utilisateur
   */
  async getWarningCount(chatId: string, userJid: string): Promise<number> {
    const { count, error } = await requireSupabase()
      .from('user_warnings')
      .select('*', { count: 'exact', head: true })
      .eq('group_jid', chatId)
      .eq('user_jid', userJid);

    if (error) return 0;
    return count ?? 0;
  }

  /**
   * Réinitialise les warnings
   */
  async resetWarnings(chatId: string, userJid: string): Promise<{ success: boolean }> {
    try {
      const { error } = await requireSupabase()
        .from('user_warnings')
        .delete()
        .eq('group_jid', chatId)
        .eq('user_jid', userJid);

      if (error) throw error;
      return { success: true };
    } catch (error: unknown) {
      this.logger.error(`[ModerationService] Erreur resetWarnings: ${extractErrorMessage(error)}`);
      throw error;
    }
  }

  /**
   * Ajoute un filtre de mot-clé
   */
  async addFilter(
    chatId: string,
    keyword: string,
    severity: FilterSeverity = 'warn',
    rule: string = '',
    creator: string | null = null,
  ): Promise<GroupFilter> {
    const { data, error } = await requireSupabase()
      .from('group_filters')
      .insert({
        group_jid: chatId,
        keyword,
        severity,
        context_rule: rule,
        created_by: creator,
      })
      .select();

    if (error) throw error;
    return data[0] as GroupFilter;
  }

  /**
   * Récupère les filtres d'un groupe
   */
  async getFilters(chatId: string): Promise<GroupFilter[]> {
    const { data, error } = await requireSupabase()
      .from('group_filters')
      .select('*')
      .eq('group_jid', chatId);

    if (error) return [];
    return (data ?? []) as GroupFilter[];
  }

  /**
   * Whitelist d'un utilisateur
   */
  async addToWhitelist(
    chatId: string,
    userJid: string,
    addedBy: string | null = null,
  ): Promise<boolean> {
    const { error } = await requireSupabase().from('group_whitelist').upsert({
      group_jid: chatId,
      user_jid: userJid,
      added_by: addedBy,
    });

    if (error) throw error;
    return true;
  }

  /**
   * Vérifie si un utilisateur est en whitelist
   */
  async isWhitelisted(chatId: string, userJid: string): Promise<boolean> {
    const { data } = await requireSupabase()
      .from('group_whitelist')
      .select('*')
      .eq('group_jid', chatId)
      .eq('user_jid', userJid)
      .maybeSingle();

    return !!data;
  }

  /**
   * Log une action dans l'historique
   */
  async logAction(
    chatId: string,
    userJid: string,
    action: string,
    _reason: string | null = null,
  ): Promise<void> {
    await requireSupabase().from('group_member_history').insert({
      group_jid: chatId,
      user_jid: userJid,
      action,
    });
  }

  /**
   * Verrouille/Déverrouille le groupe
   */
  async setGroupLock(
    chatId: string,
    locked: boolean,
    transport: ModerationTransport,
  ): Promise<LockResult> {
    try {
      const setting = locked ? 'announcement' : 'not_announcement';
      await transport.updateGroupSetting(chatId, setting);
      return { success: true, locked };
    } catch (error: unknown) {
      this.logger.error(`[ModerationService] Erreur lock: ${extractErrorMessage(error)}`);
      throw error;
    }
  }
}

export const moderationService = new ModerationService();
