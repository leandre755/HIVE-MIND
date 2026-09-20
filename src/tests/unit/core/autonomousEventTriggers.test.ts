import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'dummy';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.NODE_ENV = 'test';

type CheckEventTriggersFn = (msg: unknown) => Promise<unknown[]>;
type MarkInProgressFn = (id: string) => Promise<void>;

const mockCheckEventTriggers: jest.MockedFunction<CheckEventTriggersFn> = jest.fn();
const mockMarkInProgress: jest.MockedFunction<MarkInProgressFn> = jest.fn();

jest.unstable_mockModule('../../../services/goalsService.js', () => ({
  goalsService: {
    checkEventTriggers: mockCheckEventTriggers,
    markInProgress: mockMarkInProgress,
  },
}));

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

type CoreWithEventTriggers = {
  _checkAutonomousEventTriggers: (
    message: Record<string, unknown>,
    senderName: string,
  ) => Promise<void>;
  _onMessage: (msg: Record<string, unknown>) => Promise<void>;
};

describe('BotCore._checkAutonomousEventTriggers', () => {
  let core: CoreWithEventTriggers;
  let originalOnMessage: (msg: Record<string, unknown>) => Promise<void>;
  let mockOnMessage: jest.MockedFunction<(msg: Record<string, unknown>) => Promise<void>>;

  beforeEach(() => {
    jest.useFakeTimers();
    core = botCore as unknown as CoreWithEventTriggers;
    originalOnMessage = core._onMessage;
    mockOnMessage = jest.fn(async () => {});
    core._onMessage = mockOnMessage;
    mockCheckEventTriggers.mockReset();
    mockMarkInProgress.mockReset();
  });

  afterEach(() => {
    core._onMessage = originalOnMessage;
    jest.useRealTimers();
  });

  it('ne fait rien si aucun objectif autonome n est declenche', async () => {
    mockCheckEventTriggers.mockResolvedValueOnce([]);

    await core._checkAutonomousEventTriggers({ text: 'Hello' }, 'Alice');

    expect(mockCheckEventTriggers).toHaveBeenCalledTimes(1);
    expect(mockMarkInProgress).not.toHaveBeenCalled();
    expect(mockOnMessage).not.toHaveBeenCalled();
  });

  it('marque l objectif in_progress et execute _onMessage avec timer unref pour groupe et dm', async () => {
    const goals = [
      {
        id: 'goal-group-1',
        title: 'Nettoyer le groupe',
        description: 'Supprimer les spams',
        priority: 1,
        target_chat_id: '12036302@g.us',
      },
      {
        id: 'goal-dm-2',
        title: 'Repondre en prive',
        description: 'Envoyer le recapitulatif',
        priority: 3,
        target_chat_id: '33699999999@s.whatsapp.net',
      },
      {
        id: 'goal-no-chat-3',
        title: 'Objectif systeme sans cible',
        description: 'Tache globale',
        priority: 5,
        target_chat_id: null,
      },
    ];
    mockCheckEventTriggers.mockResolvedValueOnce(goals);
    mockMarkInProgress.mockResolvedValue(undefined);

    await core._checkAutonomousEventTriggers({ text: 'declencheur' }, 'Bob');

    expect(mockCheckEventTriggers).toHaveBeenCalledTimes(1);
    expect(mockMarkInProgress).toHaveBeenCalledTimes(3);
    expect(mockMarkInProgress).toHaveBeenNthCalledWith(1, 'goal-group-1');
    expect(mockMarkInProgress).toHaveBeenNthCalledWith(2, 'goal-dm-2');
    expect(mockMarkInProgress).toHaveBeenNthCalledWith(3, 'goal-no-chat-3');

    expect(mockOnMessage).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(500);

    expect(mockOnMessage).toHaveBeenCalledTimes(3);
    expect(mockOnMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        isGroup: true,
        chatId: '12036302@g.us',
        senderName: 'SYSTEM_EVENT_LISTENER',
        sender: 'system@internal',
        isSystem: true,
      }),
    );
    expect(mockOnMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        isGroup: false,
        chatId: '33699999999@s.whatsapp.net',
      }),
    );
    expect(mockOnMessage).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        isGroup: false,
        chatId: null,
      }),
    );
  });

  it('intercepte le rejet de _onMessage et conserve la stack trace dans les logs', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const failureError = new Error('Echec asynchrone dans le traitement du message');
    mockOnMessage.mockRejectedValueOnce(failureError);

    mockCheckEventTriggers.mockResolvedValueOnce([
      {
        id: 'goal-fail-1',
        title: 'Tache defaillante',
        description: 'Doit echouer proprement',
        priority: 2,
        target_chat_id: 'chat@s.whatsapp.net',
      },
    ]);
    mockMarkInProgress.mockResolvedValue(undefined);

    await core._checkAutonomousEventTriggers({ text: 'declencher erreur' }, 'Charlie');
    await jest.advanceTimersByTimeAsync(500);

    expect(errorSpy).toHaveBeenCalledWith(
      '[EventTrigger] Erreur exécution onMessage:',
      failureError,
    );
    expect(failureError.stack).toBeDefined();

    errorSpy.mockRestore();
  });

  it('intercepte les erreurs dans la phase de verification globale (Error instance)', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const triggerError = new Error('Base de donnees indisponible');
    mockCheckEventTriggers.mockRejectedValueOnce(triggerError);

    await core._checkAutonomousEventTriggers({ text: 'erreur base' }, 'David');

    expect(errorSpy).toHaveBeenCalledWith('[EventTrigger] Erreur vérification:', triggerError);

    errorSpy.mockRestore();
  });

  it('intercepte les erreurs non-Error dans la phase de verification globale', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    mockCheckEventTriggers.mockRejectedValueOnce('Erreur brute chaine');

    await core._checkAutonomousEventTriggers({ text: 'erreur brute' }, 'Eve');

    expect(errorSpy).toHaveBeenCalledWith(
      '[EventTrigger] Erreur vérification:',
      'Erreur brute chaine',
    );

    errorSpy.mockRestore();
  });
});
