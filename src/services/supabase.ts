// services/supabase.ts
// Client Supabase pour la persistance cloud - Omni-Channel Ready

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { safeReadFileSync, safeExistsSync } from '../utils/safeFs.js';
import { resolveConfigPath } from '../config/ConfigPathResolver.js';
import ws from 'ws';

interface SupabaseCredentials {
  project_url?: string;
  url?: string;
  service_role_key?: string;
  key?: string;
}

interface Credentials {
  supabase?: SupabaseCredentials;
}

interface ResolvedContext {
  context_id: string;
  type: 'user' | 'group';
}

interface HealthCheckResult {
  status: 'connected' | 'disconnected' | 'error';
  error?: string;
  latency?: string;
  userCount?: number | null;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function stripQuotes(value: string | undefined): string | undefined {
  if (!value) return value;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function isSupabaseUrlValid(url?: string): boolean {
  if (!url || !url.startsWith('http')) return false;
  const upper = url.toUpperCase();
  return (
    !upper.includes('VOTRE_PROJET') &&
    !upper.includes('YOUR_PROJECT') &&
    upper !== 'DUMMY' &&
    upper !== 'PLACEHOLDER'
  );
}

export function isSupabaseKeyValid(key?: string): boolean {
  if (!key || key.trim() === '') return false;
  const upper = key.toUpperCase();
  return (
    !upper.startsWith('VOTRE_') &&
    !upper.startsWith('YOUR_') &&
    !upper.includes('VOTRE_CLE') &&
    !upper.includes('YOUR_KEY') &&
    upper !== 'DUMMY' &&
    upper !== 'PLACEHOLDER' &&
    upper !== 'UNDEFINED' &&
    upper !== 'NULL'
  );
}

export function resolveEnvOrVal(val?: string): string | undefined {
  const unquoted = stripQuotes(val);
  if (!unquoted) return undefined;
  if (Object.hasOwn(process.env, unquoted)) {
    const envVal = Reflect.get(process.env, unquoted);
    if (typeof envVal === 'string' && envVal) return stripQuotes(envVal);
  }
  return unquoted;
}

export function initSupabaseClient(url?: string, key?: string): SupabaseClient | null {
  const projUrl = resolveEnvOrVal(url) || stripQuotes(process.env.SUPABASE_URL);
  const projKey =
    resolveEnvOrVal(key) ||
    stripQuotes(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY);

  if (isSupabaseUrlValid(projUrl) && isSupabaseKeyValid(projKey)) {
    // IMPORTANT : Utiliser service_role_key pour contourner Row Level Security
    return createClient(projUrl!, projKey!, {
      auth: {
        persistSession: false,
      },
      realtime: {
        transport: ws as unknown as typeof globalThis.WebSocket,
      },
    });
  }
  return null;
}

// Charger les credentials
let credentials: Credentials | null;
try {
  const credentialsPath = resolveConfigPath('credentials.json');
  credentials =
    credentialsPath && safeExistsSync(credentialsPath)
      ? (JSON.parse(safeReadFileSync(credentialsPath, 'utf-8')) as Credentials)
      : null;
} catch (error: unknown) {
  console.warn(`⚠️ Erreur lecture credentials: ${extractErrorMessage(error)}`);
  credentials = null;
}

// Créer le client Supabase
let supabase: SupabaseClient | null = initSupabaseClient(
  credentials?.supabase?.project_url || credentials?.supabase?.url,
  credentials?.supabase?.service_role_key || credentials?.supabase?.key,
);

export function determineIfGroup(legacyId: string, isWhatsApp: boolean): boolean {
  if (isWhatsApp) {
    return legacyId.toLowerCase().endsWith('@g.us');
  }
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(legacyId);
  if (isUuid || legacyId.startsWith('user-') || legacyId.startsWith('user_')) {
    return false;
  }
  return (
    legacyId.startsWith('chat_') ||
    legacyId.startsWith('group_') ||
    legacyId.startsWith('channel_') ||
    legacyId.includes('-')
  );
}

/**
 * Utilitaires de base de données
 */
export const db = {
  get client() {
    return supabase;
  },

  reinit(urlOrClient?: string | SupabaseClient, key?: string): SupabaseClient | null {
    if (typeof urlOrClient === 'object' && urlOrClient !== null) {
      supabase = urlOrClient;
      return supabase;
    }
    supabase = initSupabaseClient(urlOrClient, key);
    return supabase;
  },

  from(table: string) {
    return supabase?.from(table);
  },

  rpc(fn: string, args: Record<string, unknown>) {
    return supabase?.rpc(fn, args);
  },

  isAvailable() {
    return supabase !== null;
  },

  // =========================================================================
  // NOUVELLES MÉTHODES DE RÉSOLUTION D'IDENTITÉ (OMNI-CHANNEL)
  // =========================================================================

  /**
   * Resolves a unified User UUID from a platform specific ID
   */
  async resolveUser(
    platform: string,
    platformUserId: string,
    username?: string,
  ): Promise<string | null> {
    if (!supabase) return null;

    // 1. Cherche l'identité existante
    const { data: identity } = await supabase
      .from('user_identities')
      .select('user_id')
      .eq('platform', platform)
      .eq('platform_user_id', platformUserId)
      .maybeSingle();

    if (identity) return identity.user_id;

    // 2. Si non trouvée, créer le Contact central (User)
    const { data: newUser, error: errUser } = await supabase
      .from('users')
      .insert({ username: username || platformUserId })
      .select()
      .single();

    if (errUser) {
      console.error('[DB] Erreur création contact central:', errUser);
      return null;
    }

    // 3. Créer le lien d'identité (UPSERT avec ignoreDuplicates pour éviter d'écraser une identité concurrente)
    const { error: errId } = await supabase
      .from('user_identities')
      .upsert(
        { user_id: newUser.id, platform, platform_user_id: platformUserId },
        { onConflict: 'platform,platform_user_id', ignoreDuplicates: true },
      );

    if (errId) {
      console.error('[DB] Erreur création user_identity:', errId);
      await supabase.from('users').delete().eq('id', newUser.id);
      return null;
    }

    // 4. Vérifier quelle identité est effectivement liée (en cas d'insertion concurrente)
    const { data: finalIdentity } = await supabase
      .from('user_identities')
      .select('user_id')
      .eq('platform', platform)
      .eq('platform_user_id', platformUserId)
      .maybeSingle();

    if (finalIdentity && finalIdentity.user_id !== newUser.id) {
      await supabase.from('users').delete().eq('id', newUser.id);
      return finalIdentity.user_id;
    }

    return newUser.id;
  },

  /**
   * Resolves a unified Group UUID from a platform specific ID
   */
  async resolveGroup(
    platform: string,
    platformGroupId: string,
    name?: string,
  ): Promise<string | null> {
    if (!supabase) return null;

    const { data: group } = await supabase
      .from('groups')
      .select('id')
      .eq('platform', platform)
      .eq('platform_group_id', platformGroupId)
      .maybeSingle();

    if (group) return group.id;

    // [UPSERT] Utiliser upsert pour éviter les erreurs 23505 (duplicate key) en cas d'appels concurrents
    const { data: newGroup, error } = await supabase
      .from('groups')
      .upsert(
        {
          platform,
          platform_group_id: platformGroupId,
          name: name || platformGroupId,
        },
        { onConflict: 'platform,platform_group_id' },
      )
      .select()
      .single();

    if (error) {
      console.error('[DB] Erreur création groupe unifié:', error);
      return null;
    }
    return newGroup.id;
  },

  /**
   * Legacy JID resolver for backward compatibility
   * Déduit automatiquement la plateforme depuis le format du JID WhatsApp/Telegram/Discord
   */
  /**
   * Resolves a legacy JID from a context UUID
   */
  async resolveLegacyIdFromContext(contextId: string): Promise<string | null> {
    if (!supabase) return null;

    const { data: group } = await supabase
      .from('groups')
      .select('platform_group_id')
      .eq('id', contextId)
      .maybeSingle();
    if (group) return group.platform_group_id;

    const { data: identity } = await supabase
      .from('user_identities')
      .select('platform_user_id')
      .eq('user_id', contextId)
      .maybeSingle();
    if (identity) return identity.platform_user_id;

    return null;
  },

  /**
   * Legacy JID resolver for backward compatibility
   * Déduit automatiquement la plateforme depuis le format du JID WhatsApp/Telegram/Discord
   */
  async resolveContextFromLegacyId(legacyId: string): Promise<ResolvedContext | null> {
    if (!legacyId) return null;

    const hasWhatsAppDomain = (value: string): boolean => {
      if (!value || typeof value !== 'string') return false;

      // 1. URLs absolues HTTP(S) uniquement (sans credentials userinfo)
      if (/^https?:\/\//i.test(value)) {
        try {
          const parsed = new URL(value);
          const host = parsed.hostname.toLowerCase();
          const isWhatsAppHost =
            host === 'whatsapp.net' || host === 's.whatsapp.net' || host === 'g.us';
          return isWhatsAppHost && !parsed.username && !parsed.password;
        } catch {
          return false;
        }
      }

      // 2. Rejet de tout délimiteur d'URL, espace ou antislash pour les identifiants non-URL
      if (/[/?#\s\\]/.test(value)) {
        return false;
      }

      // 3. Parser JID strict à un seul '@' : <local>@<domain>
      const parts = value.split('@');
      if (parts.length !== 2 || !parts[0] || !parts[1]) {
        return false;
      }

      const [localPart, domainPart] = parts;

      // Local part: caractères alphanumériques, points, tirets, colons (multi-device) et underscores
      if (!/^[a-zA-Z0-9_.:-]+$/.test(localPart)) {
        return false;
      }

      const domain = domainPart.toLowerCase();
      return domain === 's.whatsapp.net' || domain === 'g.us' || domain === 'whatsapp.net';
    };

    // Heuristiques de détection
    const isWhatsApp = hasWhatsAppDomain(legacyId);
    let platform = 'cli';

    if (isWhatsApp) {
      platform = 'whatsapp';
    } else if (legacyId.includes('discord')) {
      platform = 'discord';
    } else if (legacyId.includes('telegram')) {
      platform = 'telegram';
    }

    const isGroup = determineIfGroup(legacyId, isWhatsApp);

    if (isGroup) {
      const id = await this.resolveGroup(platform, legacyId);
      return id ? { context_id: id, type: 'group' } : null;
    } else {
      const id = await this.resolveUser(platform, legacyId);
      return id ? { context_id: id, type: 'user' } : null;
    }
  },

  // =========================================================================
  // ADAPTATION DES FONCTIONS EXISTANTES (RETRO-COMPATIBLES)
  // =========================================================================

  /**
   * [EPISODIC MEMORY] Enregistre une action de l'agent
   */
  async logAction(
    chatId: string,
    toolName: string,
    params: Record<string, unknown>,
    result: Record<string, unknown>,
    isSuccess = true,
    errorMessage: string | null = null,
  ) {
    if (!supabase) return;
    const resolved = await this.resolveContextFromLegacyId(chatId);
    if (!resolved) return;

    try {
      await supabase.from('agent_actions').insert({
        context_id: resolved.context_id,
        tool_name: toolName,
        params,
        result,
        status: isSuccess ? 'success' : 'error',
        error_message: errorMessage,
      });
    } catch {
      // Silencieux si la table n'existe pas encore
    }
  },

  /**
   * Récupère la config avancée d'un groupe
   */
  async getGroupConfig(jid: string) {
    if (!supabase) return null;
    const resolved = await this.resolveContextFromLegacyId(jid);
    if (!resolved || resolved.type !== 'group') return null;

    const { data, error } = await supabase
      .from('group_configs')
      .select('*')
      .eq('group_id', resolved.context_id)
      .single();

    if (error && error.code !== 'PGRST116') {
      return null;
    }
    return data;
  },

  /**
   * Met à jour la config d'un groupe
   */
  async upsertGroupConfig(jid: string, config: Record<string, unknown>) {
    if (!supabase) return null;
    const resolved = await this.resolveContextFromLegacyId(jid);
    if (!resolved || resolved.type !== 'group') return null;

    const { data, error } = await supabase
      .from('group_configs')
      .upsert({
        group_id: resolved.context_id,
        ...config,
      })
      .select()
      .single();

    if (error) console.error('[DB] Erreur upsertGroupConfig:', error);
    return data;
  },

  /**
   * Crée un nouveau rappel
   */
  async createReminder(chatId: string, message: string, remindAt: Date) {
    if (!supabase) return null;
    const resolved = await this.resolveContextFromLegacyId(chatId);
    if (!resolved) return null;

    const { data, error } = await supabase
      .from('reminders')
      .insert({
        context_id: resolved.context_id,
        message,
        remind_at: remindAt.toISOString(),
        sent: false,
      })
      .select()
      .single();

    if (error) {
      console.error('[DB] Erreur createReminder:', error);
      throw error;
    }
    return data;
  },

  /**
   * Récupère les rappels en attente
   */
  async getPendingReminders() {
    if (!supabase) return [];

    const { data, error } = await supabase
      .from('reminders')
      .select('*')
      .eq('sent', false)
      .lte('remind_at', new Date().toISOString());

    if (error) console.error('[DB] Erreur getPendingReminders:', error);
    return data || [];
  },

  /**
   * Marque un rappel comme envoyé
   */
  async markReminderSent(reminderId: string) {
    if (!supabase) return;

    await supabase.from('reminders').update({ sent: true }).eq('id', reminderId);
  },

  /**
   * Reprogramme un rappel récurrent
   */
  async rescheduleReminder(reminderId: string, nextDate: Date) {
    if (!supabase) return;

    await supabase
      .from('reminders')
      .update({ remind_at: nextDate.toISOString(), sent: false })
      .eq('id', reminderId);
  },

  async getGroupFounder(groupJid: string) {
    if (!supabase) return null;
    const resolved = await this.resolveContextFromLegacyId(groupJid);
    if (!resolved || resolved.type !== 'group') return null;

    const { data, error } = await supabase
      .from('groups')
      .select('founder_id')
      .eq('id', resolved.context_id)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('[DB] Erreur getGroupFounder:', error);
    }

    if (!data?.founder_id) return null;

    // On va chercher l'ID brut pour la rétrocompatibilité
    const { data: idData } = await supabase
      .from('user_identities')
      .select('platform_user_id')
      .eq('user_id', data.founder_id)
      .single();

    return idData?.platform_user_id || null;
  },

  /**
   * Définit le fondateur d'un groupe
   */
  async setGroupFounder(groupJid: string, founderJid: string) {
    if (!supabase) return null;
    const groupRes = await this.resolveContextFromLegacyId(groupJid);
    const founderRes = await this.resolveContextFromLegacyId(founderJid);

    if (!groupRes || !founderRes || groupRes.type !== 'group' || founderRes.type !== 'user')
      return null;

    const { data, error } = await supabase
      .from('groups')
      .update({ founder_id: founderRes.context_id })
      .eq('id', groupRes.context_id)
      .select()
      .single();

    if (error) console.error('[DB] Erreur setGroupFounder:', error);
    return data;
  },

  /**
   * Récupère l'historique d'un membre dans un groupe
   */
  async getMemberHistory(groupJid: string, userJid: string) {
    if (!supabase) return [];
    const groupRes = await this.resolveContextFromLegacyId(groupJid);
    const userRes = await this.resolveContextFromLegacyId(userJid);

    if (!groupRes || !userRes) return [];

    const { data, error } = await supabase
      .from('group_member_history')
      .select('*')
      .eq('group_id', groupRes.context_id)
      .eq('user_id', userRes.context_id)
      .order('created_at', { ascending: false });

    if (error) console.error('[DB] Erreur getMemberHistory:', error);
    return data || [];
  },

  /**
   * Enregistre un événement de membre de groupe (join, leave, etc.)
   */
  async recordMemberEvent(groupJid: string, userJid: string, action: string) {
    if (!supabase) return null;
    const groupRes = await this.resolveContextFromLegacyId(groupJid);
    const userRes = await this.resolveContextFromLegacyId(userJid);

    if (!groupRes || !userRes) return null;

    const { data, error } = await supabase
      .from('group_member_history')
      .insert({
        group_id: groupRes.context_id,
        user_id: userRes.context_id,
        action,
      })
      .select()
      .single();

    if (error) console.error('[DB] Erreur recordMemberEvent:', error);
    return data;
  },

  /**
   * Vérifie si un utilisateur a déjà quitté le groupe
   */
  async hasLeftBefore(groupJid: string, userJid: string) {
    const history = await this.getMemberHistory(groupJid, userJid);
    return history.some((event) => event.action === 'remove');
  },

  /**
   * Vérifie l'état de santé de Supabase
   */
  async checkHealth(): Promise<HealthCheckResult> {
    if (!supabase) {
      return { status: 'disconnected', error: 'Supabase client not initialized' };
    }
    try {
      const start = Date.now();
      const { count, error } = await supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .limit(1);

      if (error) throw error;
      return { status: 'connected', latency: `${Date.now() - start}ms`, userCount: count };
    } catch (error: unknown) {
      return { status: 'error', error: extractErrorMessage(error) };
    }
  },
};

export { supabase };
export default db;
