// services/adminService.js
// Service sécurisé pour les admins globaux (DTC Phase 1)
// Source de vérité: Supabase global_admins
// Cache RAM avec refresh automatique

import { supabase, default as db } from './supabase.js';
import { Logger } from '../utils/logger.js';

const log = new Logger('AdminService');

type AdminRole = 'owner' | 'moderator';

interface AdminRow {
  id: string;
  user_id: string;
  role: AdminRole;
  created_at: string;
  users?: { username?: string };
}

interface ResolvedContext {
  context_id: string;
  type: 'user' | 'group';
}

interface UserServiceLike {
  resolveLid: (jid: string) => Promise<string | null>;
}

interface ContainerLike {
  get: (name: string) => UserServiceLike | undefined;
}

const adminCache = new Map<string, AdminRole>();
const REFRESH_INTERVAL = 10 * 60 * 1000;
let refreshIntervalId: ReturnType<typeof setInterval> | null = null;

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

/**
 * Service d'administration globale
 */
export const adminService = {
  container: null as ContainerLike | null,

  setContainer(container: ContainerLike) {
    this.container = container;
  },

  get userService(): UserServiceLike | undefined {
    return this.container?.get('userService');
  },

  async init() {
    const initialRefresh = async () => {
      const success = await this.refresh();
      if (!success) {
        console.log('[AdminService] Retry refresh in 5s...');
        setTimeout(initialRefresh, 5000);
      }
    };
    await initialRefresh();

    // Stocker la référence de l'intervalle pour permettre le nettoyage (prévention fuite mémoire)
    if (refreshIntervalId !== null) {
      clearInterval(refreshIntervalId);
    }
    refreshIntervalId = setInterval(() => {
      this.refresh().catch(console.error);
    }, REFRESH_INTERVAL);
  },

  destroy() {
    if (refreshIntervalId !== null) {
      clearInterval(refreshIntervalId);
      refreshIntervalId = null;
    }
  },

  async refresh(): Promise<boolean> {
    if (!supabase) return false;

    try {
      const { data, error } = await supabase.from('global_admins').select('user_id, role');

      if (error) {
        console.error('[AdminService] Erreur refresh:', error);
        return false;
      }

      adminCache.clear();
      data.forEach((a: { user_id: string; role?: string }) =>
        adminCache.set(a.user_id, (a.role as AdminRole) || 'moderator'),
      );
      return true;
    } catch (error: unknown) {
      console.error('[AdminService] Erreur refresh:', extractErrorMessage(error));
      return false;
    }
  },

  async isGlobalAdmin(jid: string): Promise<boolean> {
    if (!jid) return false;

    let resolvedJid = jid;
    if (this.userService) {
      resolvedJid = (await this.userService.resolveLid(jid)) || jid;
    }

    const resolved: ResolvedContext | null = await db.resolveContextFromLegacyId(resolvedJid);
    if (!resolved || resolved.type !== 'user') return false;

    const role = adminCache.get(resolved.context_id);
    if (role) {
      log.success(`GlobalAdmin match: ${resolvedJid} ↔ UUID`);
    }
    return !!role;
  },

  async isSuperUser(jid: string): Promise<boolean> {
    if (!jid) return false;

    let resolvedJid = jid;
    if (this.userService) {
      resolvedJid = (await this.userService.resolveLid(jid)) || jid;
    }

    const resolved: ResolvedContext | null = await db.resolveContextFromLegacyId(resolvedJid);
    if (!resolved || resolved.type !== 'user') return false;

    const role = adminCache.get(resolved.context_id);
    if (role === 'owner') {
      log.success(`SuperUser match: ${resolvedJid} ↔ UUID`);
      return true;
    }
    return false;
  },

  async addAdmin(
    jid: string,
    name: string | null = null,
    role: AdminRole = 'moderator',
  ): Promise<boolean> {
    if (!supabase) return false;

    try {
      const resolved: ResolvedContext | null = await db.resolveContextFromLegacyId(jid);
      if (!resolved || resolved.type !== 'user') return false;

      if (name) {
        await supabase.from('users').update({ username: name }).eq('id', resolved.context_id);
      }

      const { error } = await supabase
        .from('global_admins')
        .upsert({ user_id: resolved.context_id, role });

      if (error) {
        log.error('Erreur addAdmin:', error);
        return false;
      }

      adminCache.set(resolved.context_id, role);
      log.success(`Admin ajouté: ${jid}`);
      return true;
    } catch (error: unknown) {
      log.error('Erreur addAdmin:', extractErrorMessage(error));
      return false;
    }
  },

  async removeAdmin(jid: string): Promise<boolean> {
    if (!supabase) return false;

    try {
      const resolved: ResolvedContext | null = await db.resolveContextFromLegacyId(jid);
      if (!resolved || resolved.type !== 'user') return false;

      const { error } = await supabase
        .from('global_admins')
        .delete()
        .eq('user_id', resolved.context_id);

      if (error) {
        log.error('Erreur removeAdmin:', error);
        return false;
      }

      adminCache.delete(resolved.context_id);
      log.info(`Admin retiré: ${jid}`);
      return true;
    } catch (error: unknown) {
      console.error('[AdminService] Erreur removeAdmin:', extractErrorMessage(error));
      return false;
    }
  },

  async listAdmins() {
    if (!supabase) return [];

    try {
      const { data, error } = await supabase
        .from('global_admins')
        .select('*, users(username)')
        .order('created_at', { ascending: true });

      if (error) {
        console.error('[AdminService] Erreur listAdmins:', error);
        return [];
      }

      return (data || []).map((row: AdminRow) => ({
        id: row.id,
        user_id: row.user_id,
        name: row.users?.username || 'Unknown',
        role: row.role,
        created_at: row.created_at,
      }));
    } catch (error: unknown) {
      console.error('[AdminService] Erreur listAdmins:', extractErrorMessage(error));
      return [];
    }
  },

  getCacheSize(): number {
    return adminCache.size;
  },

  /**
   * Resolves the platform JID of the global admin with role='owner'.
   * WHY: Used by PermissionManager HITL to route permission requests
   * to the bot creator/deployer instead of a hardcoded env var.
   * This prevents a moderator-level global admin from self-approving
   * dangerous actions in groups that aren't theirs.
   */
  async getOwnerJid(): Promise<string | null> {
    if (!supabase) return null;

    let ownerUserId: string | null = null;
    for (const [userId, role] of adminCache.entries()) {
      if (role === 'owner') {
        ownerUserId = userId;
        break;
      }
    }

    if (!ownerUserId) {
      console.warn('[AdminService] ⚠️ No owner found in global_admins cache');
      return null;
    }

    try {
      const { data, error } = await supabase
        .from('user_identities')
        .select('platform_user_id')
        .eq('user_id', ownerUserId)
        .limit(1)
        .single();

      if (error || !data) {
        console.warn('[AdminService] ⚠️ Could not resolve owner JID from UUID:', ownerUserId);
        return null;
      }

      return data.platform_user_id as string;
    } catch (error: unknown) {
      console.error('[AdminService] ❌ Error resolving owner JID:', extractErrorMessage(error));
      return null;
    }
  },
};

export default adminService;
