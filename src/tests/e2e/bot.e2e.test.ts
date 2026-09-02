// src/tests/e2e/bot.e2e.test.ts
// E2E Pipeline — Véritable cycle de vie du transport, orchestration et sécurité
import { describe, it, beforeAll, beforeEach, jest, expect } from '@jest/globals';

process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'dummy';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.NODE_ENV = 'test';

// Mocks d'infrastructure externe
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
    disconnect: jest.fn(async () => {}),
    onMessage: jest.fn(),
    onGroupEvent: jest.fn(),
    setContainer: jest.fn(),
    sendText: jest.fn(async () => ({ status: 'sent' })),
    sendUniversalResponse: jest.fn(async () => ({ status: 'sent' })),
    setPresence: jest.fn(async () => {}),
    sendVoice: jest.fn(async () => ({})),
    downloadMedia: jest.fn(async () => Buffer.from('')),
    sock: mockSock,
  },
}));

const { botCore } = await import('../../core/index.js');
const { container } = await import('../../core/ServiceContainer.js');
const { orchestrator } = await import('../../core/orchestrator.js');
const { eventBus, BotEvents } = await import('../../core/events.js');
const { sanitizeResponse } = await import('../../utils/responseSanitizer.js');

type BotCoreInternals = {
  _onMessage: (msg: unknown) => Promise<void>;
  _onGroupEvent: (event: unknown) => void;
  _handleGroupWelcome: (event: unknown) => Promise<void>;
};

const botAccess = botCore as unknown as BotCoreInternals;

describe('Bot Core Pipeline E2E (Contrat Réel de Message & Dispatch)', () => {
  let workingMemoryMock: {
    trackGroupActivity: jest.MockedFunction<(jid: string) => Promise<void>>;
    isMuted: jest.MockedFunction<(jid: string, sender: string) => Promise<boolean>>;
  };

  beforeAll(async () => {
    workingMemoryMock = {
      trackGroupActivity: jest.fn(async () => {}),
      isMuted: jest.fn(async () => false),
    };

    jest.spyOn(container, 'get').mockImplementation((name: string) => {
      if (name === 'workingMemory') return workingMemoryMock;
      if (name === 'supabase') {
        return {
          getGroupConfig: jest.fn(async () => ({
            welcome_message: 'Bienvenue @user dans le groupe !',
          })),
        };
      }
      return {};
    });

    jest.spyOn(orchestrator, 'enqueue').mockImplementation(() => {});
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Cycle de Dispatching des Messages Entrants', () => {
    it('ignore silencieusement les messages sans contenu textuel ou vides', async () => {
      await botAccess._onMessage({ chatId: 'chat_1', text: '   ', isGroup: false });
      await botAccess._onMessage({ chatId: 'chat_1', text: '', isGroup: false });

      expect(orchestrator.enqueue).not.toHaveBeenCalled();
    });

    it('ignore les messages émis par un utilisateur mis en sourdine (Muted)', async () => {
      workingMemoryMock.isMuted.mockResolvedValueOnce(true);

      await botAccess._onMessage({
        chatId: 'group_123@g.us',
        sender: 'muted_user@s.whatsapp.net',
        text: 'Bonjour tout le monde',
        isGroup: true,
      });

      expect(workingMemoryMock.trackGroupActivity).toHaveBeenCalledWith('group_123@g.us');
      expect(orchestrator.enqueue).not.toHaveBeenCalled();
    });

    it('achemine les messages de groupe valides à l orchestrateur avec priorité 1', async () => {
      workingMemoryMock.isMuted.mockResolvedValueOnce(false);

      const msg = {
        chatId: 'group_123@g.us',
        sender: 'alice@s.whatsapp.net',
        text: 'Question pour le bot',
        isGroup: true,
      };

      await botAccess._onMessage(msg);

      expect(workingMemoryMock.trackGroupActivity).toHaveBeenCalledWith('group_123@g.us');
      expect(orchestrator.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message',
          chatId: 'group_123@g.us',
          data: msg,
          priority: 1,
        }),
      );
    });

    it('achemine les messages privés (DM) directement sans contrôle de sourdine groupe', async () => {
      const msg = {
        chatId: 'user_direct@s.whatsapp.net',
        sender: 'user_direct@s.whatsapp.net',
        text: 'Discussion privée',
        isGroup: false,
      };

      await botAccess._onMessage(msg);

      expect(workingMemoryMock.trackGroupActivity).not.toHaveBeenCalled();
      expect(orchestrator.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'message',
          chatId: 'user_direct@s.whatsapp.net',
          data: msg,
          priority: 1,
        }),
      );
    });
  });

  describe('Événements de Groupe & Messages de Bienvenue', () => {
    it('enfile les événements de groupe avec priorité 3', () => {
      const groupEvt = { groupId: 'group_abc@g.us', action: 'modify' };

      botAccess._onGroupEvent(groupEvt);

      expect(orchestrator.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'group_event',
          chatId: 'group_abc@g.us',
          data: groupEvt,
          priority: 3,
        }),
      );
    });

    it('exécute _handleGroupWelcome lors de l arrivée de nouveaux membres', async () => {
      jest
        .spyOn(botCore.transport, 'sendText')
        .mockResolvedValueOnce({} as unknown as ReturnType<typeof botCore.transport.sendText>);
      const welcomeEvent = {
        event: 'group_join',
        data: {
          groupId: 'group_123@g.us',
          participants: ['newbie_1@s.whatsapp.net'],
          action: 'add',
        },
      };

      await botAccess._handleGroupWelcome(welcomeEvent);

      expect(botCore.transport.sendText).toHaveBeenCalledWith(
        'group_123@g.us',
        'Bienvenue @newbie_1 dans le groupe !',
        expect.objectContaining({
          mentions: ['newbie_1@s.whatsapp.net'],
        }),
      );
    });
  });

  describe('Assainissement Réel de Réponse (Production ResponseFormatEnforcer)', () => {
    it('purifie les réponses utilisateur en éliminant les fuites de tool_call réelles', () => {
      const rawText = 'Voici la réponse.\n<tool_call>{"name":"execute_bash_command"}</tool_call>';
      const sanitized = sanitizeResponse(rawText);

      expect(sanitized.wasModified).toBe(true);
      expect(sanitized.cleaned).not.toContain('<tool_call>');
      expect(sanitized.cleaned).toContain('Voici la réponse.');
    });
  });

  describe('Signaux du Bus d Événements (EventBus Resilience)', () => {
    it('notifie les souscripteurs des étapes de progression des outils', () => {
      const listener = jest.fn();
      eventBus.subscribe(BotEvents.TOOL_PROGRESS, listener);

      eventBus.publish(BotEvents.TOOL_PROGRESS, {
        tool: 'execute_bash_command',
        status: 'Exécution',
        chatId: 'c1',
      });

      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ tool: 'execute_bash_command', status: 'Exécution' }),
      );

      eventBus.off(BotEvents.TOOL_PROGRESS, listener);
    });
  });
});
