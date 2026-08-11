import { randomBytes, randomInt } from 'crypto';
import { redis } from '../redisClient.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error';
}

export class LockManager {
  prefix: string;
  ttl: number;

  constructor(resourcePrefix: string, ttlMs = 5000) {
    this.prefix = resourcePrefix;
    this.ttl = ttlMs;
  }

  async acquire(key: string): Promise<string | null> {
    if (!redis?.isOpen) {
      console.warn('[LockManager] Redis not ready, proceeding without lock');
      return 'no-lock-fallback';
    }

    const lockKey = `lock:${this.prefix}:${key}`;
    const lockId = Date.now().toString() + randomBytes(4).toString('hex');

    try {
      const acquired = await redis.set(lockKey, lockId, {
        PX: this.ttl,
        NX: true,
      });

      return acquired ? lockId : null;
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      console.error('[LockManager] acquire error:', errorMessage);
      return null;
    }
  }

  async acquireWait(key: string, maxRetries = 10): Promise<string | null> {
    let attempt = 0;
    while (attempt < maxRetries) {
      const lockId = await this.acquire(key);
      if (lockId) return lockId;

      attempt++;
      await delay(50 + randomInt(0, 100));
    }

    console.warn(`[LockManager] Failed to acquire lock for ${key} after ${maxRetries} retries`);
    return null;
  }

  async release(key: string, lockId: string): Promise<void> {
    if (!lockId || lockId === 'no-lock-fallback' || !redis?.isOpen) return;

    const lockKey = `lock:${this.prefix}:${key}`;
    try {
      const script = `
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                else
                    return 0
                end
            `;
      await redis.eval(script, {
        keys: [lockKey],
        arguments: [lockId],
      });
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      console.error('[LockManager] release error:', errorMessage);
    }
  }
}
