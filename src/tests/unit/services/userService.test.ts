// tests/unit/services/userService.test.ts
import { describe, it, beforeEach, afterAll, beforeAll, jest, expect } from '@jest/globals';

// Set dummy env vars for Supabase and Redis BEFORE any imports
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'dummy-key';
process.env.REDIS_URL = 'redis://localhost:6379';

type UserServiceModule = typeof import('../../../services/userService.js');
type StateManagerModule = typeof import('../../../services/state/StateManager.js');
type IdentityMapModule = typeof import('../../../services/state/IdentityMap.js');
type RedisModule = typeof import('../../../services/redisClient.js');
type SupabaseModule = typeof import('../../../services/supabase.js');

let userService: UserServiceModule['userService'];
let StateManager: StateManagerModule['StateManager'];
let IdentityMap: IdentityMapModule['IdentityMap'];
let redis: RedisModule['redis'];
let supabase: SupabaseModule['supabase'];

function mockSupabaseSelect(hashValue: string | null) {
  if (!supabase) return;
  const queryMock = {
    select: () => ({
      eq: () => ({
        single: async () => ({ data: hashValue ? { hash: hashValue } : null }),
      }),
    }),
  };
  jest
    .spyOn(supabase, 'from')
    .mockImplementation(
      () => queryMock as unknown as ReturnType<NonNullable<typeof supabase>['from']>,
    );
}

function mockSupabaseSelectAndUpsert() {
  if (!supabase) return;
  const queryMock = {
    select: () => ({
      eq: () => ({
        single: async () => ({ data: null }),
      }),
    }),
    upsert: () => ({
      select: async () => ({ data: null }),
    }),
  };
  jest
    .spyOn(supabase, 'from')
    .mockImplementation(
      () => queryMock as unknown as ReturnType<NonNullable<typeof supabase>['from']>,
    );
}

function registerSpeakerHashTests() {
  it('should return UNK if no JID provided', async () => {
    const hash = await userService.getSpeakerHash(null);
    expect(hash).toBe('UNK');
  });

  it('should return hash from cache if available', async () => {
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    jest.spyOn(redis, 'hGet').mockImplementation(async () => 'ABC');

    const hash = await userService.getSpeakerHash('123');
    expect(hash).toBe('ABC');
  });

  it('should generate and return a 3-char hash if not in cache', async () => {
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    const hash = await userService.getSpeakerHash('123');
    expect(hash).toHaveLength(3);
    expect(hash).toBe('1B5');
  });

  it('should compute hash via error fallback path if an exception occurs during cache lookup', async () => {
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    jest.spyOn(redis, 'hGet').mockImplementation(async () => {
      throw new Error('Redis connection failed');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const hash = await userService.getSpeakerHash('123');
    expect(hash).toBe('1B5');
    expect(errorSpy).toHaveBeenCalledWith(
      '[UserService] getSpeakerHash error:',
      'Redis connection failed',
    );
  });

  it('should preserve existing inherited hash from Supabase when Redis lookup and write fail', async () => {
    const legacyHash = 'FBF';
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    jest.spyOn(redis, 'hGet').mockImplementation(async () => {
      throw new Error('Redis connection failed');
    });
    jest.spyOn(redis, 'hSet').mockImplementation(async () => {
      throw new Error('Redis write failed');
    });
    mockSupabaseSelect(legacyHash);

    const hash = await userService.getSpeakerHash('123');
    expect(hash).toBe(legacyHash);
  });

  it('should populate Redis cache with existing Supabase hash for continuity', async () => {
    const existingHash = 'FBF';
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);
    const hSetSpy = jest.spyOn(redis, 'hSet').mockImplementation(async () => 1);
    mockSupabaseSelect(existingHash);

    const hash = await userService.getSpeakerHash('123');
    expect(hash).toBe(existingHash);
    expect(hSetSpy).toHaveBeenCalledWith('user:resolved@s.whatsapp.net:data', 'hash', existingHash);
  });

  it('should deterministically produce exact 3-char uppercase SHA-256 hash for new users across diverse JIDs', async () => {
    const cryptoModule = await import('node:crypto');
    const testJids = ['user1@s.whatsapp.net', 'user2@s.whatsapp.net', 'user3@s.whatsapp.net'];

    for (const testJid of testJids) {
      jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => testJid);
      jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

      const expected = cryptoModule
        .createHash('sha256')
        .update(testJid)
        .digest('hex')
        .substring(0, 3)
        .toUpperCase();

      const hash = await userService.getSpeakerHash(testJid);
      expect(hash).toBe(expected);
      expect(hash).toHaveLength(3);
      expect(hash).toMatch(/^[0-9A-F]{3}$/);
    }
  });

  it('should fall back to deterministic SHA-256 calculation when both Redis and Supabase fail', async () => {
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    jest.spyOn(redis, 'hGet').mockImplementation(async () => {
      throw new Error('Redis connection failed');
    });
    if (supabase) {
      jest.spyOn(supabase, 'from').mockImplementation(() => {
        throw new Error('Supabase unreachable');
      });
    }
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const hash = await userService.getSpeakerHash('123');
    expect(hash).toBe('1B5');
    expect(errorSpy).toHaveBeenCalled();
  });
}

describe('userService unit tests', () => {
  beforeAll(async () => {
    // Import redis client and mock connect immediately
    const redisModule = await import('../../../services/redisClient.js');
    redis = redisModule.redis;
    jest.spyOn(redis, 'connect').mockImplementation(async () => redis);

    // Import others
    const userSvcModule = await import('../../../services/userService.js');
    userService = userSvcModule.userService;

    const stateMgrModule = await import('../../../services/state/StateManager.js');
    StateManager = stateMgrModule.StateManager;

    const identityMapModule = await import('../../../services/state/IdentityMap.js');
    IdentityMap = identityMapModule.IdentityMap;

    const supabaseModule = await import('../../../services/supabase.js');
    supabase = supabaseModule.supabase;
  });

  beforeEach(() => {
    // Reset all mocks before each test
    jest.restoreAllMocks();

    // Re-apply essential mocks after restoreAll
    if (redis) {
      jest.spyOn(redis, 'hGet').mockImplementation(async () => null);
      jest.spyOn(redis, 'hSet').mockImplementation(async () => 1);
      jest.spyOn(redis, 'connect').mockImplementation(async () => redis);
    }

    mockSupabaseSelectAndUpsert();
  });

  afterAll(async () => {
    if (redis && typeof redis.quit === 'function') {
      try {
        await redis.quit();
      } catch {
        // redis already closed
      }
    }
  });

  describe('recordInteraction()', () => {
    it('should resolve LID and update interaction', async () => {
      const identifier = 'some_id';
      const pushName = 'TestUser';
      const resolvedJid = '123@s.whatsapp.net';

      const resolveMock = jest
        .spyOn(IdentityMap, 'resolve')
        .mockImplementation(async () => resolvedJid);
      const updateMock = jest
        .spyOn(StateManager, 'updateUserInteraction')
        .mockImplementation(async () => {});

      await userService.recordInteraction(identifier, pushName);

      expect(resolveMock).toHaveBeenCalledTimes(1);
      expect(updateMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('getProfile()', () => {
    it('should return a formatted profile from StateManager', async () => {
      const jid = '123@s.whatsapp.net';
      const mockUser = {
        jid,
        names: ['TestPush'],
        last_pushname: 'TestPush',
        interaction_count: 5,
        last_seen: 1672531200,
      };

      jest.spyOn(StateManager, 'getUser').mockImplementation(async () => mockUser);

      const profile = await userService.getProfile(jid);

      expect(profile.jid).toBe(jid);
      expect(profile.names).toEqual(['TestPush']);
    });
  });

  describe('getSpeakerHash()', registerSpeakerHashTests);
});
