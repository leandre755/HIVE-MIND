// tests/unit/services/actionMemory.test.ts
import {
  describe,
  it,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
  jest,
  expect,
} from '@jest/globals';
import { switchToMock, redis } from '../../../services/redisClient.js';

process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'dummy-key';
process.env.REDIS_URL = 'redis://localhost:6379';

const resolveContextMock = jest
  .fn<() => Promise<{ context_id: string } | null>>()
  .mockResolvedValue(null);

jest.unstable_mockModule('../../../services/supabase.js', () => ({
  default: {
    resolveContextFromLegacyId: resolveContextMock,
  },
  supabase: null,
}));

type ActionMemoryModule = typeof import('../../../services/memory/ActionMemory.js');
let ActionMemoryClass: ActionMemoryModule['ActionMemory'];
let actionMemorySingleton: ActionMemoryModule['actionMemory'];

type ActionMemoryInternal = {
  cleanupIntervalId?: ReturnType<typeof setInterval>;
  startOrphanCleanup: () => void;
  _cleanupRedisOrphans: () => Promise<void>;
  _cleanupSupabaseOrphans: () => Promise<void>;
  initialized: boolean;
  keyPrefix: string;
};

beforeAll(async () => {
  switchToMock(redis);
  const module = await import('../../../services/memory/ActionMemory.js');
  ActionMemoryClass = module.ActionMemory;
  actionMemorySingleton = module.actionMemory;
});

afterAll(() => {
  actionMemorySingleton.dispose();
});

beforeEach(() => {
  switchToMock(redis);
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('ActionMemory - Lifecycle & Timer Resource Management (Issue #81)', () => {
  it('should start orphan cleanup interval and unref timer in constructor', () => {
    const instance = new ActionMemoryClass();
    const internal = instance as unknown as ActionMemoryInternal;

    expect(internal.cleanupIntervalId).toBeDefined();
    const timer = internal.cleanupIntervalId as NodeJS.Timeout;
    expect(typeof timer.hasRef).toBe('function');
    expect(timer.hasRef()).toBe(false);

    instance.dispose();
  });

  it('should clear interval and reset cleanupIntervalId on dispose', () => {
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    const instance = new ActionMemoryClass();
    const internal = instance as unknown as ActionMemoryInternal;

    const timerId = internal.cleanupIntervalId;
    expect(timerId).toBeDefined();

    instance.dispose();

    expect(clearIntervalSpy).toHaveBeenCalledWith(timerId);
    expect(internal.cleanupIntervalId).toBeUndefined();
  });

  it('should be safe and idempotent to call dispose multiple times', () => {
    const instance = new ActionMemoryClass();
    const internal = instance as unknown as ActionMemoryInternal;

    instance.dispose();
    expect(internal.cleanupIntervalId).toBeUndefined();

    expect(() => instance.dispose()).not.toThrow();
    expect(internal.cleanupIntervalId).toBeUndefined();
  });

  it('should safely handle environments where timer.unref is not a function', () => {
    const dummyTimer = {
      hasRef: () => false,
      refresh: () => dummyTimer,
    } as unknown as NodeJS.Timeout;

    const setIntervalSpy = jest.spyOn(global, 'setInterval').mockReturnValueOnce(dummyTimer);

    const instance = new ActionMemoryClass();
    const internal = instance as unknown as ActionMemoryInternal;

    expect(internal.cleanupIntervalId).toBe(dummyTimer);
    expect(() => instance.dispose()).not.toThrow();

    setIntervalSpy.mockRestore();
  });

  it('should execute periodic orphan cleanup when interval fires', async () => {
    jest.useFakeTimers();
    const instance = new ActionMemoryClass();
    const internal = instance as unknown as ActionMemoryInternal;
    const redisCleanupSpy = jest.spyOn(internal, '_cleanupRedisOrphans').mockResolvedValue();
    const supabaseCleanupSpy = jest.spyOn(internal, '_cleanupSupabaseOrphans').mockResolvedValue();

    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(redisCleanupSpy).toHaveBeenCalled();
    expect(supabaseCleanupSpy).toHaveBeenCalled();

    instance.dispose();
  });

  it('should catch and log errors thrown during periodic orphan cleanup callback', async () => {
    jest.useFakeTimers();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const instance = new ActionMemoryClass();
    const internal = instance as unknown as ActionMemoryInternal;
    jest.spyOn(internal, '_cleanupRedisOrphans').mockRejectedValue(new Error('Periodic failure'));

    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[ActionMemory] ❌ Cleanup error:',
      'Periodic failure',
    );

    consoleErrorSpy.mockRestore();
    instance.dispose();
  });

  it('should properly dispose the exported singleton instance', () => {
    const internalSingleton = actionMemorySingleton as unknown as ActionMemoryInternal;
    actionMemorySingleton.dispose();
    expect(internalSingleton.cleanupIntervalId).toBeUndefined();
  });

  it('should initialize service state via init()', () => {
    const instance = new ActionMemoryClass();
    const internal = instance as unknown as ActionMemoryInternal;

    expect(internal.initialized).toBe(false);
    instance.init();
    expect(internal.initialized).toBe(true);

    instance.dispose();
  });
});

describe('ActionMemory - Operations & Resilience', () => {
  let memory: InstanceType<ActionMemoryModule['ActionMemory']>;

  beforeEach(() => {
    memory = new ActionMemoryClass();
  });

  afterEach(() => {
    memory.dispose();
  });

  it('should start a new action and store structured fields in Redis', async () => {
    const chatId = 'chat_lifecycle_1';
    const actionId = await memory.startAction(chatId, {
      type: 'execute_command',
      goal: 'test command execution',
      context: { tool: 'bash' },
      priority: 3,
    });

    expect(actionId).not.toBeNull();
    expect(typeof actionId).toBe('string');
    expect(actionId).toContain(chatId);

    const active = await memory.getActiveAction(chatId);
    expect(active).not.toBeNull();
    expect(active?.id).toBe(actionId);
    expect(active?.chatId).toBe(chatId);
    expect(active?.type).toBe('execute_command');
    expect(active?.goal).toBe('test command execution');
    expect(active?.priority).toBe(3);
    expect(active?.status).toBe('active');
    expect(active?.context).toEqual({ tool: 'bash' });
    expect(active?.steps).toEqual([]);
  });

  it('should return null when no action exists for a chatId', async () => {
    const active = await memory.getActiveAction('non_existent_chat');
    expect(active).toBeNull();
  });

  it('should append execution steps via updateStep', async () => {
    const chatId = 'chat_steps_1';
    await memory.startAction(chatId, {
      type: 'build_pipeline',
      goal: 'verify multi-step progress',
    });

    const step1Result = await memory.updateStep(chatId, 'compiling typescript');
    expect(step1Result).toBe(true);

    const step2Result = await memory.updateStep(chatId, 'running jest suites');
    expect(step2Result).toBe(true);

    const active = await memory.getActiveAction(chatId);
    expect(active?.steps).toHaveLength(2);
    expect(active?.steps[0]?.step).toBe('compiling typescript');
    expect(active?.steps[1]?.step).toBe('running jest suites');
    expect(typeof active?.steps[0]?.timestamp).toBe('number');
  });

  it('should return false when updating step for non-existent action', async () => {
    const result = await memory.updateStep('unknown_chat', 'some step');
    expect(result).toBe(false);
  });

  it('should complete an active action with result payload', async () => {
    const chatId = 'chat_complete_1';
    await memory.startAction(chatId, {
      type: 'data_fetch',
      goal: 'retrieve stats',
    });

    const completed = await memory.completeAction(chatId, { rows: 42 });
    expect(completed).toBe(true);

    const action = await memory.getActiveAction(chatId);
    expect(action?.status).toBe('completed');

    const hasActive = await memory.hasActiveAction(chatId);
    expect(hasActive).toBe(false);
  });

  it('should return false when completing a non-existent action', async () => {
    const completed = await memory.completeAction('unknown_chat', { rows: 0 });
    expect(completed).toBe(false);
  });

  it('should interrupt an ongoing action with reason', async () => {
    const chatId = 'chat_interrupt_1';
    await memory.startAction(chatId, {
      type: 'long_running_task',
      goal: 'stream processing',
    });

    const interrupted = await memory.interruptAction(chatId, 'user cancelled');
    expect(interrupted).toBe(true);

    const action = await memory.getActiveAction(chatId);
    expect(action?.status).toBe('interrupted');

    const hasActive = await memory.hasActiveAction(chatId);
    expect(hasActive).toBe(false);
  });

  it('should return false when interrupting a non-existent action', async () => {
    const interrupted = await memory.interruptAction('unknown_chat', 'timeout');
    expect(interrupted).toBe(false);
  });

  it('should accurately report hasActiveAction status', async () => {
    const chatId = 'chat_has_active';
    expect(await memory.hasActiveAction(chatId)).toBe(false);

    await memory.startAction(chatId, { type: 'check', goal: 'active check' });
    expect(await memory.hasActiveAction(chatId)).toBe(true);

    await memory.completeAction(chatId, { ok: true });
    expect(await memory.hasActiveAction(chatId)).toBe(false);
  });

  it('should delete action on cleanupChatActions', async () => {
    const chatId = 'chat_to_clean';
    await memory.startAction(chatId, { type: 'temp', goal: 'temporary action' });

    expect(await memory.getActiveAction(chatId)).not.toBeNull();
    await memory.cleanupChatActions(chatId);
    expect(await memory.getActiveAction(chatId)).toBeNull();
  });

  it('should detect stalled actions based on threshold', async () => {
    const chatIdOld = 'chat_stalled_old';
    const chatIdNew = 'chat_stalled_new';

    await memory.startAction(chatIdOld, { type: 'stalled_task', goal: 'stalled' });
    await memory.startAction(chatIdNew, { type: 'fresh_task', goal: 'fresh' });

    const oldTime = Date.now() - 60000;
    await redis.hSet(`action:${chatIdOld}`, 'updatedAt', oldTime.toString());

    const stalled = await memory.getStalledActions(30000);
    expect(stalled.some((a) => a.id && a.id.includes(chatIdOld))).toBe(true);
    expect(stalled.some((a) => a.id && a.id.includes(chatIdNew))).toBe(false);
  });

  it('should clean up orphan actions older than 24 hours in Redis', async () => {
    const orphanChatId = 'chat_orphan_24h';
    await memory.startAction(orphanChatId, { type: 'orphan', goal: 'abandoned' });

    const past25h = (Date.now() - 25 * 60 * 60 * 1000).toString();
    await redis.hSet(`action:${orphanChatId}`, 'startedAt', past25h);
    await redis.hSet(`action:${orphanChatId}`, 'updatedAt', past25h);

    const internal = memory as unknown as ActionMemoryInternal;
    await internal._cleanupRedisOrphans();

    const retrieved = await memory.getActiveAction(orphanChatId);
    expect(retrieved).toBeNull();
  });

  it('should handle redis errors gracefully in startAction without throwing', async () => {
    const hSetSpy = jest
      .spyOn(redis, 'hSet')
      .mockRejectedValueOnce(new Error('Redis connection lost'));

    const result = await memory.startAction('chat_err', { type: 'err_test' });
    expect(result).toBeNull();

    hSetSpy.mockRestore();
  });

  it('should handle redis errors gracefully in getActiveAction without throwing', async () => {
    const hGetAllSpy = jest
      .spyOn(redis, 'hGetAll')
      .mockRejectedValueOnce(new Error('Redis timeout'));

    const result = await memory.getActiveAction('chat_err');
    expect(result).toBeNull();

    hGetAllSpy.mockRestore();
  });
});
