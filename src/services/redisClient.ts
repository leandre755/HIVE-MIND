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
  PX?: number;
  EXAT?: number;
  PXAT?: number;
  NX?: boolean;
  XX?: boolean;
  KEEPTTL?: boolean;
}

interface ZMember {
  score: number;
  value: string;
}

interface EvalOptions {
  keys?: string[];
  arguments?: string[];
}

interface MockMulti {
  incr(key: string): MockMulti;
  incrBy(key: string, value: number): MockMulti;
  expire(key: string, seconds: number): MockMulti;
  del(...keys: string[]): MockMulti;
  set(key: string, value: string, options?: MockSetOptions): MockMulti;
  setEx(key: string, seconds: number, value: string): MockMulti;
  hSet(key: string, fieldOrObj: string | Record<string, unknown>, value?: unknown): MockMulti;
  hGet(key: string, field: string): MockMulti;
  hGetAll(key: string): MockMulti;
  hIncrBy(key: string, field: string, increment: number): MockMulti;
  hDel(key: string, ...fields: (string | string[])[]): MockMulti;
  hLen(key: string): MockMulti;
  sAdd(key: string, members: unknown | unknown[]): MockMulti;
  sRem(key: string, members: unknown | unknown[]): MockMulti;
  sMembers(key: string): MockMulti;
  sCard(key: string): MockMulti;
  sPopCount(key: string, count: number): MockMulti;
  rPush(key: string, ...values: unknown[]): MockMulti;
  lPush(key: string, ...values: unknown[]): MockMulti;
  lTrim(key: string, start: number, stop: number): MockMulti;
  lRange(key: string, start: number, stop: number): MockMulti;
  lLen(key: string): MockMulti;
  zAdd(
    key: string,
    memberOrScore: unknown,
    memberOrOptions?: unknown,
    options?: unknown,
  ): MockMulti;
  zCard(key: string): MockMulti;
  zIncrBy(key: string, increment: number, member: string): MockMulti;
  zRangeWithScores(
    key: string,
    start: number,
    stop: number,
    options?: { REV?: boolean },
  ): MockMulti;
  zRangeByScore(
    key: string,
    min: number | string,
    max: number | string,
    options?: unknown,
  ): MockMulti;
  zRemRangeByScore(key: string, min: number | string, max: number | string): MockMulti;
  exec(): Promise<unknown[]>;
}

function parseScoreBound(bound: number | string): { val: number; inclusive: boolean } {
  if (typeof bound === 'number') {
    return { val: bound, inclusive: true };
  }
  const str = String(bound).trim();
  if (str === '-inf' || str === '-Infinity') {
    return { val: -Infinity, inclusive: true };
  }
  if (str === '+inf' || str === '+Infinity' || str === 'inf' || str === 'Infinity') {
    return { val: Infinity, inclusive: true };
  }
  if (str.startsWith('(')) {
    return { val: parseFloat(str.slice(1)), inclusive: false };
  }
  return { val: parseFloat(str), inclusive: true };
}

function extractEvalArgs(
  optionsOrNumKeys?: EvalOptions | number,
  restArgs: unknown[] = [],
): { keys: string[]; args: string[] } {
  if (optionsOrNumKeys && typeof optionsOrNumKeys === 'object') {
    return {
      keys: optionsOrNumKeys.keys ? optionsOrNumKeys.keys.map(String) : [],
      args: optionsOrNumKeys.arguments ? optionsOrNumKeys.arguments.map(String) : [],
    };
  }
  if (typeof optionsOrNumKeys === 'number') {
    const allArgs = restArgs.map(String);
    return {
      keys: allArgs.slice(0, optionsOrNumKeys),
      args: allArgs.slice(optionsOrNumKeys),
    };
  }
  return { keys: [], args: [] };
}

function isLockReleaseScript(normalizedScript: string): boolean {
  const hasGet =
    normalizedScript.includes('redis.call("get"') || normalizedScript.includes("redis.call('get'");
  const hasDel =
    normalizedScript.includes('redis.call("del"') || normalizedScript.includes("redis.call('del'");
  return hasGet && hasDel;
}

function parseSimpleRedisCall(script: string): { command: string; rawArgs: string[] } | null {
  const prefix = 'return redis.call(';
  const idx = script.indexOf(prefix);
  if (idx === -1) return null;
  const closeParen = script.indexOf(')', idx + prefix.length);
  if (closeParen === -1) return null;
  const inside = script.slice(idx + prefix.length, closeParen);
  const parts = inside.split(',').map((p) => p.trim());
  if (parts.length === 0) return null;
  const command = (parts.at(0) || '').replace(/^['"]|['"]$/g, '').toLowerCase();
  const rawArgs = parts.slice(1);
  return { command, rawArgs };
}

function resolveScriptArg(arg: string, keys: string[], args: string[]): string {
  const trimmed = arg.trim();
  const keyMatch = /^keys\[(\d+)\]$/i.exec(trimmed);
  if (keyMatch) {
    const idx = parseInt(keyMatch.at(1) || '1', 10) - 1;
    return keys.at(idx) ?? '';
  }
  const argvMatch = /^argv\[(\d+)\]$/i.exec(trimmed);
  if (argvMatch) {
    const idx = parseInt(argvMatch.at(1) || '1', 10) - 1;
    return args.at(idx) ?? '';
  }
  return trimmed.replace(/^['"]|['"]$/g, '');
}

class InMemoryRedisMock {
  storage = new Map<string, StorageEntry>();
  hashes = new Map<string, Map<string, string>>();
  sets = new Map<string, Set<string>>();
  sortedSets = new Map<string, Map<string, number>>();
  hashExpiries = new Map<string, number | null>();
  setExpiries = new Map<string, number | null>();
  sortedSetExpiries = new Map<string, number | null>();
  isOpen = true;
  isReady = true;

  private _isExpired(expiresAt: number | null | undefined): boolean {
    if (expiresAt === null || expiresAt === undefined) return false;
    return Date.now() > expiresAt;
  }

  private _checkCollectionExists<T>(
    map: Map<string, T>,
    expiries: Map<string, number | null>,
    key: string,
  ): boolean {
    if (!map.has(key)) return false;
    if (this._isExpired(expiries.get(key))) {
      map.delete(key);
      expiries.delete(key);
      return false;
    }
    return true;
  }

  private _checkExists(key: string): boolean {
    const entry = this.storage.get(key);
    if (entry) {
      if (this._isExpired(entry.expiresAt)) {
        this.storage.delete(key);
      } else {
        return true;
      }
    }
    return (
      this._checkCollectionExists(this.hashes, this.hashExpiries, key) ||
      this._checkCollectionExists(this.sets, this.setExpiries, key) ||
      this._checkCollectionExists(this.sortedSets, this.sortedSetExpiries, key)
    );
  }

  private _getList(key: string): { list: string[]; expiresAt: number | null } | null {
    const entry = this.storage.get(key);
    if (!entry) return null;
    if (this._isExpired(entry.expiresAt)) {
      this.storage.delete(key);
      return null;
    }
    try {
      const parsed = JSON.parse(entry.value);
      if (Array.isArray(parsed)) {
        return { list: parsed as string[], expiresAt: entry.expiresAt };
      }
    } catch {
      // Non-array content
    }
    return null;
  }

  private _getHash(key: string): Map<string, string> | null {
    if (this._isExpired(this.hashExpiries.get(key))) {
      this.hashes.delete(key);
      this.hashExpiries.delete(key);
      return null;
    }
    return this.hashes.get(key) ?? null;
  }

  private _getSet(key: string): Set<string> | null {
    if (this._isExpired(this.setExpiries.get(key))) {
      this.sets.delete(key);
      this.setExpiries.delete(key);
      return null;
    }
    return this.sets.get(key) ?? null;
  }

  private _getSortedSet(key: string): Map<string, number> | null {
    if (this._isExpired(this.sortedSetExpiries.get(key))) {
      this.sortedSets.delete(key);
      this.sortedSetExpiries.delete(key);
      return null;
    }
    return this.sortedSets.get(key) ?? null;
  }

  async get(key: string): Promise<string | null> {
    const entry = this.storage.get(key);
    if (!entry) return null;
    if (this._isExpired(entry.expiresAt)) {
      this.storage.delete(key);
      return null;
    }
    return String(entry.value);
  }

  async set(key: string, value: unknown, options: MockSetOptions = {}): Promise<string | null> {
    const existing = this.storage.get(key);
    const exists = existing ? !this._isExpired(existing.expiresAt) : false;
    if (existing && !exists) {
      this.storage.delete(key);
    }
    if (options.NX && exists) {
      return null;
    }
    if (options.XX && !exists) {
      return null;
    }
    let expiresAt: number | null = null;
    if (typeof options.PX === 'number') {
      expiresAt = Date.now() + options.PX;
    } else if (typeof options.EX === 'number') {
      expiresAt = Date.now() + options.EX * 1000;
    } else if (typeof options.PXAT === 'number') {
      expiresAt = options.PXAT;
    } else if (typeof options.EXAT === 'number') {
      expiresAt = options.EXAT * 1000;
    } else if (options.KEEPTTL && existing) {
      expiresAt = existing.expiresAt;
    }
    this.storage.set(key, { value: String(value), expiresAt });
    return 'OK';
  }

  async setEx(key: string, seconds: number, value: unknown): Promise<string> {
    this.storage.set(key, { value: String(value), expiresAt: Date.now() + seconds * 1000 });
    return 'OK';
  }

  async del(...keysOrArray: (string | string[])[]): Promise<number> {
    const keys = keysOrArray.flat();
    let count = 0;
    for (const key of keys) {
      let deleted = false;
      if (this.storage.delete(key)) deleted = true;
      if (this.hashes.delete(key)) {
        this.hashExpiries.delete(key);
        deleted = true;
      }
      if (this.sets.delete(key)) {
        this.setExpiries.delete(key);
        deleted = true;
      }
      if (this.sortedSets.delete(key)) {
        this.sortedSetExpiries.delete(key);
        deleted = true;
      }
      if (deleted) count++;
    }
    return count;
  }

  async keys(pattern: string): Promise<string[]> {
    const results: string[] = [];
    const isMatch = (key: string): boolean => {
      if (pattern === '*') return true;
      if (pattern.endsWith('*') && !pattern.slice(0, -1).includes('*')) {
        return key.startsWith(pattern.slice(0, -1));
      }
      const parts = pattern.split('*');
      return key.startsWith(parts.at(0) || '') && key.endsWith(parts.at(-1) || '');
    };

    const allKeys = new Set([
      ...this.storage.keys(),
      ...this.hashes.keys(),
      ...this.sets.keys(),
      ...this.sortedSets.keys(),
    ]);

    for (const key of allKeys) {
      if (!this._checkExists(key)) continue;
      if (isMatch(key)) {
        results.push(key);
      }
    }
    return results;
  }

  async incr(key: string): Promise<number> {
    const val = await this.get(key);
    const next = parseInt(val || '0', 10) + 1;
    this.storage.set(key, {
      value: String(next),
      expiresAt: this.storage.get(key)?.expiresAt || null,
    });
    return next;
  }

  async incrBy(key: string, value: number): Promise<number> {
    const val = await this.get(key);
    const next = parseInt(val || '0', 10) + value;
    this.storage.set(key, {
      value: String(next),
      expiresAt: this.storage.get(key)?.expiresAt || null,
    });
    return next;
  }

  private _updateCollectionExpiry<T>(
    map: Map<string, T>,
    expiries: Map<string, number | null>,
    key: string,
    expiresAt: number,
  ): boolean {
    if (!map.has(key)) return false;
    if (this._isExpired(expiries.get(key))) {
      map.delete(key);
      expiries.delete(key);
      return false;
    }
    expiries.set(key, expiresAt);
    return true;
  }

  async expire(key: string, seconds: number): Promise<number> {
    const expiresAt = Date.now() + seconds * 1000;
    let found = false;
    const entry = this.storage.get(key);
    if (entry) {
      if (this._isExpired(entry.expiresAt)) {
        this.storage.delete(key);
      } else {
        entry.expiresAt = expiresAt;
        found = true;
      }
    }
    if (this._updateCollectionExpiry(this.hashes, this.hashExpiries, key, expiresAt)) found = true;
    if (this._updateCollectionExpiry(this.sets, this.setExpiries, key, expiresAt)) found = true;
    if (this._updateCollectionExpiry(this.sortedSets, this.sortedSetExpiries, key, expiresAt)) {
      found = true;
    }
    return found ? 1 : 0;
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

  async lPush(key: string, ...values: unknown[]): Promise<number> {
    const existing = this._getList(key);
    const list = existing ? existing.list : [];
    const expiresAt = existing ? existing.expiresAt : null;
    const items = values.flat().map(String);
    for (const item of items) {
      list.unshift(item);
    }
    this.storage.set(key, { value: JSON.stringify(list), expiresAt });
    return list.length;
  }

  async rPush(key: string, ...values: unknown[]): Promise<number> {
    const existing = this._getList(key);
    const list = existing ? existing.list : [];
    const expiresAt = existing ? existing.expiresAt : null;
    const items = values.flat().map(String);
    for (const item of items) {
      list.push(item);
    }
    this.storage.set(key, { value: JSON.stringify(list), expiresAt });
    return list.length;
  }

  async rPop(key: string): Promise<string | null> {
    const existing = this._getList(key);
    if (!existing || existing.list.length === 0) return null;
    const item = existing.list.pop() ?? null;
    this.storage.set(key, { value: JSON.stringify(existing.list), expiresAt: existing.expiresAt });
    return item;
  }

  async lPop(key: string): Promise<string | null> {
    const existing = this._getList(key);
    if (!existing || existing.list.length === 0) return null;
    const item = existing.list.shift() ?? null;
    this.storage.set(key, { value: JSON.stringify(existing.list), expiresAt: existing.expiresAt });
    return item;
  }

  async lTrim(key: string, start: number, stop: number): Promise<string> {
    const existing = this._getList(key);
    if (!existing) return 'OK';
    const list = existing.list;
    const len = list.length;
    const s = start < 0 ? Math.max(0, len + start) : start;
    let e = stop < 0 ? len + stop : stop;
    if (s > e || s >= len) {
      this.storage.set(key, { value: JSON.stringify([]), expiresAt: existing.expiresAt });
      return 'OK';
    }
    if (e >= len) e = len - 1;
    const trimmed = list.slice(s, e + 1);
    this.storage.set(key, { value: JSON.stringify(trimmed), expiresAt: existing.expiresAt });
    return 'OK';
  }

  async lRem(key: string, count: number, value: string): Promise<number> {
    const existing = this._getList(key);
    if (!existing) return 0;
    const targetCount = count === 0 ? Infinity : Math.abs(count);
    const sourceList = count < 0 ? [...existing.list].reverse() : existing.list;
    let removed = 0;
    const filtered: string[] = [];
    for (const item of sourceList) {
      if (item === String(value) && removed < targetCount) {
        removed++;
      } else {
        filtered.push(item);
      }
    }
    const finalList = count < 0 ? filtered.reverse() : filtered;
    this.storage.set(key, { value: JSON.stringify(finalList), expiresAt: existing.expiresAt });
    return removed;
  }

  async lRange(key: string, start: number, stop: number): Promise<string[]> {
    const existing = this._getList(key);
    if (!existing || existing.list.length === 0) return [];
    const list = existing.list;
    const len = list.length;
    const s = start < 0 ? Math.max(0, len + start) : start;
    let e = stop < 0 ? len + stop : stop;
    if (s > e || s >= len) return [];
    if (e >= len) e = len - 1;
    return list.slice(s, e + 1);
  }

  async lLen(key: string): Promise<number> {
    const existing = this._getList(key);
    return existing ? existing.list.length : 0;
  }

  async exists(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this._checkExists(key)) {
        count++;
      }
    }
    return count;
  }

  async hGet(key: string, field: string): Promise<string | null> {
    const hash = this._getHash(key);
    return hash?.get(field) ?? null;
  }

  async hSet(
    key: string,
    fieldOrObj: string | Record<string, unknown>,
    value?: unknown,
  ): Promise<number> {
    let hash = this._getHash(key);
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
    const hash = this._getHash(key);
    if (!hash) return {};
    const res: Record<string, string> = {};
    for (const [k, v] of hash.entries()) {
      Reflect.set(res, k, v);
    }
    return res;
  }

  async hIncrBy(key: string, field: string, increment: number): Promise<number> {
    let hash = this._getHash(key);
    if (!hash) {
      hash = new Map<string, string>();
      this.hashes.set(key, hash);
    }
    const current = parseInt(hash.get(field) || '0', 10);
    const next = current + increment;
    hash.set(field, String(next));
    return next;
  }

  async hDel(key: string, ...fieldsOrArray: (string | string[])[]): Promise<number> {
    const hash = this._getHash(key);
    if (!hash) return 0;
    const fields = fieldsOrArray.flat();
    let deleted = 0;
    for (const field of fields) {
      if (hash.delete(String(field))) {
        deleted++;
      }
    }
    if (hash.size === 0) {
      this.hashes.delete(key);
      this.hashExpiries.delete(key);
    }
    return deleted;
  }

  async hLen(key: string): Promise<number> {
    const hash = this._getHash(key);
    return hash?.size ?? 0;
  }

  async hExists(key: string, field: string): Promise<number> {
    const hash = this._getHash(key);
    return hash && hash.has(field) ? 1 : 0;
  }

  async sAdd(key: string, members: unknown | unknown[]): Promise<number> {
    let set = this._getSet(key);
    if (!set) {
      set = new Set<string>();
      this.sets.set(key, set);
    }
    const items = Array.isArray(members) ? members : [members];
    let added = 0;
    for (const item of items.flat()) {
      const str = String(item);
      if (!set.has(str)) {
        set.add(str);
        added++;
      }
    }
    return added;
  }

  async sPop(key: string): Promise<string | null> {
    const set = this._getSet(key);
    if (!set || set.size === 0) return null;
    const first = set.values().next().value;
    if (first !== undefined) {
      set.delete(first);
      return first;
    }
    return null;
  }

  async sPopCount(key: string, count: number): Promise<string[]> {
    const set = this._getSet(key);
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
    const set = this._getSet(key);
    return set ? Array.from(set) : [];
  }

  async sRem(key: string, members: unknown | unknown[]): Promise<number> {
    const set = this._getSet(key);
    if (!set) return 0;
    const items = Array.isArray(members) ? members : [members];
    let removed = 0;
    for (const item of items.flat()) {
      if (set.delete(String(item))) removed++;
    }
    return removed;
  }

  async sIsMember(key: string, member: string): Promise<boolean> {
    const set = this._getSet(key);
    return set ? set.has(member) : false;
  }

  async sCard(key: string): Promise<number> {
    const set = this._getSet(key);
    return set?.size ?? 0;
  }

  async zAdd(
    key: string,
    memberOrScore: number | ZMember | ZMember[],
    memberOrOptions?: string | Record<string, unknown>,
    _options?: Record<string, unknown>,
  ): Promise<number> {
    let zset = this._getSortedSet(key);
    if (!zset) {
      zset = new Map<string, number>();
      this.sortedSets.set(key, zset);
    }

    const membersToAdd: ZMember[] = [];
    if (typeof memberOrScore === 'number' && typeof memberOrOptions === 'string') {
      membersToAdd.push({ score: memberOrScore, value: memberOrOptions });
    } else if (Array.isArray(memberOrScore)) {
      for (const m of memberOrScore) {
        if (m && typeof m === 'object' && 'score' in m && 'value' in m) {
          membersToAdd.push({ score: Number(m.score), value: String(m.value) });
        }
      }
    } else if (
      memberOrScore &&
      typeof memberOrScore === 'object' &&
      'score' in memberOrScore &&
      'value' in memberOrScore
    ) {
      membersToAdd.push({ score: Number(memberOrScore.score), value: String(memberOrScore.value) });
    }

    let addedCount = 0;
    for (const { score, value } of membersToAdd) {
      if (!zset.has(value)) {
        addedCount++;
      }
      zset.set(value, score);
    }
    return addedCount;
  }

  async zIncrBy(key: string, increment: number, member: string): Promise<number> {
    let zset = this._getSortedSet(key);
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
    const zset = this._getSortedSet(key);
    if (!zset) return [];
    const entries = Array.from(zset.entries()).map(([value, score]) => ({ value, score }));
    entries.sort((a, b) => (options?.REV ? b.score - a.score : a.score - b.score));
    const actualStop = stop === -1 ? entries.length : stop + 1;
    return entries.slice(start, actualStop);
  }

  async zScore(key: string, member: string): Promise<number | null> {
    const zset = this._getSortedSet(key);
    return zset?.has(member) ? (zset.get(member) ?? null) : null;
  }

  async zCard(key: string): Promise<number> {
    const zset = this._getSortedSet(key);
    return zset?.size ?? 0;
  }

  async zRem(key: string, ...membersOrArray: (string | string[])[]): Promise<number> {
    const zset = this._getSortedSet(key);
    if (!zset) return 0;
    const members = membersOrArray.flat();
    let removed = 0;
    for (const m of members) {
      if (zset.delete(String(m))) {
        removed++;
      }
    }
    if (zset.size === 0) {
      this.sortedSets.delete(key);
      this.sortedSetExpiries.delete(key);
    }
    return removed;
  }

  async zRangeByScore(
    key: string,
    min: number | string,
    max: number | string,
    options?: { WITHSCORES?: boolean; LIMIT?: { offset: number; count: number } },
  ): Promise<string[] | Array<{ value: string; score: number }>> {
    const zset = this._getSortedSet(key);
    if (!zset) return [];

    const minBound = parseScoreBound(min);
    const maxBound = parseScoreBound(max);

    const matched: Array<{ value: string; score: number }> = [];
    for (const [value, score] of zset.entries()) {
      const minOk = minBound.inclusive ? score >= minBound.val : score > minBound.val;
      const maxOk = maxBound.inclusive ? score <= maxBound.val : score < maxBound.val;
      if (minOk && maxOk) {
        matched.push({ value, score });
      }
    }

    matched.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.value.localeCompare(b.value);
    });

    let results = matched;
    if (options?.LIMIT) {
      const { offset, count } = options.LIMIT;
      results = results.slice(offset, offset + count);
    }

    if (options?.WITHSCORES) {
      return results;
    }
    return results.map((e) => e.value);
  }

  async zRemRangeByScore(key: string, min: number | string, max: number | string): Promise<number> {
    const zset = this._getSortedSet(key);
    if (!zset) return 0;

    const minBound = parseScoreBound(min);
    const maxBound = parseScoreBound(max);

    const toRemove: string[] = [];
    for (const [value, score] of zset.entries()) {
      const minOk = minBound.inclusive ? score >= minBound.val : score > minBound.val;
      const maxOk = maxBound.inclusive ? score <= maxBound.val : score < maxBound.val;
      if (minOk && maxOk) {
        toRemove.push(value);
      }
    }

    for (const value of toRemove) {
      zset.delete(value);
    }

    if (zset.size === 0) {
      this.sortedSets.delete(key);
      this.sortedSetExpiries.delete(key);
    }

    return toRemove.length;
  }

  async eval(
    script: string,
    optionsOrNumKeys?: EvalOptions | number,
    ...restArgs: unknown[]
  ): Promise<unknown> {
    const { keys, args } = extractEvalArgs(optionsOrNumKeys, restArgs);
    const normalizedScript = script.replace(/\s+/g, ' ').trim().toLowerCase();

    if (isLockReleaseScript(normalizedScript)) {
      const lockKey = keys.at(0);
      const expectedVal = args.at(0);
      if (lockKey && expectedVal !== undefined) {
        const currentVal = await this.get(lockKey);
        return currentVal === expectedVal ? await this.del(lockKey) : 0;
      }
      return 0;
    }

    const parsed = parseSimpleRedisCall(normalizedScript);
    if (parsed) {
      const resolvedArgs = parsed.rawArgs.map((arg) => resolveScriptArg(arg, keys, args));
      const targetMethod = Reflect.get(this, parsed.command);
      if (typeof targetMethod === 'function') {
        return await (targetMethod as (...fnArgs: unknown[]) => Promise<unknown>).apply(
          this,
          resolvedArgs,
        );
      }
    }

    return null;
  }

  multi(): MockMulti {
    const queue: Array<() => Promise<unknown>> = [];
    const proxy = new Proxy({} as unknown as Record<string, unknown>, {
      get: (_target, prop: string) => {
        if (prop === 'exec') {
          return async (): Promise<unknown[]> => {
            const results: unknown[] = [];
            for (const op of queue) {
              results.push(await op());
            }
            return results;
          };
        }
        const method = Reflect.get(this, prop);
        if (typeof method === 'function') {
          return (...args: unknown[]) => {
            queue.push(() =>
              (method as (...fnArgs: unknown[]) => Promise<unknown>).apply(this, args),
            );
            return proxy;
          };
        }
        return undefined;
      },
    });
    return proxy as unknown as MockMulti;
  }
}

function switchToMock(redisInstance: typeof redis): void {
  const mock = new InMemoryRedisMock();

  Object.defineProperty(redisInstance, 'isOpen', { get: () => mock.isOpen, configurable: true });
  Object.defineProperty(redisInstance, 'isReady', { get: () => mock.isReady, configurable: true });

  const target = redisInstance as unknown as Record<string, unknown>;

  const proto = Object.getPrototypeOf(mock) as object;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor' || key.startsWith('_')) continue;
    const prop = Reflect.get(mock, key);
    if (typeof prop === 'function') {
      Reflect.set(target, key, (prop as (...args: unknown[]) => unknown).bind(mock));
    }
  }

  Reflect.set(target, 'multi', mock.multi.bind(mock));
}

export { redis, ensureConnected, checkHealth, disconnect, InMemoryRedisMock, switchToMock };
export type { MockSetOptions, ZMember, EvalOptions, MockMulti };
export default redis;
