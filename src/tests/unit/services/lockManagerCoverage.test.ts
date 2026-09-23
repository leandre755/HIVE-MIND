// tests/unit/services/lockManagerCoverage.test.ts
// Issue #112 (Palier 1) — Couverture unitaire de LockManager :
//  - acquire (succès NX/PX, double acquisition, clé expirée, fallback, erreurs set)
//  - acquireWait (succès immédiat, retry puis succès, abandon après maxRetries)
//  - release (CAS Lua : succès, détenteur obsolète, clé expirée, no-ops, échec eval)
// Redis réel basculé sur InMemoryRedisMock via switchToMock (pattern actionMemory.test.ts) :
// le script Lua de déverrouillage atomique est réellement évalué par le mock (CAS get/del).
import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { redis, switchToMock } from '../../../services/redisClient.js';
import { LockManager } from '../../../services/state/LockManager.js';

type MutableRedis = {
  isOpen: boolean;
  set: (...args: unknown[]) => Promise<unknown>;
  eval: (...args: unknown[]) => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
};

const redisAs = redis as unknown as MutableRedis;

let logSpy: ReturnType<typeof jest.spyOn>;
let warnSpy: ReturnType<typeof jest.spyOn>;
let errSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  switchToMock(redis);
  jest.clearAllMocks();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errSpy.mockRestore();
});

// Avance les timers fakes en flushant la chaîne de promesses de acquireWait
async function drainTimers(rounds = 30, step = 200): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await jest.advanceTimersByTimeAsync(step);
  }
}

describe('LockManager.acquire', () => {
  it('pose un verrou NX avec TTL (PX 5000 par défaut) et retourne un lockId', async () => {
    const calls: unknown[][] = [];
    const realSet = redisAs.set;
    redisAs.set = async (...args: unknown[]) => {
      calls.push(args);
      return realSet(...args);
    };

    const lock = new LockManager('res');
    const id = await lock.acquire('k');

    expect(id).toMatch(/^\d+[0-9a-f]{8}$/);
    expect(calls.at(0)).toEqual(['lock:res:k', id, { PX: 5000, NX: true }]);
    expect(await redisAs.get('lock:res:k')).toBe(id);
  });

  it('refuse une double acquisition sur la même clé', async () => {
    const lock = new LockManager('res', 5000);
    const id1 = await lock.acquire('k');
    const id2 = await lock.acquire('k');

    expect(id1).toEqual(expect.any(String));
    expect(id2).toBeNull();
    expect(await redisAs.get('lock:res:k')).toBe(id1);
  });

  it('clé expirée : le verrou est relâché par le TTL et une nouvelle acquisition réussit', async () => {
    jest.useFakeTimers();
    const lock = new LockManager('res', 500);
    await lock.acquire('k');

    jest.advanceTimersByTime(1000);
    expect(await redisAs.get('lock:res:k')).toBeNull();

    const id2 = await lock.acquire('k');
    expect(id2).toEqual(expect.any(String));
  });

  it("retourne 'no-lock-fallback' quand Redis est fermé", async () => {
    redisAs.isOpen = false;
    const lock = new LockManager('res');

    expect(await lock.acquire('k')).toBe('no-lock-fallback');
    expect(warnSpy).toHaveBeenCalledWith('[LockManager] Redis not ready, proceeding without lock');
  });

  it('retourne null quand set rejette une Error', async () => {
    redisAs.set = jest.fn<(...args: unknown[]) => Promise<unknown>>(() =>
      Promise.reject(new Error('network')),
    );
    const lock = new LockManager('res');

    expect(await lock.acquire('k')).toBeNull();
    expect(errSpy).toHaveBeenCalledWith('[LockManager] acquire error:', 'network');
  });

  it('retourne null quand set rejette une chaîne', async () => {
    redisAs.set = jest.fn<(...args: unknown[]) => Promise<unknown>>(() =>
      Promise.reject('refused'),
    );
    const lock = new LockManager('res');

    expect(await lock.acquire('k')).toBeNull();
    expect(errSpy).toHaveBeenCalledWith('[LockManager] acquire error:', 'refused');
  });

  it('retourne null quand set rejette une valeur inconnue (Unknown error)', async () => {
    redisAs.set = jest.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.reject(42));
    const lock = new LockManager('res');

    expect(await lock.acquire('k')).toBeNull();
    expect(errSpy).toHaveBeenCalledWith('[LockManager] acquire error:', 'Unknown error');
  });
});

describe('LockManager.acquireWait', () => {
  it('renvoie immédiatement le lockId si le verrou est libre', async () => {
    const lock = new LockManager('res');
    const id = await lock.acquireWait('k');

    expect(id).toEqual(expect.any(String));
    expect(await redisAs.get('lock:res:k')).toBe(id);
  });

  it('réessaie après une contention puis obtient le verrou', async () => {
    jest.useFakeTimers();
    const realSet = redisAs.set;
    let attempts = 0;
    const setMock = jest.fn<(...args: unknown[]) => Promise<unknown>>(
      async (...args: unknown[]) => {
        attempts++;
        if (attempts <= 2) return null;
        return realSet(...args);
      },
    );
    redisAs.set = setMock;

    // TTL large : le drain de timers virtuels (30 x 200ms) ne doit pas expirer le verrou
    const lock = new LockManager('res', 60000);
    const pending = lock.acquireWait('k', 5);
    await drainTimers();
    const id = await pending;

    expect(id).toEqual(expect.any(String));
    expect(setMock).toHaveBeenCalledTimes(3);
    expect(await redisAs.get('lock:res:k')).toBe(id);
  });

  it('abandonne après maxRetries et retourne null', async () => {
    jest.useFakeTimers();
    redisAs.set = jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => null);

    const lock = new LockManager('res', 5000);
    const pending = lock.acquireWait('k', 2);
    await drainTimers();
    const id = await pending;

    expect(id).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      '[LockManager] Failed to acquire lock for k after 2 retries',
    );
  });
});

describe('LockManager.release', () => {
  it('CAS : supprime le verrou quand le lockId correspond', async () => {
    const lock = new LockManager('res', 5000);
    const id = (await lock.acquire('k')) as string;

    await lock.release('k', id);

    expect(await redisAs.get('lock:res:k')).toBeNull();
  });

  it('CAS : ne supprime pas le verrou ré-acquis par un autre détenteur (lockId obsolète)', async () => {
    jest.useFakeTimers();
    const lock = new LockManager('res', 1000);
    const id1 = (await lock.acquire('k')) as string;

    // Le verrou expire puis un autre détenteur le reprend
    jest.advanceTimersByTime(2000);
    const id2 = (await lock.acquire('k')) as string;
    expect(id2).not.toBeNull();

    await lock.release('k', id1);
    expect(await redisAs.get('lock:res:k')).toBe(id2);

    await lock.release('k', id2);
    expect(await redisAs.get('lock:res:k')).toBeNull();
  });

  it('clé expirée : release est un no-op sans erreur', async () => {
    jest.useFakeTimers();
    const lock = new LockManager('res', 500);
    const id = (await lock.acquire('k')) as string;

    jest.advanceTimersByTime(1000);
    await expect(lock.release('k', id)).resolves.toBeUndefined();
    expect(await redisAs.get('lock:res:k')).toBeNull();
  });

  it("no-op sur lockId vide ou 'no-lock-fallback' (eval jamais appelé)", async () => {
    const evalMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
    redisAs.eval = evalMock;
    const lock = new LockManager('res', 5000);

    await lock.release('k', '');
    await lock.release('k', 'no-lock-fallback');

    expect(evalMock).not.toHaveBeenCalled();
  });

  it('no-op quand Redis est fermé (eval jamais appelé)', async () => {
    const evalMock = jest.fn<(...args: unknown[]) => Promise<unknown>>();
    redisAs.eval = evalMock;
    const lock = new LockManager('res', 5000);

    redisAs.isOpen = false;
    await lock.release('k', 'some-lock-id');

    expect(evalMock).not.toHaveBeenCalled();
  });

  it('échec eval (Error) : erreur journalisée mais résolue', async () => {
    redisAs.eval = jest.fn<(...args: unknown[]) => Promise<unknown>>(() =>
      Promise.reject(new Error('lua fail')),
    );
    const lock = new LockManager('res', 5000);

    await expect(lock.release('k', 'some-lock-id')).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith('[LockManager] release error:', 'lua fail');
  });

  it('échec eval (valeur inconnue) : erreur journalisée (Unknown error)', async () => {
    redisAs.eval = jest.fn<(...args: unknown[]) => Promise<unknown>>(() => Promise.reject({}));
    const lock = new LockManager('res', 5000);

    await expect(lock.release('k', 'some-lock-id')).resolves.toBeUndefined();
    expect(errSpy).toHaveBeenCalledWith('[LockManager] release error:', 'Unknown error');
  });
});
