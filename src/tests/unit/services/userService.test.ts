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

function mockSupabaseSelect(
  hashValue: string | null,
  upsertFn?: (
    values: { jid: string; hash: string },
    options?: { onConflict?: string },
  ) => { select: () => Promise<{ data: null }> },
) {
  if (!supabase) return;
  const queryMock = {
    select: () => ({
      eq: () => ({
        single: async () => ({ data: hashValue ? { hash: hashValue } : null }),
        limit: async () => ({ data: [] }),
      }),
      limit: async () => ({ data: [] }),
    }),
    upsert:
      upsertFn ||
      (() => ({
        select: async () => ({ data: null }),
      })),
  };
  jest
    .spyOn(supabase, 'from')
    .mockImplementation(
      () => queryMock as unknown as ReturnType<NonNullable<typeof supabase>['from']>,
    );
}

function mockSupabaseSelectError(
  errorToThrow: Error,
  upsertFn?: () => { select: () => Promise<{ data: null }> },
) {
  if (!supabase) return;
  const queryMock = {
    select: () => ({
      eq: () => ({
        single: async () => {
          throw errorToThrow;
        },
        limit: async () => {
          throw errorToThrow;
        },
      }),
      limit: async () => {
        throw errorToThrow;
      },
    }),
    upsert:
      upsertFn ||
      (() => ({
        select: async () => ({ data: null }),
      })),
  };
  jest
    .spyOn(supabase, 'from')
    .mockImplementation(
      () => queryMock as unknown as ReturnType<NonNullable<typeof supabase>['from']>,
    );
}

type UpsertMockFn = (
  values?: { jid: string; hash: string },
  options?: { onConflict?: string },
) => { select: () => Promise<{ data: null }> };

function mockSupabaseSelectReturnedError(
  errorReturned: { code?: string; message?: string },
  upsertFn?: UpsertMockFn,
) {
  if (!supabase) return;
  const isNotFound =
    errorReturned.code === 'PGRST116' ||
    (typeof errorReturned.message === 'string' &&
      (errorReturned.message.includes('0 rows') ||
        errorReturned.message.includes('JSON object requested')));
  const queryMock = {
    select: () => ({
      eq: () => ({
        single: async () => ({ data: null, error: errorReturned }),
        limit: async () => (isNotFound ? { data: [] } : { data: null, error: errorReturned }),
      }),
      limit: async () => (isNotFound ? { data: [] } : { data: null, error: errorReturned }),
    }),
    upsert:
      upsertFn ||
      (() => ({
        select: async () => ({ data: null }),
      })),
  };
  jest
    .spyOn(supabase, 'from')
    .mockImplementation(
      () => queryMock as unknown as ReturnType<NonNullable<typeof supabase>['from']>,
    );
}

function mockSupabaseSelectAndUpsert(upsertFn?: UpsertMockFn) {
  if (!supabase) return;
  const queryMock = {
    select: () => ({
      eq: () => ({
        single: async () => ({ data: null }),
        limit: async () => ({ data: [] }),
      }),
      limit: async () => ({ data: [] }),
    }),
    upsert:
      upsertFn ||
      (() => ({
        select: async () => ({ data: null }),
      })),
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
    jest.spyOn(redis, 'hGet').mockImplementation(async () => 'ABCDEF01');

    const hash = await userService.getSpeakerHash('123');
    expect(hash).toBe('ABCDEF01');
  });

  it('should generate and return an 8-char hash if not in cache', async () => {
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    const hash = await userService.getSpeakerHash('123');
    expect(hash).toHaveLength(8);
    expect(hash).toBe('1B581DBD');
  });

  it('should compute hash via error fallback path if an exception occurs during cache lookup', async () => {
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    jest.spyOn(redis, 'hGet').mockImplementation(async () => {
      throw new Error('Redis connection failed');
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const hash = await userService.getSpeakerHash('123');
    expect(hash).toBe('1B581DBD');
    expect(errorSpy).toHaveBeenCalledWith(
      '[UserService] getSpeakerHash error:',
      'Redis connection failed',
    );
  });

  it('should preserve existing valid 8-char hash from Supabase when Redis lookup and write fail', async () => {
    const existingHash = 'FBF12345';
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    jest.spyOn(redis, 'hGet').mockImplementation(async () => {
      throw new Error('Redis connection failed');
    });
    jest.spyOn(redis, 'hSet').mockImplementation(async () => {
      throw new Error('Redis write failed');
    });
    mockSupabaseSelect(existingHash);

    const hash = await userService.getSpeakerHash('123');
    expect(hash).toBe(existingHash);
  });

  it('should populate Redis cache with existing valid Supabase hash for continuity', async () => {
    const existingHash = 'FBF12345';
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);
    const hSetSpy = jest.spyOn(redis, 'hSet').mockImplementation(async () => 1);
    mockSupabaseSelect(existingHash);

    const hash = await userService.getSpeakerHash('123');
    expect(hash).toBe(existingHash);
    expect(hSetSpy).toHaveBeenCalledWith('user:resolved@s.whatsapp.net:data', 'hash', existingHash);
  });

  it('should deterministically produce exact 8-char uppercase SHA-256 hash for new users across diverse JIDs', async () => {
    const cryptoModule = await import('node:crypto');
    const testJids = ['user1@s.whatsapp.net', 'user2@s.whatsapp.net', 'user3@s.whatsapp.net'];

    for (const testJid of testJids) {
      jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => testJid);
      jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

      const expected = cryptoModule
        .createHash('sha256')
        .update(testJid)
        .digest('hex')
        .substring(0, 8)
        .toUpperCase();

      const hash = await userService.getSpeakerHash(testJid);
      expect(hash).toBe(expected);
      expect(hash).toHaveLength(8);
      expect(hash).toMatch(/^[0-9A-F]{8}$/);
    }
  });

  it('should avoid collisions for distinct JIDs that share the first 3 hex characters (e.g. 0C2)', async () => {
    const cryptoModule = await import('node:crypto');
    const jid1 = '4477009000040@s.whatsapp.net';
    const jid2 = '4477009000112@s.whatsapp.net';

    // Verify that legacy 3-char truncation caused a collision
    const legacy3Char1 = cryptoModule
      .createHash('sha256')
      .update(jid1)
      .digest('hex')
      .substring(0, 3)
      .toUpperCase();
    const legacy3Char2 = cryptoModule
      .createHash('sha256')
      .update(jid2)
      .digest('hex')
      .substring(0, 3)
      .toUpperCase();
    expect(legacy3Char1).toBe('0C2');
    expect(legacy3Char2).toBe('0C2');
    expect(legacy3Char1).toBe(legacy3Char2);

    // Verify that 8-char computeSpeakerHash produces distinct hashes
    const hash1 = userService.computeSpeakerHash(jid1);
    const hash2 = userService.computeSpeakerHash(jid2);
    expect(hash1).toBe('0C275883');
    expect(hash2).toBe('0C2E0893');
    expect(hash1).not.toBe(hash2);
    expect(hash1).toHaveLength(8);
    expect(hash2).toHaveLength(8);

    // Verify that getSpeakerHash generates and returns distinct hashes for both users
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async (j) => j ?? null);
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    const speakerHash1 = await userService.getSpeakerHash(jid1);
    const speakerHash2 = await userService.getSpeakerHash(jid2);
    expect(speakerHash1).toBe('0C275883');
    expect(speakerHash2).toBe('0C2E0893');
    expect(speakerHash1).not.toBe(speakerHash2);
  });

  it('should resolve collisions and produce distinct hashes for distinct JIDs with identical initial 8-hex SHA-256', async () => {
    const jid1 = '4477009016300@s.whatsapp.net';
    const jid2 = '4477009088614@s.whatsapp.net';

    // Verify both JIDs share identical attempt-0 8-hex SHA-256 hash (CB1421A6)
    expect(userService.computeSpeakerHash(jid1, 0)).toBe('CB1421A6');
    expect(userService.computeSpeakerHash(jid2, 0)).toBe('CB1421A6');

    const upsertSpy = jest.fn(
      (_values?: { jid: string; hash: string }, _options?: { onConflict?: string }) => ({
        select: async () => ({ data: null }),
      }),
    );
    mockSupabaseSelectAndUpsert(upsertSpy);
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async (j) => j ?? null);
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    const hash1 = await userService.getSpeakerHash(jid1);
    const hash2 = await userService.getSpeakerHash(jid2);

    expect(hash1).toBe('CB1421A6');
    expect(hash2).not.toBe(hash1);
    expect(hash2).toHaveLength(8);
    expect(hash2).toBe(userService.computeSpeakerHash(jid2, 1));
    expect(upsertSpy).toHaveBeenCalledWith({ jid: jid1, hash: hash1 }, { onConflict: 'jid' });
    expect(upsertSpy).toHaveBeenCalledWith({ jid: jid2, hash: hash2 }, { onConflict: 'jid' });
  });

  it('should fall back to deterministic SHA-256 calculation when both Redis and Supabase fail', async () => {
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    jest.spyOn(redis, 'hGet').mockImplementation(async () => {
      throw new Error('Redis connection failed');
    });
    let fromSpy: jest.SpiedFunction<NonNullable<typeof supabase>['from']> | undefined;
    if (supabase) {
      fromSpy = jest.spyOn(supabase, 'from').mockImplementation(() => {
        throw new Error('Supabase unreachable');
      });
    }
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const hash = await userService.getSpeakerHash('123');
    expect(hash).toBe('1B581DBD');
    if (fromSpy) {
      expect(fromSpy).toHaveBeenCalled();
    }
    expect(errorSpy).toHaveBeenCalled();
  });

  it('should reject invalid or corrupted hash in Redis cache, fall back to deterministic SHA-256 and re-persist', async () => {
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    const hSetSpy = jest.spyOn(redis, 'hSet').mockImplementation(async () => 1);

    for (const corruptedHash of ['XYZ', 'CORRUPTED']) {
      hSetSpy.mockClear();
      jest.spyOn(redis, 'hGet').mockImplementation(async () => corruptedHash);

      const hash = await userService.getSpeakerHash('123');
      expect(hash).toBe('1B581DBD');
      expect(hSetSpy).toHaveBeenCalledWith('user:resolved@s.whatsapp.net:data', 'hash', '1B581DBD');
    }
  });

  it('should reject invalid or corrupted hash in Supabase, fall back to deterministic SHA-256 and re-persist to both cache and DB', async () => {
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);
    const hSetSpy = jest.spyOn(redis, 'hSet').mockImplementation(async () => 1);

    for (const corruptedHash of ['CORRUPTED', 'XYZ']) {
      hSetSpy.mockClear();
      const upsertSpy = jest.fn(
        (_values: { jid: string; hash: string }, _options?: { onConflict?: string }) => ({
          select: async () => ({ data: null }),
        }),
      );
      mockSupabaseSelect(corruptedHash, upsertSpy);

      const hash = await userService.getSpeakerHash('123');
      expect(hash).toBe('1B581DBD');
      expect(hSetSpy).toHaveBeenCalledWith('user:resolved@s.whatsapp.net:data', 'hash', '1B581DBD');
      expect(upsertSpy).toHaveBeenCalledWith(
        { jid: 'resolved@s.whatsapp.net', hash: '1B581DBD' },
        { onConflict: 'jid' },
      );
    }
  });
}

function registerSpeakerHashMigrationTests() {
  it('should migrate legacy 3-char hash in Redis to deterministic 8-char hash', async () => {
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    jest.spyOn(redis, 'hGet').mockImplementation(async () => 'ABC');
    const hSetSpy = jest.spyOn(redis, 'hSet').mockImplementation(async () => 1);

    const hash = await userService.getSpeakerHash('123');
    expect(hash).toBe('1B581DBD');
    expect(hSetSpy).toHaveBeenCalledWith('user:resolved@s.whatsapp.net:data', 'hash', '1B581DBD');
  });

  it('should migrate legacy 3-char hash in Supabase to deterministic 8-char hash resolving collisions', async () => {
    const jid1 = '4477009000040@s.whatsapp.net';
    const jid2 = '4477009000112@s.whatsapp.net';
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async (j) => j ?? null);
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    const upsertSpy = jest.fn(
      (_values: { jid: string; hash: string }, _options?: { onConflict?: string }) => ({
        select: async () => ({ data: null }),
      }),
    );
    mockSupabaseSelect('0C2', upsertSpy);

    const speakerHash1 = await userService.getSpeakerHash(jid1);
    const speakerHash2 = await userService.getSpeakerHash(jid2);

    expect(speakerHash1).toBe('0C275883');
    expect(speakerHash2).toBe('0C2E0893');
    expect(speakerHash1).not.toBe(speakerHash2);
    expect(upsertSpy).toHaveBeenCalledWith({ jid: jid1, hash: '0C275883' }, { onConflict: 'jid' });
    expect(upsertSpy).toHaveBeenCalledWith({ jid: jid2, hash: '0C2E0893' }, { onConflict: 'jid' });
  });

  it('should not overwrite stored Supabase identity when a transient read error occurs', async () => {
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    const upsertSpy = jest.fn(() => ({
      select: async () => ({ data: null }),
    }));

    mockSupabaseSelectError(new Error('Supabase network timeout'), upsertSpy);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const hash = await userService.getSpeakerHash('123');
    expect(hash).toBe('1B581DBD');
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('should keep outage fallback stable when both Redis and Supabase fail transiently', async () => {
    userService._clearLidCacheForTesting();
    const testJid = '123@s.whatsapp.net';
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => testJid);
    const expectedOutageHash = userService.computeSpeakerHash(testJid);

    jest.spyOn(redis, 'hGet').mockRejectedValue(new Error('Redis down'));
    const upsertSpy = jest.fn(() => ({
      select: async () => ({ data: null }),
    }));
    mockSupabaseSelectReturnedError(
      { code: 'PGRST500', message: 'Transient connection timeout' },
      upsertSpy,
    );

    const outageHash = await userService.getSpeakerHash(testJid);
    expect(outageHash).toBe(expectedOutageHash);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('should keep outage fallback stable from cold state when Redis has legacy hash but Supabase is down', async () => {
    userService._clearLidCacheForTesting();
    const testJid = '123@s.whatsapp.net';
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => testJid);
    const expectedOutageHash = userService.computeSpeakerHash(testJid);

    jest.spyOn(redis, 'hGet').mockResolvedValue('ABC');
    const upsertSpy = jest.fn(() => ({
      select: async () => ({ data: null }),
    }));
    mockSupabaseSelectReturnedError(
      { code: 'PGRST500', message: 'Transient connection timeout' },
      upsertSpy,
    );

    const partialRecoveryHash = await userService.getSpeakerHash(testJid);
    expect(partialRecoveryHash).toBe(expectedOutageHash);
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('should persist a new hash when Supabase returns PGRST116 not found error', async () => {
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);
    const upsertSpy = jest.fn(
      (_values?: { jid: string; hash: string }, _options?: { onConflict?: string }) => ({
        select: async () => ({ data: null }),
      }),
    );
    mockSupabaseSelectReturnedError(
      { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' },
      upsertSpy,
    );

    const hash = await userService.getSpeakerHash('123');
    expect(hash).toBe('1B581DBD');
    expect(upsertSpy).toHaveBeenCalledWith(
      { jid: 'resolved@s.whatsapp.net', hash: '1B581DBD' },
      { onConflict: 'jid' },
    );
  });

  it('should return computed hash without calling upsert when Supabase returns a non-not-found error', async () => {
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);
    const upsertSpy = jest.fn(() => ({
      select: async () => ({ data: null }),
    }));
    mockSupabaseSelectReturnedError(
      { code: 'PGRST500', message: 'Database connection failed' },
      upsertSpy,
    );

    const hash = await userService.getSpeakerHash('123');
    expect(hash).toBe('1B581DBD');
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('should preserve valid current Supabase hash and heal Redis when Redis contains a legacy hash', async () => {
    const existingValidHash = 'A1B2C3D4';
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async () => 'resolved@s.whatsapp.net');
    jest.spyOn(redis, 'hGet').mockImplementation(async () => 'ABC');
    const hSetSpy = jest.spyOn(redis, 'hSet').mockImplementation(async () => 1);
    mockSupabaseSelect(existingValidHash);

    const hash = await userService.getSpeakerHash('123');
    expect(hash).toBe(existingValidHash);
    expect(hSetSpy).toHaveBeenCalledWith(
      'user:resolved@s.whatsapp.net:data',
      'hash',
      existingValidHash,
    );
  });
}

function registerSpeakerHashCollisionTests() {
  it('should detect and repair previously stored colliding hash in Redis cache', async () => {
    userService._clearLidCacheForTesting();
    const jid1 = '4477009016300@s.whatsapp.net';
    const jid2 = '4477009088614@s.whatsapp.net';
    expect(userService.computeSpeakerHash(jid1, 0)).toBe('CB1421A6');
    expect(userService.computeSpeakerHash(jid2, 0)).toBe('CB1421A6');

    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async (j) => j ?? null);

    const upsertSpy = jest.fn(
      (_values?: { jid: string; hash: string }, _options?: { onConflict?: string }) => ({
        select: async () => ({ data: null }),
      }),
    );
    mockSupabaseSelectAndUpsert(upsertSpy);
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);
    const hSetSpy = jest.spyOn(redis, 'hSet');

    const hash1 = await userService.getSpeakerHash(jid1);
    expect(hash1).toBe('CB1421A6');

    // JID 2 has stored colliding value 'CB1421A6' in Redis
    jest.spyOn(redis, 'hGet').mockImplementation(async () => 'CB1421A6');
    const hash2 = await userService.getSpeakerHash(jid2);

    expect(hash2).not.toBe('CB1421A6');
    expect(hash2).toHaveLength(8);
    expect(hash2).toBe(userService.computeSpeakerHash(jid2, 1));
    expect(upsertSpy).toHaveBeenCalledWith({ jid: jid2, hash: hash2 }, { onConflict: 'jid' });
    expect(hSetSpy).toHaveBeenCalledWith(`user:${jid2}:data`, 'hash', hash2);
  });

  it('should detect and repair previously stored colliding hash in Supabase persistence', async () => {
    userService._clearLidCacheForTesting();
    const jid1 = '4477009016300@s.whatsapp.net';
    const jid2 = '4477009088614@s.whatsapp.net';

    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async (j) => j ?? null);
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    const upsertSpy = jest.fn(
      (_values?: { jid: string; hash: string }, _options?: { onConflict?: string }) => ({
        select: async () => ({ data: null }),
      }),
    );

    const queryMock = {
      select: () => ({
        eq: (_field: string, val: string) => ({
          single: async () => ({ data: { hash: 'CB1421A6' } }),
          limit: async () => ({
            data: val === 'CB1421A6' ? [{ jid: jid1 }, { jid: jid2 }] : [],
          }),
        }),
        limit: async () => ({ data: [] }),
      }),
      upsert: upsertSpy,
    };
    if (supabase) {
      jest
        .spyOn(supabase, 'from')
        .mockImplementation(
          () => queryMock as unknown as ReturnType<NonNullable<typeof supabase>['from']>,
        );
    }

    // Direct cold-state call for jid2 without preloading jid1 in memory
    const hash2 = await userService.getSpeakerHash(jid2);
    expect(hash2).not.toBe('CB1421A6');
    expect(hash2).toHaveLength(8);
    expect(hash2).toBe(userService.computeSpeakerHash(jid2, 1));
    expect(upsertSpy).toHaveBeenCalledWith({ jid: jid2, hash: hash2 }, { onConflict: 'jid' });
  });

  it('should detect candidate collision when requester is returned in slot zero before a distinct owner in Supabase', async () => {
    userService._clearLidCacheForTesting();
    const requester = 'requester@s.whatsapp.net';
    const distinctOwner = 'distinct@s.whatsapp.net';
    const candidate0 = userService.computeSpeakerHash(requester, 0);

    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async (j) => j ?? null);
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    const upsertSpy = jest.fn(
      (_values?: { jid: string; hash: string }, _options?: { onConflict?: string }) => ({
        select: async () => ({ data: null }),
      }),
    );

    const queryMock = {
      select: () => ({
        eq: (_field: string, val: string) => ({
          single: async () => ({ data: null, error: { code: 'PGRST116' } }),
          limit: async () => ({
            data: val === candidate0 ? [{ jid: requester }, { jid: distinctOwner }] : [],
          }),
        }),
        limit: async () => ({ data: [] }),
      }),
      upsert: upsertSpy,
    };
    if (supabase) {
      jest
        .spyOn(supabase, 'from')
        .mockImplementation(
          () => queryMock as unknown as ReturnType<NonNullable<typeof supabase>['from']>,
        );
    }

    const hash = await userService.getSpeakerHash(requester);
    expect(hash).not.toBe(candidate0);
    expect(hash).toHaveLength(8);
    expect(hash).toBe(userService.computeSpeakerHash(requester, 1));
    expect(upsertSpy).toHaveBeenCalledWith({ jid: requester, hash }, { onConflict: 'jid' });
  });

  it('should retain verified collision attempt during Supabase read outage rather than reverting to attempt zero', async () => {
    userService._clearLidCacheForTesting();
    const jid1 = '4477009016300@s.whatsapp.net';
    const jid2 = '4477009088614@s.whatsapp.net';

    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async (j) => j ?? null);
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    const upsertSpy = jest.fn(
      (_values?: { jid: string; hash: string }, _options?: { onConflict?: string }) => ({
        select: async () => ({ data: null }),
      }),
    );
    mockSupabaseSelectAndUpsert(upsertSpy);

    const hash1 = await userService.getSpeakerHash(jid1);
    expect(hash1).toBe('CB1421A6');

    const hash2 = await userService.getSpeakerHash(jid2);
    expect(hash2).toBe(userService.computeSpeakerHash(jid2, 1));

    mockSupabaseSelectError(new Error('Transient connection timeout'));

    const outageHash2 = await userService.getSpeakerHash(jid2);
    expect(outageHash2).toBe(hash2);
    expect(outageHash2).not.toBe('CB1421A6');
  });
}

function registerSpeakerHashLidResilienceTests() {
  it('should not create durable speaker identity in Redis or Supabase when LID resolution temporarily fails', async () => {
    userService._clearLidCacheForTesting();
    const testLid = '123456789@lid';
    jest
      .spyOn(userService, 'resolveLid')
      .mockRejectedValue(new Error('Resolver transient timeout'));
    const hSetSpy = jest.spyOn(redis, 'hSet').mockImplementation(async () => 1);
    const upsertSpy = jest.fn(
      (_values?: { jid: string; hash: string }, _options?: { onConflict?: string }) => ({
        select: async () => ({ data: null }),
      }),
    );
    mockSupabaseSelectAndUpsert(upsertSpy);

    const hash = await userService.getSpeakerHash(testLid);
    expect(hash).toBe(userService.computeSpeakerHash(testLid));
    expect(hSetSpy).not.toHaveBeenCalled();
    expect(upsertSpy).not.toHaveBeenCalled();
  });

  it('should preserve canonical identity and avoid key split across LID resolution failure and recovery', async () => {
    userService._clearLidCacheForTesting();
    const testLid = '987654321@lid';
    const canonicalJid = '33612345678@s.whatsapp.net';
    const upsertSpy = jest.fn(
      (_values?: { jid: string; hash: string }, _options?: { onConflict?: string }) => ({
        select: async () => ({ data: null }),
      }),
    );
    mockSupabaseSelectAndUpsert(upsertSpy);

    // Step 1: Pre-register canonical mapping
    await userService.registerLid(canonicalJid, testLid);

    // Step 2: Resolver encounters transient failure
    jest.spyOn(userService, 'resolveLid').mockRejectedValueOnce(new Error('Transient failure'));
    const hashDuringFailure = await userService.getSpeakerHash(testLid);

    // Step 3: Resolver recovers
    jest.spyOn(userService, 'resolveLid').mockResolvedValue(canonicalJid);
    const hashAfterRecovery = await userService.getSpeakerHash(testLid);

    // Identity must not split: both hashes must equal the canonical JID hash
    const expectedCanonicalHash = userService.computeSpeakerHash(canonicalJid);
    expect(hashDuringFailure).toBe(expectedCanonicalHash);
    expect(hashAfterRecovery).toBe(expectedCanonicalHash);

    // Durable identity in Supabase must only be keyed by canonical JID, never raw LID
    expect(upsertSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ jid: testLid }),
      expect.anything(),
    );
  });

  it('should preserve registered canonical mapping when resolving a device-qualified LID and not accept normalized LID as canonical', async () => {
    userService._clearLidCacheForTesting();
    const baseLid = '987654321@lid';
    const deviceLid = '987654321:12@lid';
    const canonicalJid = '33612345678@s.whatsapp.net';
    const upsertSpy = jest.fn(
      (_values?: { jid: string; hash: string }, _options?: { onConflict?: string }) => ({
        select: async () => ({ data: null }),
      }),
    );
    mockSupabaseSelectAndUpsert(upsertSpy);

    // Step 1: Pre-register canonical mapping
    await userService.registerLid(canonicalJid, baseLid);

    // Step 2: Mock resolveLid returning the stripped LID (IdentityMap unmapped fallback)
    jest
      .spyOn(userService, 'resolveLid')
      .mockImplementation(async (id) => id.replace(/:\d+@/, '@'));

    // Step 3: Verify getSpeakerHash on device-qualified LID resolves to canonical JID hash
    const expectedCanonicalHash = userService.computeSpeakerHash(canonicalJid);
    const hashForDeviceLid = await userService.getSpeakerHash(deviceLid);
    expect(hashForDeviceLid).toBe(expectedCanonicalHash);
    expect(hashForDeviceLid).not.toBe(userService.computeSpeakerHash(deviceLid));
    expect(hashForDeviceLid).not.toBe(userService.computeSpeakerHash(baseLid));

    // Step 4: Verify that the in-memory cache was not poisoned with the raw LID
    const hashForBaseLid = await userService.getSpeakerHash(baseLid);
    expect(hashForBaseLid).toBe(expectedCanonicalHash);

    // Step 5: Verify no durable identity is persisted for LID
    expect(upsertSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ jid: deviceLid }),
      expect.anything(),
    );
    expect(upsertSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ jid: baseLid }),
      expect.anything(),
    );
  });
}

function registerSpeakerHashConcurrencyTests() {
  it('should retry allocation and resolve collision when Supabase returns unique constraint violation on hash', async () => {
    userService._clearLidCacheForTesting();
    const requester = 'requester_concurrent@s.whatsapp.net';
    const candidate0 = userService.computeSpeakerHash(requester, 0);
    const candidate1 = userService.computeSpeakerHash(requester, 1);

    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async (j) => j ?? null);
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    const upsertSpy = jest.fn(
      (values?: { jid: string; hash: string }, _options?: { onConflict?: string }) => ({
        select: async () => {
          if (values?.hash === candidate0) {
            return {
              data: null,
              error: {
                code: '23505',
                message: 'duplicate key value violates unique constraint "users_hash_key"',
              },
            };
          }
          return { data: null, error: null };
        },
      }),
    );
    mockSupabaseSelectAndUpsert(upsertSpy);

    const hash = await userService.getSpeakerHash(requester);
    expect(hash).toBe(candidate1);
    expect(hash).not.toBe(candidate0);
    expect(upsertSpy).toHaveBeenCalledWith(
      { jid: requester, hash: candidate0 },
      { onConflict: 'jid' },
    );
    expect(upsertSpy).toHaveBeenCalledWith(
      { jid: requester, hash: candidate1 },
      { onConflict: 'jid' },
    );
  });

  it('should detect collision and retry when Redis is absent and concurrent owner is detected in Supabase post-upsert check', async () => {
    userService._clearLidCacheForTesting();
    const requester = 'second_worker@s.whatsapp.net';
    const firstOwner = 'first_worker@s.whatsapp.net';
    const candidate0 = userService.computeSpeakerHash(requester, 0);
    const candidate1 = userService.computeSpeakerHash(requester, 1);

    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async (j) => j ?? null);
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);
    const setSpy = jest
      .spyOn(redis, 'set')
      .mockImplementation(async () => null as unknown as string);

    let candidate0Upserted = false;
    const upsertSpy = jest.fn(
      (values?: { jid: string; hash: string }, _options?: { onConflict?: string }) => {
        if (values?.hash === candidate0) {
          candidate0Upserted = true;
        }
        return {
          select: async () => ({ data: null }),
        };
      },
    );

    const queryMock = {
      select: () => ({
        eq: (_field: string, val: string) => ({
          single: async () => ({ data: null, error: { code: 'PGRST116' } }),
          limit: async () => {
            if (val === candidate0 && candidate0Upserted) {
              return { data: [{ jid: requester }, { jid: firstOwner }] };
            }
            return { data: [] };
          },
        }),
        limit: async () => ({ data: [] }),
      }),
      upsert: upsertSpy,
    };
    if (supabase) {
      jest
        .spyOn(supabase, 'from')
        .mockImplementation(
          () => queryMock as unknown as ReturnType<NonNullable<typeof supabase>['from']>,
        );
    }

    const hash = await userService.getSpeakerHash(requester);
    expect(hash).toBe(candidate1);
    expect(hash).not.toBe(candidate0);
    expect(upsertSpy).toHaveBeenCalledWith(
      { jid: requester, hash: candidate0 },
      { onConflict: 'jid' },
    );
    expect(upsertSpy).toHaveBeenCalledWith(
      { jid: requester, hash: candidate1 },
      { onConflict: 'jid' },
    );
    setSpy.mockRestore();
  });
}

function registerSpeakerHashReservationAndRaceTests() {
  it('should release abandoned candidate reservation in Redis and memory when Supabase persistence collides', async () => {
    userService._clearLidCacheForTesting();
    const requester = 'releasing_worker@s.whatsapp.net';
    const candidate0 = userService.computeSpeakerHash(requester, 0);
    const candidate1 = userService.computeSpeakerHash(requester, 1);

    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async (j) => j ?? null);
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    const redisStore = new Map<string, string>();
    redisStore.set(`hash:owner:${candidate0}`, requester);

    const evalSpy = jest.spyOn(redis, 'eval').mockImplementation(async (_script, options) => {
      const opts = options as { keys?: string[]; arguments?: string[] };
      const key = opts?.keys?.[0];
      const expectedOwner = opts?.arguments?.[0];
      if (key && redisStore.get(key) === expectedOwner) {
        redisStore.delete(key);
        return 1;
      }
      return 0;
    });
    const setSpy = jest.spyOn(redis, 'set').mockImplementation(async (key, val, options) => {
      if (options && typeof options === 'object' && 'NX' in options && options.NX) {
        if (redisStore.has(String(key))) {
          return null as unknown as string;
        }
      }
      redisStore.set(String(key), String(val));
      return 'OK';
    });

    const upsertSpy = jest.fn(
      (values?: { jid: string; hash: string }, _options?: { onConflict?: string }) => ({
        select: async () => {
          if (values?.hash === candidate0) {
            return {
              data: null,
              error: {
                message: 'Transient connection timeout',
              },
            };
          }
          return { data: null, error: null };
        },
      }),
    );
    mockSupabaseSelectAndUpsert(upsertSpy);
    const hash = await userService.getSpeakerHash(requester);
    expect(hash).toBe(candidate1);
    expect(evalSpy).toHaveBeenCalledWith(expect.stringContaining('redis.call("del", KEYS[1])'), {
      keys: [`hash:owner:${candidate0}`],
      arguments: [requester],
    });
    expect(redisStore.has(`hash:owner:${candidate0}`)).toBe(false);

    // Verify candidate0 was also removed from the in-memory ownership map by reclaiming it
    const reclaimer = 'reclaimer@s.whatsapp.net';
    const computeSpy = jest
      .spyOn(userService, 'computeSpeakerHash')
      .mockImplementation((jid, attempt) => {
        if (jid === reclaimer && attempt === 0) {
          return candidate0;
        }
        return 'FALLBACK1';
      });

    const reclaimUpsert = jest.fn(() => ({
      select: async () => ({ data: null, error: null }),
    }));
    mockSupabaseSelectAndUpsert(reclaimUpsert);

    const reclaimedHash = await userService.getSpeakerHash(reclaimer);
    expect(reclaimedHash).toBe(candidate0);

    computeSpy.mockRestore();
    evalSpy.mockRestore();
    setSpy.mockRestore();
  });

  it('should not delete replacement owner when candidate reservation release races with new owner', async () => {
    userService._clearLidCacheForTesting();
    const originalRequester = 'original_worker@s.whatsapp.net';
    const replacementWorker = 'replacement_worker@s.whatsapp.net';
    const candidate0 = userService.computeSpeakerHash(originalRequester, 0);

    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async (j) => j ?? null);
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    const redisStore = new Map<string, string>();
    const evalSpy = jest.spyOn(redis, 'eval').mockImplementation(async (_script, options) => {
      const opts = options as { keys?: string[]; arguments?: string[] };
      const key = opts?.keys?.[0];
      const expectedOwner = opts?.arguments?.[0];
      // Simulate another worker claiming the candidate before release executes
      redisStore.set(`hash:owner:${candidate0}`, replacementWorker);
      if (key && redisStore.get(key) === expectedOwner) {
        redisStore.delete(key);
        return 1;
      }
      return 0;
    });

    const upsertSpy = jest.fn(
      (values?: { jid: string; hash: string }, _options?: { onConflict?: string }) => ({
        select: async () => {
          if (values?.hash === candidate0) {
            return {
              data: null,
              error: { message: 'Transient timeout' },
            };
          }
          return { data: null, error: null };
        },
      }),
    );
    mockSupabaseSelectAndUpsert(upsertSpy);

    await userService.getSpeakerHash(originalRequester);
    expect(redisStore.get(`hash:owner:${candidate0}`)).toBe(replacementWorker);

    evalSpy.mockRestore();
  });

  it('should fallback to outage hash when candidate allocation fails completely instead of throwing unhandled error', async () => {
    userService._clearLidCacheForTesting();
    const requester = 'outage_requester@s.whatsapp.net';
    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async (j) => j ?? null);
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    const queryMock = {
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: { code: 'PGRST116' } }),
          limit: async () => ({ data: null, error: { message: 'Fatal DB outage' } }),
        }),
        limit: async () => ({ data: null, error: { message: 'Fatal DB outage' } }),
      }),
      upsert: () => ({
        select: async () => ({ data: null, error: { message: 'Fatal DB outage' } }),
      }),
    };
    if (supabase) {
      jest
        .spyOn(supabase, 'from')
        .mockImplementation(
          () => queryMock as unknown as ReturnType<NonNullable<typeof supabase>['from']>,
        );
    }

    const hash = await userService.getSpeakerHash(requester);
    expect(hash).toHaveLength(8);
    expect(hash).toBe(userService.computeSpeakerHash(requester, 0));
  });
}

function registerSpeakerHashFallbackAndNormalizationTests() {
  it('should not delete reservation non-atomically when redis.eval is not a function to prevent TOCTOU', async () => {
    userService._clearLidCacheForTesting();
    const requester = 'eval_fallback_worker@s.whatsapp.net';
    const candidate0 = userService.computeSpeakerHash(requester, 0);
    const candidate1 = userService.computeSpeakerHash(requester, 1);

    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async (j) => j ?? null);
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    const redisStore = new Map<string, string>();
    redisStore.set(`hash:owner:${candidate0}`, requester);

    const originalEval = redis.eval;
    (redis as unknown as { eval?: unknown }).eval = undefined;

    const delSpy = jest.spyOn(redis, 'del').mockImplementation(async (key) => {
      redisStore.delete(String(key));
      return 1;
    });

    const upsertSpy = jest.fn(
      (values?: { jid: string; hash: string }, _options?: { onConflict?: string }) => ({
        select: async () => {
          if (values?.hash === candidate0) {
            return {
              data: null,
              error: { message: 'Transient timeout' },
            };
          }
          return { data: null, error: null };
        },
      }),
    );
    mockSupabaseSelectAndUpsert(upsertSpy);

    const hash = await userService.getSpeakerHash(requester);
    expect(hash).toBe(candidate1);
    expect(delSpy).not.toHaveBeenCalled();
    expect(redisStore.get(`hash:owner:${candidate0}`)).toBe(requester);

    (redis as unknown as { eval?: unknown }).eval = originalEval;
    delSpy.mockRestore();
  });

  it('should recognize same user across device suffixes when checking stored Supabase collision', async () => {
    userService._clearLidCacheForTesting();
    const requester = 'device_user@s.whatsapp.net';
    const storedHash = 'BADC0FFE';

    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async (j) => j ?? null);
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    const queryMock = {
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { hash: storedHash }, error: null }),
          limit: async () => ({
            data: [{ jid: 'device_user:2@s.whatsapp.net' }],
            error: null,
          }),
        }),
        limit: async () => ({
          data: [{ jid: 'device_user:2@s.whatsapp.net' }],
          error: null,
        }),
      }),
      upsert: () => ({
        select: async () => ({ data: null, error: null }),
      }),
    };
    if (supabase) {
      jest
        .spyOn(supabase, 'from')
        .mockImplementation(
          () => queryMock as unknown as ReturnType<NonNullable<typeof supabase>['from']>,
        );
    }

    const hash = await userService.getSpeakerHash(requester);
    expect(hash).toBe(storedHash);
  });

  it('should pass NX option to redis.set when recording stored owner', async () => {
    userService._clearLidCacheForTesting();
    const requester = 'nx_test_user@s.whatsapp.net';
    const storedHash = 'AABBCCDD';

    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async (j) => j ?? null);
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    const setSpy = jest.spyOn(redis, 'set').mockResolvedValue('OK');
    const queryMock = {
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { hash: storedHash }, error: null }),
          limit: async () => ({ data: [], error: null }),
        }),
        limit: async () => ({ data: [], error: null }),
      }),
      upsert: () => ({
        select: async () => ({ data: null, error: null }),
      }),
    };
    if (supabase) {
      jest
        .spyOn(supabase, 'from')
        .mockImplementation(
          () => queryMock as unknown as ReturnType<NonNullable<typeof supabase>['from']>,
        );
    }

    const hash = await userService.getSpeakerHash(requester);
    expect(hash).toBe(storedHash);
    expect(setSpy).toHaveBeenCalledWith(
      `hash:owner:${storedHash}`,
      requester,
      expect.objectContaining({ NX: true }),
    );
    setSpy.mockRestore();
  });

  it('should set bounded TTL (EX) when reserving candidate in Redis to prevent indefinite lockouts on eval failure', async () => {
    userService._clearLidCacheForTesting();
    const requester = 'ttl_test_user@s.whatsapp.net';
    const candidate0 = userService.computeSpeakerHash(requester, 0);

    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async (j) => j ?? null);
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    const setSpy = jest.spyOn(redis, 'set').mockResolvedValue('OK');
    const queryMock = {
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: { code: 'PGRST116' } }),
          limit: async () => ({ data: [], error: null }),
        }),
        limit: async () => ({ data: [], error: null }),
      }),
      upsert: () => ({
        select: async () => ({ data: null, error: null }),
      }),
    };
    if (supabase) {
      jest
        .spyOn(supabase, 'from')
        .mockImplementation(
          () => queryMock as unknown as ReturnType<NonNullable<typeof supabase>['from']>,
        );
    }

    const hash = await userService.getSpeakerHash(requester);
    expect(hash).toBe(candidate0);

    // Initial temporary reservation MUST have NX and EX
    expect(setSpy).toHaveBeenCalledWith(
      `hash:owner:${candidate0}`,
      requester,
      expect.objectContaining({ NX: true, EX: expect.any(Number) }),
    );
    // Verified confirmed owner write (after persistence) does NOT have EX (permanent)
    expect(setSpy).toHaveBeenCalledWith(`hash:owner:${candidate0}`, requester);

    setSpy.mockRestore();
  });

  it('should treat device-suffixed owner in Redis as same user during candidate reservation', async () => {
    userService._clearLidCacheForTesting();
    const requester = 'device_reserve_user@s.whatsapp.net';
    const candidate0 = userService.computeSpeakerHash(requester, 0);

    jest.spyOn(IdentityMap, 'resolve').mockImplementation(async (j) => j ?? null);
    jest.spyOn(redis, 'hGet').mockImplementation(async () => null);

    // First NX fails (already reserved)
    const setSpy = jest.spyOn(redis, 'set').mockResolvedValue(null as unknown as string);
    // get returns owner with device suffix
    const getSpy = jest
      .spyOn(redis, 'get')
      .mockResolvedValue('device_reserve_user:1@s.whatsapp.net');

    const queryMock = {
      select: () => ({
        eq: () => ({
          single: async () => ({ data: null, error: { code: 'PGRST116' } }),
          limit: async () => ({ data: [], error: null }),
        }),
        limit: async () => ({ data: [], error: null }),
      }),
      upsert: () => ({
        select: async () => ({ data: null, error: null }),
      }),
    };
    if (supabase) {
      jest
        .spyOn(supabase, 'from')
        .mockImplementation(
          () => queryMock as unknown as ReturnType<NonNullable<typeof supabase>['from']>,
        );
    }

    const hash = await userService.getSpeakerHash(requester);
    expect(hash).toBe(candidate0);

    setSpy.mockRestore();
    getSpy.mockRestore();
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
      jest.spyOn(redis, 'set').mockImplementation(async () => 'OK');
      jest.spyOn(redis, 'get').mockImplementation(async () => null);
      jest.spyOn(redis, 'del').mockImplementation(async () => 1);
      jest.spyOn(redis, 'connect').mockImplementation(async () => redis);
    }

    mockSupabaseSelectAndUpsert();
    if (typeof userService?._clearLidCacheForTesting === 'function') {
      userService._clearLidCacheForTesting();
    }
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
  describe('getSpeakerHash() - Migration & Resilience', registerSpeakerHashMigrationTests);
  describe('getSpeakerHash() - Collision Repair', registerSpeakerHashCollisionTests);
  describe('getSpeakerHash() - LID Resilience', registerSpeakerHashLidResilienceTests);
  describe('getSpeakerHash() - Concurrency & Uniqueness', registerSpeakerHashConcurrencyTests);
  describe(
    'getSpeakerHash() - Atomic Release & Race Resilience',
    registerSpeakerHashReservationAndRaceTests,
  );
  describe(
    'getSpeakerHash() - Fallback & Normalization',
    registerSpeakerHashFallbackAndNormalizationTests,
  );
});
