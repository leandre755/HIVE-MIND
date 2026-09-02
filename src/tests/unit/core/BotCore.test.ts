import { describe, it, expect, beforeEach, jest } from '@jest/globals';

process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'dummy';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.NODE_ENV = 'test';

jest.unstable_mockModule('../../../core/transport/baileys.js', () => ({
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
    sock: { user: { id: '33612345678@s.whatsapp.net', lid: '33687654321@lid' } },
  },
}));

const { botCore } = await import('../../../core/index.js');

type BotCoreTestAccess = {
  _isBotMentioned: (message: Record<string, unknown>, text: string) => boolean;
  _compactHistory: (
    history: Record<string, unknown>[],
    chatId: string,
  ) => Promise<Record<string, unknown>[]>;
  _optimizeHistory: (history: Record<string, unknown>[]) => Record<string, unknown>[];
  _cleanThoughtsAndSanitize: (
    finalResponse: string,
    iterations: number,
  ) => { cleaned: string | null; thoughtsCount: number };
  _unwrapSendMessageFormat: (text: string) => string;
};

describe('BotCore (Orchestration Core Integration)', () => {
  let bot: typeof botCore;
  let access: BotCoreTestAccess;

  beforeEach(() => {
    bot = botCore;
    access = bot as unknown as BotCoreTestAccess;
  });

  describe('Instanciation & Propriétés Essentielles', () => {
    it('initialise avec les constantes Feedback First et le blueprint actif', () => {
      expect(bot.FEEDBACK_TIMEOUT_MS).toBe(25000);
      expect(bot.QUICK_ACKNOWLEDGMENTS.length).toBeGreaterThan(0);
      expect(bot.currentBlueprint).toBeDefined();
      expect(bot.currentBlueprint.action_space).toBeDefined();
    });
  });

  describe('Détection des Mentions (_isBotMentioned)', () => {
    it('considère le bot toujours mentionné en DM privé (!isGroup)', () => {
      const msg = { isGroup: false };
      expect(access._isBotMentioned(msg, 'bonjour')).toBe(true);
    });

    it('détecte la mention explicite du bot dans un groupe via mentionedJids', () => {
      const msg = {
        isGroup: true,
        mentionedJids: ['33612345678@s.whatsapp.net'],
      };
      expect(access._isBotMentioned(msg, '@bot aide-moi')).toBe(true);
    });

    it('détecte le bot lorsque le message cite un message envoyé par le bot (quotedMsg)', () => {
      const msg = {
        isGroup: true,
        quotedMsg: { sender: '33612345678@s.whatsapp.net', text: 'Question précédente' },
      };
      expect(access._isBotMentioned(msg, 'oui exactement')).toBe(true);
    });

    it('retourne false dans un groupe si le bot n est ni cité ni mentionné', () => {
      const msg = {
        isGroup: true,
        mentionedJids: ['autre_membre@s.whatsapp.net'],
        quotedMsg: { sender: 'autre_membre@s.whatsapp.net' },
      };
      expect(access._isBotMentioned(msg, 'discussion entre humains')).toBe(false);
    });
  });

  describe('Troncature Mécanique de Repli (_optimizeHistory)', () => {
    it('laisse l historique intact si la charge est sous le seuil de 25 000 caractères', () => {
      const smallHistory = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'salut' },
        { role: 'assistant', content: 'bonjour' },
      ];
      const result = access._optimizeHistory(smallHistory);
      expect(result).toEqual(smallHistory);
    });

    it('tronque mécaniquement les tool outputs > 2000 caractères en cas de dépassement global', () => {
      const bigToolOutput = 'A'.repeat(5000);
      const padding = 'B'.repeat(22000);
      const history = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: padding },
        { role: 'tool', content: bigToolOutput },
        { role: 'assistant', content: 'en cours' },
        { role: 'user', content: 'suite' },
        { role: 'assistant', content: 'terminé' },
      ];

      const optimized = access._optimizeHistory(history);
      const toolMsg = optimized[2] as { role: string; content: string };
      expect(toolMsg.content.length).toBeLessThan(bigToolOutput.length);
      expect(toolMsg.content).toContain('[TRONQUÉ:');
    });
  });

  describe('Extraction CoT & Nettoyage de Réponse (_cleanThoughtsAndSanitize)', () => {
    it('extrait les balises <thought>/<think> et ne conserve que la réponse finale', () => {
      const raw =
        '<thought>Analyse des dépendances du projet</thought>Voici la solution au problème.';
      const res = access._cleanThoughtsAndSanitize(raw, 1);
      expect(res.thoughtsCount).toBe(1);
      expect(res.cleaned).toBe('Voici la solution au problème.');
    });

    it('déballe le format JSON issu d un appel direct <send_message>', () => {
      const raw = '<send_message>{"text":"Message direct dépaqueté"}</send_message>';
      const res = access._cleanThoughtsAndSanitize(raw, 1);
      expect(res.cleaned).toBe('Message direct dépaqueté');
    });
  });
});
