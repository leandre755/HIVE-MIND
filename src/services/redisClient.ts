// services/redisClient.js
// Client Redis partagé pour tous les services
// Évite les connexions multiples (limite Redis Cloud = 30 connexions)

import { createClient } from 'redis';
import { safeReadFileSync } from '../utils/safeFs.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

// Chargement sécurisé de l'URL depuis les credentials
const getRedisUrl = (): string => {
  try {
    const creds = JSON.parse(
      safeReadFileSync(join(__dirname, '..', 'config', 'credentials.json'), 'utf-8'),
    );
    let url: string | undefined = creds.redis?.url;

    // Si la valeur est un nom de variable d'environnement (pas une URL), la résoudre
    if (url && !url.startsWith('redis://') && !url.startsWith('rediss://')) {
      // C'est probablement un nom de variable comme "REDIS_URL" ou "VOTRE_LIEN_REDIS"
      const envUrl = Object.hasOwn(process.env, url) ? Reflect.get(process.env, url) : undefined;
      url =
        (typeof envUrl === 'string' && envUrl ? envUrl : undefined) ||
        process.env.REDIS_URL ||
        'redis://localhost:6379';
    }

    // Fallback si pas de valeur
    if (!url) {
      url = process.env.REDIS_URL || 'redis://localhost:6379';
    }

    // Sanitize: remove any stray quotes from URL (common .env parsing issue)
    return url.replace(/["']/g, '').trim();
  } catch (e: unknown) {
    console.warn(
      '[Redis] Impossible de lire credentials.json, repli sur localhost',
      extractErrorMessage(e),
    );
    return process.env.REDIS_URL || 'redis://localhost:6379';
  }
};

// Client Redis unique (singleton)
const redis = createClient({
  url: getRedisUrl(),
  socket: {
    connectTimeout: 15000, // 15s (Augmenté pour les Cold Starts Redis Cloud)
    keepAlive: true, // Ping TCP pour éviter la coupure silencieuse
    keepAliveInitialDelay: 10000, // 10s
    tls: false, // Explicitement désactivé pour le port 10xxx standard
    reconnectStrategy: (retries) => {
      if (process.env.APP_ENV === 'local' || retries > 1) {
        // Abandonner immédiatement en local pour basculer sur le mock in-memory
        return new Error('Redis : Abandon de connexion en mode local');
      }
      if (retries > 20) {
        console.error('[Redis] ❌ Echec critique: Trop de tentatives de reconnexion.');
        return new Error('Redis : Nombre maximal de tentatives atteint');
      }
      const delay = Math.min(retries * 500, 5000);
      console.log(`[Redis] Reconnexion tentative ${retries} dans ${delay}ms...`);
      return delay;
    },
  },
});

// Event handlers
redis.on('error', (err) => console.error('[Redis] Erreur Connexion:', err.message));
redis.on('connect', () => {
  /* Connexion silencieuse */
});
redis.on('reconnecting', () => console.log('[Redis] Reconnexion en cours...'));

// Connexion asynchrone
let connectionPromise: Promise<void> | null = null;

/**
 * Assure que Redis est connecté avant toute opération
 */
const ensureConnected = async (): Promise<void> => {
  if (redis.isOpen) return;

  if (!connectionPromise) {
    connectionPromise = redis
      .connect()
      .then(() => {})
      .catch((err: unknown) => {
        console.warn(
          '[Redis] ⚠️ Connexion impossible. Basculement transparent en mode Mock In-Memory pour ce cycle local:',
          extractErrorMessage(err),
        );
        switchToMock(redis);
        connectionPromise = Promise.resolve();
      });
  }

  await connectionPromise;
};

// Connexion au démarrage supprimée pour éviter les side-effects.
// Le client doit être connecté explicitement par l'application (via botCore.init ou container.init).

/**
 * Vérifie l'état de santé de Redis
 */
const checkHealth = async () => {
  if (!redis.isOpen) {
    return { status: 'disconnected', error: 'Client not open' };
  }
  try {
    const start = Date.now();
    await redis.ping();
    const latency = Date.now() - start;

    const info = await redis.info('memory');
    const usedMemory = info.match(/used_memory_human:(\S+)/)?.[1] || 'unknown';
    const connectedClients = info.match(/connected_clients:(\d+)/)?.[1] || 'unknown';

    return {
      status: 'connected',
      latency: `${latency}ms`,
      memory: usedMemory,
      clients: connectedClients,
    };
  } catch (e: unknown) {
    return { status: 'error', error: extractErrorMessage(e) };
  }
};

/**
 * Ferme proprement la connexion Redis
 */
const disconnect = async (): Promise<void> => {
  connectionPromise = null;
  if (redis.isOpen) {
    try {
      await redis.quit();
    } catch {
      // Ignorer les erreurs de fermeture
    }
    console.log('[Redis] Connexion fermée proprement');
  }
};

// =========================================================================
// MOCK REDIS IN-MEMORY FALLBACK (Pour les tests locaux sans serveur Redis)
// =========================================================================

interface StorageEntry {
  value: string;
  expiresAt: number | null;
}

interface MockSetOptions {
  EX?: number;
}

class InMemoryRedisMock {
  storage = new Map<string, StorageEntry>();
  hashes = new Map<string, Map<string, string>>();
  sets = new Map<string, Set<string>>();
  sortedSets = new Map<string, Map<string, number>>();
  isOpen = true;
  isReady = true;

  private _isExpired(entry: StorageEntry | undefined): boolean {
    if (!entry || entry.expiresAt === null) return false;
    return Date.now() > entry.expiresAt;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.storage.get(key);
    if (this._isExpired(entry)) {
      this.storage.delete(key);
      return null;
    }
    return entry ? String(entry.value) : null;
  }

  async set(key: string, value: string, options: MockSetOptions = {}): Promise<string> {
    let expiresAt: number | null = null;
    if (options.EX) {
      expiresAt = Date.now() + options.EX * 1000;
    }
    this.storage.set(key, { value, expiresAt });
    return 'OK';
  }

  async setEx(key: string, seconds: number, value: string): Promise<string> {
    this.storage.set(key, { value, expiresAt: Date.now() + seconds * 1000 });
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.storage.delete(key) ? 1 : 0;
  }

  async keys(pattern: string): Promise<string[]> {
    const results: string[] = [];
    const isMatch = (key: string): boolean => {
      if (pattern === '*') return true;
      if (pattern.endsWith('*') && !pattern.slice(0, -1).includes('*')) {
        return key.startsWith(pattern.slice(0, -1));
      }
      const parts = pattern.split('*');
      return key.startsWith(parts[0]) && key.endsWith(parts[parts.length - 1]);
    };

    for (const [key, entry] of this.storage.entries()) {
      if (this._isExpired(entry)) {
        this.storage.delete(key);
        continue;
      }
      if (isMatch(key)) {
        results.push(key);
      }
    }
    return results;
  }

  async incr(key: string): Promise<number> {
    const val = await this.get(key);
    const next = parseInt(val || '0') + 1;
    this.storage.set(key, {
      value: String(next),
      expiresAt: this.storage.get(key)?.expiresAt || null,
    });
    return next;
  }

  async incrBy(key: string, value: number): Promise<number> {
    const val = await this.get(key);
    const next = parseInt(val || '0') + value;
    this.storage.set(key, {
      value: String(next),
      expiresAt: this.storage.get(key)?.expiresAt || null,
    });
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const entry = this.storage.get(key);
    if (entry) {
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    }
    return 0;
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async info(): Promise<string> {
    return 'used_memory_human:1MB connected_clients:1';
  }

  async quit(): Promise<void> {
    this.isOpen = false;
    this.isReady = false;
  }

  async lPush(key: string, value: string): Promise<number> {
    const entry = this.storage.get(key);
    const list: string[] = entry ? JSON.parse(entry.value) : [];
    list.unshift(value);
    this.storage.set(key, { value: JSON.stringify(list), expiresAt: entry?.expiresAt || null });
    return list.length;
  }

  async rPop(key: string): Promise<string | null> {
    const entry = this.storage.get(key);
    if (!entry) return null;
    const list: string[] = JSON.parse(entry.value);
    const item = list.pop();
    this.storage.set(key, { value: JSON.stringify(list), expiresAt: entry.expiresAt });
    return item || null;
  }

  async lRem(_key: string, _count: number, _value: string): Promise<number> {
    const entry = this.storage.get(_key);
    if (!entry) return 0;
    const list = JSON.parse(entry.value) as string[];
    let removed = 0;
    const filtered = list.filter((item) => {
      if (item === _value) {
        removed++;
        return false;
      }
      return true;
    });
    this.storage.set(_key, { value: JSON.stringify(filtered), expiresAt: entry.expiresAt });
    return removed;
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    const entry = this.storage.get(key);
    if (!entry) return [];
    const list = JSON.parse(entry.value) as string[];
    const actualStop = stop === -1 ? list.length : stop + 1;
    return list.slice(start, actualStop);
  }

  async exists(key: string): Promise<number> {
    if (this.storage.has(key)) return 1;
    if (this.hashes.has(key)) return 1;
    if (this.sets.has(key)) return 1;
    if (this.sortedSets.has(key)) return 1;
    return 0;
  }

  async hGet(key: string, field: string): Promise<string | null> {
    const hash = this.hashes.get(key);
    return hash?.get(field) ?? null;
  }

  async hSet(
    key: string,
    fieldOrObj: string | Record<string, unknown>,
    value?: unknown,
  ): Promise<number> {
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map<string, string>();
      this.hashes.set(key, hash);
    }
    let count = 0;
    if (typeof fieldOrObj === 'object' && fieldOrObj !== null) {
      for (const [k, v] of Object.entries(fieldOrObj)) {
        if (!hash.has(k)) count++;
        hash.set(k, String(v));
      }
    } else if (typeof fieldOrObj === 'string' && value !== undefined) {
      if (!hash.has(fieldOrObj)) count++;
      hash.set(fieldOrObj, String(value));
    }
    return count;
  }

  async hGetAll(key: string): Promise<Record<string, string>> {
    const hash = this.hashes.get(key);
    if (!hash) return {};
    const res: Record<string, string> = {};
    for (const [k, v] of hash.entries()) {
      Reflect.set(res, k, v);
    }
    return res;
  }

  async hIncrBy(key: string, field: string, increment: number): Promise<number> {
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map<string, string>();
      this.hashes.set(key, hash);
    }
    const current = parseInt(hash.get(field) || '0', 10);
    const next = current + increment;
    hash.set(field, String(next));
    return next;
  }

  async sAdd(key: string, members: string | string[]): Promise<number> {
    let set = this.sets.get(key);
    if (!set) {
      set = new Set<string>();
      this.sets.set(key, set);
    }
    const items = Array.isArray(members) ? members : [members];
    let added = 0;
    for (const item of items) {
      if (!set.has(item)) {
        set.add(item);
        added++;
      }
    }
    return added;
  }

  async sPop(key: string): Promise<string | null> {
    const set = this.sets.get(key);
    if (!set || set.size === 0) return null;
    const first = set.values().next().value;
    if (first !== undefined) {
      set.delete(first);
      return first;
    }
    return null;
  }

  async sPopCount(key: string, count: number): Promise<string[]> {
    const set = this.sets.get(key);
    if (!set || set.size === 0) return [];
    const popped: string[] = [];
    for (const val of Array.from(set)) {
      if (popped.length >= count) break;
      set.delete(val);
      popped.push(val);
    }
    return popped;
  }

  async sMembers(key: string): Promise<string[]> {
    const set = this.sets.get(key);
    return set ? Array.from(set) : [];
  }

  async sRem(key: string, members: string | string[]): Promise<number> {
    const set = this.sets.get(key);
    if (!set) return 0;
    const items = Array.isArray(members) ? members : [members];
    let removed = 0;
    for (const item of items) {
      if (set.delete(item)) removed++;
    }
    return removed;
  }

  async zIncrBy(key: string, increment: number, member: string): Promise<number> {
    let zset = this.sortedSets.get(key);
    if (!zset) {
      zset = new Map<string, number>();
      this.sortedSets.set(key, zset);
    }
    const current = zset.get(member) || 0;
    const next = current + increment;
    zset.set(member, next);
    return next;
  }

  async zRangeWithScores(
    key: string,
    start: number,
    stop: number,
    options?: { REV?: boolean },
  ): Promise<Array<{ value: string; score: number }>> {
    const zset = this.sortedSets.get(key);
    if (!zset) return [];
    const entries = Array.from(zset.entries()).map(([value, score]) => ({ value, score }));
    entries.sort((a, b) => (options?.REV ? b.score - a.score : a.score - b.score));
    const actualStop = stop === -1 ? entries.length : stop + 1;
    return entries.slice(start, actualStop);
  }

  async zScore(key: string, member: string): Promise<number | null> {
    const zset = this.sortedSets.get(key);
    return zset?.has(member) ? (zset.get(member) ?? null) : null;
  }

  multi() {
    const queue: Array<() => Promise<unknown>> = [];
    const incrBound = this.incr.bind(this);
    const expireBound = this.expire.bind(this);
    const incrByBound = this.incrBy.bind(this);
    const hIncrByBound = this.hIncrBy.bind(this);
    const hSetBound = this.hSet.bind(this);
    const sAddBound = this.sAdd.bind(this);
    const hGetAllBound = this.hGetAll.bind(this);
    return {
      incr(key: string) {
        queue.push(() => incrBound(key));
        return this;
      },
      expire(key: string, seconds: number) {
        queue.push(() => expireBound(key, seconds));
        return this;
      },
      incrBy(key: string, value: number) {
        queue.push(() => incrByBound(key, value));
        return this;
      },
      hIncrBy(key: string, field: string, increment: number) {
        queue.push(() => hIncrByBound(key, field, increment));
        return this;
      },
      hSet(key: string, fieldOrObj: string | Record<string, unknown>, value?: unknown) {
        queue.push(() => hSetBound(key, fieldOrObj, value));
        return this;
      },
      sAdd(key: string, members: string | string[]) {
        queue.push(() => sAddBound(key, members));
        return this;
      },
      hGetAll(key: string) {
        queue.push(() => hGetAllBound(key));
        return this;
      },
      async exec(): Promise<unknown[]> {
        const results: unknown[] = [];
        for (const op of queue) {
          results.push(await op());
        }
        return results;
      },
    };
  }
}

function switchToMock(redisInstance: typeof redis): void {
  const mock = new InMemoryRedisMock();

  Object.defineProperty(redisInstance, 'isOpen', { get: () => mock.isOpen, configurable: true });
  Object.defineProperty(redisInstance, 'isReady', { get: () => mock.isReady, configurable: true });

  const target = redisInstance as unknown as Record<string, unknown>;
  target.get = mock.get.bind(mock);
  target.set = mock.set.bind(mock);
  target.setEx = mock.setEx.bind(mock);
  target.del = mock.del.bind(mock);
  target.keys = mock.keys.bind(mock);
  target.incr = mock.incr.bind(mock);
  target.incrBy = mock.incrBy.bind(mock);
  target.expire = mock.expire.bind(mock);
  target.ping = mock.ping.bind(mock);
  target.info = mock.info.bind(mock);
  target.quit = mock.quit.bind(mock);
  target.lPush = mock.lPush.bind(mock);
  target.rPop = mock.rPop.bind(mock);
  target.lRem = mock.lRem.bind(mock);
  target.lRange = mock.lRange.bind(mock);
  target.exists = mock.exists.bind(mock);
  target.hGet = mock.hGet.bind(mock);
  target.hSet = mock.hSet.bind(mock);
  target.hGetAll = mock.hGetAll.bind(mock);
  target.hIncrBy = mock.hIncrBy.bind(mock);
  target.sAdd = mock.sAdd.bind(mock);
  target.sPop = mock.sPop.bind(mock);
  target.sPopCount = mock.sPopCount.bind(mock);
  target.sMembers = mock.sMembers.bind(mock);
  target.sRem = mock.sRem.bind(mock);
  target.zIncrBy = mock.zIncrBy.bind(mock);
  target.zRangeWithScores = mock.zRangeWithScores.bind(mock);
  target.zScore = mock.zScore.bind(mock);
  target.multi = mock.multi.bind(mock);
}

export { redis, ensureConnected, checkHealth, disconnect };
export default redis;
