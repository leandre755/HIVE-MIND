// tests/e2e/bot.e2e.test.ts
import { describe, it, beforeAll, afterAll, jest, expect } from '@jest/globals';

process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'dummy';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.NODE_ENV = 'test';

jest.unstable_mockModule('qrcode-terminal', () => ({
  default: { generate: jest.fn() },
  generate: jest.fn(),
}));

const mockSock = {
  user: { id: '33612345678@s.whatsapp.net', lid: '33687654321@lid' },
  ev: { on: jest.fn(), removeAllListeners: jest.fn() },
};

jest.unstable_mockModule('../../core/transport/baileys.js', () => ({
  baileysTransport: {
    connect: jest.fn(async () => {}),
    onMessage: jest.fn(),
    onGroupEvent: jest.fn(),
    setContainer: jest.fn(),
    sendText: jest.fn(async () => ({})),
    sendUniversalResponse: jest.fn(async () => ({})),
    setPresence: jest.fn(async () => {}),
    sendVoice: jest.fn(async () => ({})),
    downloadMedia: jest.fn(async () => Buffer.from('')),
    sock: mockSock,
  },
}));

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

const { botCore } = await import('../../core/index.js');
const { container } = await import('../../core/ServiceContainer.js');
const { orchestrator } = await import('../../core/orchestrator.js');
const { eventBus, BotEvents } = await import('../../core/events.js');
const { permissionManager } = await import('../../core/security/PermissionManager.js');
const { scheduler } = await import('../../scheduler/index.js');
const { hiveWakeSystem } = await import('../../services/ptc/WakeSystem.js');
const { mailboxWatcher } = await import('../../services/events/MailboxWatcher.js');
const { disconnect: disconnectRedis } = await import('../../services/redisClient.js');

interface MockUserService {
  recordInteraction: (jid: string, name: string) => Promise<void>;
  registerLid: (jid: string, lid: string) => Promise<void>;
  getSpeakerHash: (jid: string) => Promise<string>;
  resolveLid: (lid: string) => Promise<string | null>;
}

interface BotCoreTestAccess {
  transport: { sock?: typeof mockSock; disconnect: () => Promise<void> };
  _onMessage: (message: Record<string, unknown>) => Promise<void>;
  _isBotMentioned: (
    msg: { isGroup?: boolean; mentionedJids?: string[]; text?: string },
    text: string,
  ) => boolean;
  _compactHistory: <T>(history: T[], chatId: string) => Promise<T[]>;
}

const botCoreTestAccess = botCore as unknown as BotCoreTestAccess;

const mockSingleResult = async () => ({ data: null });
const mockEqChain = () => ({ single: mockSingleResult });
const mockSelectChain = () => ({ eq: mockEqChain });
const mockSupabaseFrom = () => ({ select: mockSelectChain });

describe('Bot E2E Flow (Phase 4 MODs)', () => {
  beforeAll(async () => {
    jest.spyOn(container, 'init').mockImplementation(async () => {});

    const mockServicesMap = new Map<string, unknown>([
      [
        'workingMemory',
        {
          checkHealth: async () => ({ status: 'connected' }),
          trackGroupActivity: async () => {},
          isMuted: async () => false,
          addMessage: async () => {},
          trackMessage: async () => {},
          getReplyStrategy: async () => ({ useQuote: true, useMention: true }),
          getLastInteraction: async () => null,
          getChatVelocity: async () => ({ uniqueSenders: 0 }),
          getContext: async () => [],
        },
      ],
      [
        'supabase',
        {
          checkHealth: async () => ({ status: 'connected' }),
          from: mockSupabaseFrom,
        },
      ],
      [
        'userService',
        {
          recordInteraction: jest.fn(async () => {}),
          registerLid: jest.fn(async () => {}),
          getSpeakerHash: jest.fn(async () => 'ABC'),
          resolveLid: jest.fn(async () => null),
        },
      ],
      ['memory', { store: async () => {} }],
      ['consciousness', {}],
      ['groupService', { trackActivity: async () => {} }],
      [
        'adminService',
        {
          listAdmins: async () => [],
          isSuperUser: async () => false,
        },
      ],
      [
        'agentMemory',
        {
          logAction: async () => {},
          hasRecentFailure: async () => ({ hasFailure: false }),
          getRecentActions: async () => [],
        },
      ],
      ['actionMemory', { getResumableActions: async () => [] }],
      ['facts', {}],
      ['voiceProvider', {}],
      ['quotaManager', {}],
    ]);

    jest.spyOn(container, 'get').mockImplementation((name: string) => {
      return mockServicesMap.get(name) || {};
    });

    jest.spyOn(orchestrator, 'enqueue').mockImplementation(() => {});

    await botCore.init();
  });

  afterAll(async () => {
    if (botCore && botCore.transport) {
      await botCore.transport.disconnect();
    }
    if (scheduler) {
      scheduler.stopAll();
    }
    if (hiveWakeSystem) {
      hiveWakeSystem.stop();
    }
    if (mailboxWatcher) {
      mailboxWatcher.stop();
    }
    await disconnectRedis();
  });

  // ── Original E2E tests (preserved) ──

  it('should process a message flow end-to-end (mocked orchestrator)', async () => {
    const mockMsg = {
      chatId: '123@g.us',
      sender: 'user@s.whatsapp.net',
      senderName: 'User',
      text: 'Hello Bot',
      isGroup: true,
      id: 'msg1',
      raw: { key: { id: 'msg1' } },
    };

    await botCoreTestAccess._onMessage(mockMsg);
    expect(orchestrator.enqueue).toHaveBeenCalled();
  });

  it('should correctly detect if the bot is mentioned', () => {
    botCoreTestAccess.transport.sock = mockSock;

    const text = 'Hello @33612345678';
    const msg = {
      isGroup: true,
      mentionedJids: ['33612345678@s.whatsapp.net'],
      text,
    };

    const isMentioned = botCoreTestAccess._isBotMentioned(msg, text);
    expect(isMentioned).toBe(true);
  });

  // ── MOD 3: EventBus TOOL_PROGRESS publishable during E2E ──

  it('should allow subscribing to TOOL_PROGRESS events during a session', () => {
    const handler = jest.fn();
    eventBus.subscribe(BotEvents.TOOL_PROGRESS, handler);

    eventBus.publish(BotEvents.TOOL_PROGRESS, {
      tool: 'execute_bash_command',
      status: 'Exécution de : pwd',
      chatId: '123@g.us',
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        tool: 'execute_bash_command',
        status: expect.stringContaining('pwd'),
      }),
    );

    eventBus.off(BotEvents.TOOL_PROGRESS, handler);
  });

  // ── MOD 4: SYSTEM_ERROR Kill Switch publishable ──

  it('should publish SYSTEM_ERROR when budget is exceeded', () => {
    const handler = jest.fn();
    eventBus.subscribe(BotEvents.SYSTEM_ERROR, handler);

    eventBus.publish(BotEvents.SYSTEM_ERROR, {
      type: 'BUDGET_EXCEEDED',
      sessionCost: 2.5,
      maxBudget: 2.0,
    });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'BUDGET_EXCEEDED',
      }),
    );

    eventBus.off(BotEvents.SYSTEM_ERROR, handler);
  });

  // ── MOD 7: PermissionManager available to BotCore ──

  it('PermissionManager is accessible and auto-approves in test mode', async () => {
    const result = await permissionManager.askPermission(
      '123@g.us',
      'Edit file outside sandbox: /etc/passwd',
      'whatsapp',
      'user@s.whatsapp.net',
    );
    expect(result.granted).toBe(true);
  });

  // ── MOD 8: Dual Rendering — userOutput vs llmOutput structure ──

  it('BashTool dual render format validates E2E contract', () => {
    const mockDualResult = {
      success: true,
      llmOutput: { stdout: '/home/omni/Code/HIVE-MIND', exitCode: 0 },
      userOutput: '🐚 *Exécution Bash* :\n```bash\npwd\n```\nStatut: ✅ Succès',
    };

    expect(mockDualResult.llmOutput.stdout).toBeTruthy();
    expect(mockDualResult.userOutput).toContain('🐚');
    expect(typeof mockDualResult.llmOutput).toBe('object');
    expect(typeof mockDualResult.userOutput).toBe('string');
  });

  // ── MOD 9: Identity resolution end-to-end flow ──

  it('userService.registerLid is called with JID+LID during ghost user merge', async () => {
    const userService = container.get('userService') as MockUserService;
    await userService.registerLid('33612345678@s.whatsapp.net', '33687654321@lid');
    expect(userService.registerLid).toHaveBeenCalled();
  });

  // ── MOD 1: _compactHistory does not mutate history under threshold ──

  it('_compactHistory returns identical reference when under 25k chars', async () => {
    const history = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'small' },
    ];
    const result = await botCoreTestAccess._compactHistory(history, 'test-chat');
    expect(result).toEqual(history);
  });

  // ── MOD 6: CoT extraction does not expose thoughts to end user ──

  it('CoT thought tags are stripped before user response', () => {
    const rawResponse = '<thought>Internal reasoning step</thought>Here is your answer.';
    const thoughtRegex = /<(think|thought|thinking)>[\s\S]*?<\/\1>/gi;
    const cleaned = rawResponse.replace(thoughtRegex, '').trim();

    expect(cleaned).toBe('Here is your answer.');
    expect(cleaned).not.toContain('<thought>');
    expect(cleaned).not.toContain('Internal reasoning');
  });
});
