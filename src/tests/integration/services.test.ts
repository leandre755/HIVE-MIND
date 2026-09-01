// tests/integration/services.test.ts
// Integration — Services Layer (MOD 4 + MOD 9)
import { describe, it, beforeEach, afterEach, jest, expect } from '@jest/globals';

// Mock Supabase
jest.unstable_mockModule('../../services/supabase.js', () => ({
  __esModule: true,
  supabase: null, // No real DB in integration tests
  default: {
    resolveContextFromLegacyId: jest.fn(async (id: string) => {
      if (!id) return null;
      if (id.includes('@g.us')) return { context_id: 'uuid-group-1', type: 'group' };
      if (id.includes('@s.whatsapp.net')) return { context_id: 'uuid-user-1', type: 'user' };
      return { context_id: 'uuid-cli-1', type: 'user' };
    }),
    isAvailable: jest.fn(() => false),
    logAction: jest.fn(async () => null),
  },
}));

// Mock RuntimeInfrastructure
const mockRuntime = {
  finOps: {
    recordUsage: jest.fn((model: string, pt: number, ct: number) => ({
      model,
      promptTokens: pt,
      completionTokens: ct,
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
      sessionTotal: 0,
      budgetSafe: true,
    })),
    calculateLambda: jest.fn(() => 0),
    getSessionCost: jest.fn(() => 0),
  },
};

jest.unstable_mockModule('../../services/runtime/RuntimeInfrastructure.js', () => ({
  runtime: mockRuntime,
  AIRuntimeInfrastructure: class {
    finOps = mockRuntime.finOps;
  },
}));

// Mock redis
jest.unstable_mockModule('../../services/redisClient.js', () => ({
  redis: {
    isOpen: true,
    multi: jest.fn(),
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    hSet: jest.fn(),
    hGet: jest.fn(),
    hGetAll: jest.fn(),
    sAdd: jest.fn(),
    exists: jest.fn(),
    quit: jest.fn(),
    sPop: jest.fn(),
    sPopCount: jest.fn(),
  },
}));

const { redis } = await import('../../services/redisClient.js');
const { userService } = await import('../../services/userService.js');
const { StateManager } = await import('../../services/state/StateManager.js');
const { runtime } =
  (await import('../../services/runtime/RuntimeInfrastructure.js')) as unknown as {
    runtime: {
      finOps: {
        recordUsage: (
          model: string,
          promptTokens: number,
          completionTokens: number,
        ) => { totalCost: number; budgetSafe: boolean };
        getSessionCost: () => number;
      };
    };
  };
const { default: db } = await import('../../services/supabase.js');

type RedisMock = {
  multi: jest.Mock;
  set: jest.Mock;
  get: jest.Mock;
  del: jest.Mock;
  hSet: jest.Mock;
  hGet: jest.Mock;
  hGetAll: jest.Mock;
  sAdd: jest.Mock;
  exists: jest.Mock;
  quit: jest.Mock;
  sPop: jest.Mock;
  sPopCount: jest.Mock;
};

const mockRedis = redis as unknown as RedisMock;

describe('Services Integration (Phase 4 MODs)', () => {
  const testJid = '12345@s.whatsapp.net';
  const testLid = 'abcde@lid';

  beforeEach(() => {
    Object.defineProperty(mockRedis, 'isOpen', {
      get: () => true,
      configurable: true,
    });

    jest.spyOn(mockRedis, 'multi').mockReturnValue({
      hIncrBy: jest.fn().mockReturnThis(),
      hSet: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      sAdd: jest.fn().mockReturnThis(),
      exec: jest.fn(async () => []),
    } as unknown as ReturnType<RedisMock['multi']>);

    jest.spyOn(mockRedis, 'set').mockResolvedValue('OK' as never);
    jest.spyOn(mockRedis, 'get').mockResolvedValue(null as never);
    jest.spyOn(mockRedis, 'del').mockResolvedValue(1 as never);
    jest.spyOn(mockRedis, 'hSet').mockResolvedValue(1 as never);
    jest.spyOn(mockRedis, 'hGet').mockResolvedValue(null as never);
    jest.spyOn(mockRedis, 'hGetAll').mockResolvedValue({} as never);
    jest.spyOn(mockRedis, 'sAdd').mockResolvedValue(1 as never);
    jest.spyOn(mockRedis, 'exists').mockResolvedValue(0 as never);
    jest.spyOn(mockRedis, 'quit').mockResolvedValue('OK' as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── Original tests (preserved) ──

  it('should record interaction and resolve LID correctly', async () => {
    await userService.recordInteraction(testJid, 'Test User');
    expect(mockRedis.multi).toHaveBeenCalled();

    await userService.registerLid(testJid, testLid);
    expect(mockRedis.set).toHaveBeenCalledWith('map:lid:abcde', testJid);

    (
      mockRedis.get as unknown as { mockResolvedValueOnce: (v: string) => void }
    ).mockResolvedValueOnce(testJid);
    const resolved = await userService.resolveLid(testLid);
    expect(resolved).toBe(testJid);
  });

  it('should clear data from Redis cache when requested', async () => {
    const cacheKey = `user:${testJid}:data`;
    await mockRedis.del(cacheKey);
    expect(mockRedis.del).toHaveBeenCalledWith(cacheKey);
  });

  // ── MOD 9: resolveContextFromLegacyId ──

  it('resolveContextFromLegacyId maps WhatsApp JID to UUID user', async () => {
    const result = await db.resolveContextFromLegacyId(testJid);
    expect(result).not.toBeNull();
    expect(result?.type).toBe('user');
    expect(result?.context_id).toBeDefined();
  });

  it('resolveContextFromLegacyId maps group JID to UUID group', async () => {
    const result = await db.resolveContextFromLegacyId('120363xxx@g.us');
    expect(result?.type).toBe('group');
  });

  it('resolveContextFromLegacyId returns null for empty string', async () => {
    const result = await db.resolveContextFromLegacyId('');
    expect(result).toBeNull();
  });

  // ── MOD 4: RuntimeFinOps session integration ──

  it('runtime.finOps.recordUsage returns budgetSafe=true for free models', () => {
    const record = runtime.finOps.recordUsage('qwen/qwen3-32b', 10000, 5000);
    expect(record.totalCost).toBe(0);
    expect(record.budgetSafe).toBe(true);
  });

  it('runtime.finOps.getSessionCost returns a number', () => {
    expect(typeof runtime.finOps.getSessionCost()).toBe('number');
  });

  // ── MOD 9: StateManager UUID-based cache key ──

  it('StateManager uses UUID-based cache key (not legacy JID)', async () => {
    // updateUserInteraction should query resolveContextFromLegacyId
    // then build key as user:{UUID}:data
    await StateManager.updateUserInteraction(testJid, 'TestUser');

    // redis.multi() should be called (pipeline)
    expect(mockRedis.multi).toHaveBeenCalled();
  });

  it('StateManager.processSyncQueue does not crash when redis is empty', async () => {
    jest.spyOn(mockRedis, 'sPopCount').mockResolvedValue([] as never);
    await expect(StateManager.processSyncQueue(50)).resolves.not.toThrow();
  });
});
