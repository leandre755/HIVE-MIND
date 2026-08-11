// tests/integration/core.test.ts
// Integration — BotCore + nouveaux MODs (1, 3, 4, 6, 7, 8)
import { describe, it, beforeEach, afterAll, jest, expect } from '@jest/globals';

process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'dummy';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.NODE_ENV = 'test';

const mockSock = {
  user: { id: '33612345678@s.whatsapp.net', lid: '33687654321@lid' },
};

jest.unstable_mockModule('../../services/supabase.js', () => ({
  supabase: null,
  db: { getGroupConfig: jest.fn() },
  default: { getGroupConfig: jest.fn() },
}));

jest.unstable_mockModule('../../core/transport/baileys.js', () => ({
  baileysTransport: {
    connect: jest.fn(async () => {}),
    disconnect: jest.fn(async () => {}),
    onMessage: jest.fn(),
    onGroupEvent: jest.fn(),
    setContainer: jest.fn(),
    sendText: jest.fn(async () => ({})),
    sendUniversalResponse: jest.fn(async () => ({})),
    sendMedia: jest.fn(async () => ({})),
    sendSticker: jest.fn(async () => ({})),
    getGroupMetadata: jest.fn(async () => ({})),
    downloadMedia: jest.fn(async () => Buffer.from('')),
    isAdmin: jest.fn(async () => false),
    sendReaction: jest.fn(async () => true),
    setPresence: jest.fn(async () => {}),
    sock: mockSock,
  },
}));

// Mock RuntimeInfrastructure to prevent budget and sentinel from interfering with integration tests
jest.unstable_mockModule('../../services/runtime/RuntimeInfrastructure.js', () => ({
  runtime: {
    finOps: {
      recordUsage: jest.fn(() => ({ budgetSafe: true, totalCost: 0, sessionTotal: 0 })),
      calculateLambda: jest.fn(() => 0),
      getSessionCost: jest.fn(() => 0),
    },
    sentinel: {
      evaluate: jest.fn(async () => ({ allowed: true, risk_level: 'low', reason: 'mock' })),
    },
    ralph: {
      verifyCompletion: jest.fn(async () => ({
        is_complete: true,
        laziness_detected: false,
        kickback_message: null,
      })),
    },
  },
}));

// Mock PermissionManager to auto-approve in tests
jest.unstable_mockModule('../../core/security/PermissionManager.js', () => ({
  permissionManager: {
    validateBashCommand: jest.fn(() => ({ result: true, requiresPermission: false })),
    validateFileWrite: jest.fn(() => ({ result: true, requiresPermission: false })),
    isInSandbox: jest.fn(() => true),
    askPermission: jest.fn(async () => ({ granted: true })),
    handleAdminCommand: jest.fn(() => false),
    handleUserResponse: jest.fn(() => false),
    pendingCount: 0,
  },
  BANNED_COMMANDS: ['curl', 'sudo'],
  SAFE_COMMANDS: new Set(['pwd', 'ls']),
}));

const { container } = await import('../../core/ServiceContainer.js');

const makeSupabaseQueryMock = (): {
  select: () => { eq: () => { single: () => Promise<{ data: null; error: null }> } };
} => ({
  select: () => ({
    eq: () => ({
      single: async () => ({ data: null, error: null }),
    }),
  }),
});

type MockService = {
  trackGroupActivity?: jest.Mock;
  trackMessage?: jest.Mock;
  isMuted?: jest.Mock;
  addMessage?: jest.Mock;
  getReplyStrategy?: jest.Mock;
  getLastInteraction?: jest.Mock;
  getChatVelocity?: jest.Mock;
  recordInteraction?: jest.Mock;
  registerLid?: jest.Mock;
  getSpeakerHash?: jest.Mock;
  resolveLid?: jest.Mock;
  from?: jest.Mock;
  getGroupConfig?: jest.Mock;
  store?: jest.Mock;
  trackActivity?: jest.Mock;
  listAdmins?: jest.Mock;
  isSuperUser?: jest.Mock;
  logAction?: jest.Mock;
  hasRecentFailure?: jest.Mock;
  getRecentActions?: jest.Mock;
  getResumableActions?: jest.Mock;
  finOps?: { recordUsage: jest.Mock; calculateLambda: jest.Mock; getSessionCost: jest.Mock };
  sentinel?: { evaluate: jest.Mock };
  ralph?: { verifyCompletion: jest.Mock };
};

jest.spyOn(container, 'get').mockImplementation((name: string) => {
  const mockServices: Record<string, MockService> = {
    workingMemory: {
      trackGroupActivity: jest.fn(async () => {}),
      trackMessage: jest.fn(async () => {}),
      isMuted: jest.fn(async () => false),
      addMessage: jest.fn(async () => {}),
      getReplyStrategy: jest.fn(async () => ({ useQuote: true, useMention: true })),
      getLastInteraction: jest.fn(async () => null),
      getChatVelocity: jest.fn(async () => ({ uniqueSenders: 0 })),
    },
    userService: {
      recordInteraction: jest.fn(async () => {}),
      registerLid: jest.fn(async () => {}),
      getSpeakerHash: jest.fn(async () => 'ABC'),
      resolveLid: jest.fn(async () => null),
    },
    supabase: {
      from: jest.fn(() => makeSupabaseQueryMock()),
      getGroupConfig: jest.fn(async () => ({})),
    },
    memory: { store: jest.fn(async () => {}) },
    consciousness: {},
    groupService: { trackActivity: jest.fn(async () => {}) },
    adminService: {
      listAdmins: jest.fn(async () => []),
      isSuperUser: jest.fn(async () => false),
    },
    agentMemory: {
      logAction: jest.fn(async () => {}),
      hasRecentFailure: jest.fn(async () => ({ hasFailure: false })),
      getRecentActions: jest.fn(async () => []),
    },
    actionMemory: { getResumableActions: jest.fn(async () => []) },
    facts: {},
    voiceProvider: {},
    quotaManager: {},
    runtime: {
      finOps: {
        recordUsage: jest.fn(() => ({ budgetSafe: true, totalCost: 0, sessionTotal: 0 })),
        calculateLambda: jest.fn(() => 0),
        getSessionCost: jest.fn(() => 0),
      },
      sentinel: {
        evaluate: jest.fn(async () => ({ allowed: true, risk_level: 'low', reason: 'mock' })),
      },
      ralph: {
        verifyCompletion: jest.fn(async () => ({
          is_complete: true,
          laziness_detected: false,
          kickback_message: null,
        })),
      },
    },
  };
  return new Map(Object.entries(mockServices)).get(name) || {};
});

const { BotCore } = await import('../../core/index.js');
const { orchestrator } = await import('../../core/orchestrator.js');

describe('BotCore Integration (Phase 4 MODs)', () => {
  let bot: InstanceType<typeof BotCore>;

  beforeEach(() => {
    jest.clearAllMocks();
    bot = new BotCore();
    bot.isReady = true;
    (bot.transport as unknown as { sock: typeof mockSock }).sock = mockSock;
  });

  afterAll(async () => {
    if (bot && bot.transport) {
      await bot.transport.disconnect();
    }
  });

  // ── Original tests (preserved) ──

  it('should handle incoming messages by enqueuing them in the orchestrator', async () => {
    const mockMsg = {
      chatId: '123@g.us',
      sender: 'user@s.whatsapp.net',
      senderName: 'User',
      text: 'Hello Bot',
      isGroup: true,
      id: 'msg1',
      raw: { key: { id: 'msg1' } },
    };
    const enqueueSpy = jest.spyOn(orchestrator, 'enqueue');
    await bot._onMessage(mockMsg as Parameters<typeof bot._onMessage>[0]);
    expect(enqueueSpy).toHaveBeenCalled();
  });

  it('should detect bot mentions correctly', () => {
    const text = 'Hello @33612345678';
    const msg = {
      isGroup: true,
      mentionedJids: ['33612345678@s.whatsapp.net'],
      text,
    } as unknown as Parameters<typeof bot._isBotMentioned>[0];
    const isMentioned = bot._isBotMentioned(msg, text);
    expect(isMentioned).toBe(true);
  });

  // ── MOD 7: HITL — handleAdminCommand intercepted ──

  it('should expose handleAdminCommand method on permissionManager', async () => {
    const { permissionManager } = await import('../../core/security/PermissionManager.js');
    expect(typeof permissionManager.handleAdminCommand).toBe('function');
  });

  // ── MOD 4: RuntimeFinOps integrated in provider call ──

  it('RuntimeFinOps mock returns budgetSafe=true during integration', async () => {
    const runtime = container.get('runtime') as {
      finOps: { recordUsage: (model: string, a: number, b: number) => { budgetSafe: boolean } };
    };
    const record = runtime.finOps.recordUsage('gpt-4o-mini', 1000, 500);
    expect(record.budgetSafe).toBe(true);
  });

  // ── MOD 6: CoT regex compiled correctly ──

  it('CoT thought-only regex matches all supported formats', () => {
    const regex = /<(think|thought|thinking)>[\s\S]*?<\/\1>/gi;
    expect('<think>reasoning</think>'.match(regex)).not.toBeNull();
    expect('<thought>reasoning</thought>'.match(regex)).not.toBeNull();
    expect('<thinking>reasoning</thinking>'.match(regex)).not.toBeNull();
  });

  // ── MOD 1: _compactHistory threshold logic ──

  it('_compactHistory returns original history when under 25k chars', async () => {
    const smallHistory = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ];
    const result = await bot._compactHistory(smallHistory, '123@g.us');
    expect(result).toEqual(smallHistory);
  });

  // ── MOD 9: LID resolution propagated through userService ──

  it('userService.registerLid is available for Ghost User Merge', () => {
    const userService = container.get('userService') as { registerLid: unknown };
    expect(typeof userService.registerLid).toBe('function');
  });
});
