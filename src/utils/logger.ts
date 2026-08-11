/**
 * utils/logger.ts
 * Système de logging centralisé avec contrôle du debug et commandes admin
 */

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
} as const;

export type LogLevel = 'INFO' | '✓' | 'WARN' | 'ERROR' | 'DEBUG';
export type DebugCategory =
  'all' | 'mention' | 'authority' | 'social' | 'ban' | 'router' | 'admin' | 'kimi' | string;

interface DebugState {
  enabled: boolean;
  categories: Set<DebugCategory>;
  verbose: boolean;
}

const debugState: DebugState = {
  enabled: process.env.DEBUG === 'true',
  categories: new Set(['all']),
  verbose: false,
};

// ============================================================
// CLASSE LOGGER
// ============================================================

export class Logger {
  private prefix: string;

  constructor(prefix: string = '') {
    this.prefix = prefix;
  }

  private _timestamp(): string {
    return new Date().toISOString().substring(11, 19);
  }

  private _format(level: LogLevel, color: string, message: unknown, ...args: unknown[]): void {
    const ts = this._timestamp();
    const pre = this.prefix ? `[${this.prefix}]` : '';
    console.log('%s[%s] %s%s%s', color, ts, level, pre, COLORS.reset, message, ...args);
  }

  public info(message: unknown, ...args: unknown[]): void {
    this._format('INFO', COLORS.cyan, message, ...args);
  }

  public success(message: unknown, ...args: unknown[]): void {
    this._format('✓', COLORS.green, message, ...args);
  }

  public warn(message: unknown, ...args: unknown[]): void {
    this._format('WARN', COLORS.yellow, message, ...args);
  }

  public error(message: unknown, ...args: unknown[]): void {
    this._format('ERROR', COLORS.red, message, ...args);
  }

  public debug(category: DebugCategory, message: unknown, ...args: unknown[]): void {
    if (!debugState.enabled) return;
    if (!debugState.categories.has('all') && !debugState.categories.has(category)) return;

    const ts = this._timestamp();
    const pre = this.prefix ? `[${this.prefix}]` : '';
    console.log(
      '%s[%s] DEBUG:%s%s%s',
      COLORS.magenta,
      ts,
      category.toUpperCase(),
      pre,
      COLORS.reset,
      message,
      ...args,
    );
  }

  public child(prefix: string): Logger {
    return new Logger(this.prefix ? `${this.prefix}:${prefix}` : prefix);
  }
}

// ============================================================
// COMMANDES DEBUG
// ============================================================

export function enableDebug(): boolean {
  debugState.enabled = true;
  console.log('✅ [Logger] Mode DEBUG activé');
  return true;
}

export function disableDebug(): boolean {
  debugState.enabled = false;
  console.log('🔇 [Logger] Mode DEBUG désactivé');
  return true;
}

export function setDebugCategories(categories: DebugCategory[]): boolean {
  debugState.categories = new Set(categories);
  console.log(`🔧 [Logger] Catégories actives: ${categories.join(', ')}`);
  return true;
}

export function resetDebug(): boolean {
  debugState.enabled = true;
  debugState.categories = new Set(['all']);
  console.log('🔄 [Logger] Debug réinitialisé');
  return true;
}

export function debugStatus(): { enabled: boolean; categories: DebugCategory[]; verbose: boolean } {
  return {
    enabled: debugState.enabled,
    categories: Array.from(debugState.categories),
    verbose: debugState.verbose,
  };
}

// ============================================================
// COMMANDES REDIS
// ============================================================

interface RedisClient {
  del(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  ping(): Promise<string>;
}

export async function clearGroupCache(
  redis: RedisClient | null,
  groupJid: string,
): Promise<{ success: boolean; error?: string }> {
  if (!redis) return { success: false, error: 'Redis non disponible' };

  try {
    const keys = [`group:${groupJid}:meta`, `group:${groupJid}:context`];
    for (const key of keys) await redis.del(key);
    console.log(`✅ [Logger] Cache groupe effacé: ${groupJid}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function flushRedisCache(
  redis: RedisClient | null,
): Promise<{ success: boolean; keysDeleted?: number; error?: string }> {
  if (!redis) return { success: false, error: 'Redis non disponible' };

  try {
    const groupKeys = await redis.keys('group:*');
    const userKeys = await redis.keys('user:*');
    const wmKeys = await redis.keys('wm:*');
    const allKeys = [...groupKeys, ...userKeys, ...wmKeys];

    for (const key of allKeys) await redis.del(key);
    console.log(`✅ [Logger] Cache Redis nettoyé: ${allKeys.length} clés`);
    return { success: true, keysDeleted: allKeys.length };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function redisStats(redis: RedisClient | null): Promise<{
  groups?: number;
  users?: number;
  workingMemory?: number;
  total?: number;
  error?: string;
}> {
  if (!redis) return { error: 'Redis non disponible' };

  try {
    const groups = (await redis.keys('group:*')).length;
    const users = (await redis.keys('user:*')).length;
    const wm = (await redis.keys('wm:*')).length;
    return { groups, users, workingMemory: wm, total: groups + users + wm };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

// ============================================================
// COMMANDES ADMIN
// ============================================================

interface AdminService {
  refresh(): Promise<boolean | void>;
  getCacheSize?: () => number;
}

export async function refreshAdminCache(adminService: AdminService | null): Promise<boolean> {
  if (!adminService) return false;
  try {
    await adminService.refresh();
    console.log('✅ [Logger] Cache admin rafraîchi');
    return true;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('❌ [Logger] Erreur refreshAdminCache:', errorMsg);
    return false;
  }
}

export async function systemStatus(
  services: { redis?: RedisClient; adminService?: AdminService } = {},
): Promise<Record<string, unknown>> {
  const status = {
    timestamp: new Date().toISOString(),
    debug: debugStatus(),
    services: {} as Record<string, string>,
    redisStats: undefined as unknown,
  };

  if (services.redis) {
    try {
      await services.redis.ping();
      status.services.redis = '✅ OK';
      status.redisStats = await redisStats(services.redis);
    } catch {
      status.services.redis = '❌ Déconnecté';
    }
  }

  if (services.adminService && typeof services.adminService.getCacheSize === 'function') {
    status.services.adminCache = `${services.adminService.getCacheSize()} admin(s)`;
  }

  return status;
}

export function help(): void {
  console.log(`
📋 COMMANDES LOGGER DISPONIBLES:

🔧 DEBUG:
   enableDebug()                    → Active les logs DEBUG
   disableDebug()                   → Désactive les logs DEBUG
   debugStatus()                    → État actuel
   resetDebug()                     → Réinitialise
   setDebugCategories(['mention'])  → Filtre par catégorie

🗄️ REDIS:
   clearGroupCache(redis, "jid@g.us")  → Efface cache d'un groupe
   flushRedisCache(redis)              → ⚠️ Efface TOUT le cache
   redisStats(redis)                   → Statistiques

👑 ADMIN:
   refreshAdminCache(adminService)     → Refresh cache admin

📊 SYSTÈME:
   systemStatus({ redis, adminService })
   
🛑 BASE DE DONNÉES:
   npm run cli db:reset-data         → ⚠️ VIDE toutes les données (Sauf Global Admins)
`);
}

export const logger = new Logger();
export default Logger;
