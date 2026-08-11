// tests/unit/transport/handlers/audioHandler.test.ts
import { describe, it, beforeEach, jest, expect } from '@jest/globals';
import type { WAMessage } from '@whiskeysockets/baileys';
import { AudioHandler } from '../../../../core/transport/handlers/audioHandler.js';
import type { MessageData } from '../../../../core/types/BotTypes.js';

function makeMessageData(overrides: Partial<MessageData> = {}): MessageData {
  return {
    chatId: 'chat@s.whatsapp.net',
    sender: 'sender@s.whatsapp.net',
    text: '',
    isGroup: false,
    ...overrides,
  };
}

describe('AudioHandler unit tests', () => {
  type MockTransportHost = {
    container: {
      has: (name: string) => boolean;
      get: (name: string) => { transcribe: (path: string) => Promise<string> };
    } | null;
    groupService?: {
      getGroupSettings: (groupJid: string) => Promise<Record<string, unknown>>;
    } | null;
    sock: {
      updateMediaMessage: () => Promise<Record<string, never>>;
      user?: { id?: string; lid?: string };
    } | null;
  };

  let mockTransport: MockTransportHost;
  let mockLogger: {
    log: (message: string) => void;
    error: (message: string) => void;
    warn: (message: string) => void;
  };
  let handler: AudioHandler;

  const buildHandler = (): AudioHandler =>
    new AudioHandler(
      mockTransport as unknown as ConstructorParameters<typeof AudioHandler>[0],
      mockLogger,
    );

  beforeEach(() => {
    jest.restoreAllMocks();

    mockTransport = {
      container: {
        has: jest.fn((name: string) => name === 'transcriptionService'),
        get: jest.fn((_name: string) => ({
          transcribe: async (_path: string) => 'transcribed text',
        })),
      },
      groupService: {
        getGroupSettings: jest.fn(async () => ({ audio_mode: 'full' })),
      },
      sock: {
        updateMediaMessage: jest.fn(async () => ({})),
        user: { id: 'bot_id:1@s.whatsapp.net' },
      },
    };

    mockLogger = {
      log: jest.fn(() => {}),
      error: jest.fn(() => {}),
      warn: jest.fn(() => {}),
    };

    handler = buildHandler();
  });

  it('should skip if not audio message', async () => {
    const msg = {
      key: { remoteJid: 'chat@s.whatsapp.net', id: 'MSG1' },
      message: { conversation: 'hello' },
    } as WAMessage;
    const result = await handler.processAudioMessage(msg, makeMessageData());
    expect(result).toBeNull();
  });

  it('should identify reply to bot', () => {
    const msg = {
      key: { remoteJid: 'chat@s.whatsapp.net', id: 'MSG2' },
      message: {
        audioMessage: {
          contextInfo: { participant: 'bot_id@s.whatsapp.net' },
        },
      },
    } as WAMessage;
    // Accessing private method for testing
    const result = handler._isReplyToBot(msg);
    expect(result).toBe(true);
  });

  it('should identify reply to bot using LID', () => {
    if (mockTransport.sock?.user) {
      mockTransport.sock.user.lid = 'bot_lid:1@s.whatsapp.net';
    }
    const msg = {
      key: { remoteJid: 'chat@s.whatsapp.net', id: 'MSG3' },
      message: {
        audioMessage: {
          contextInfo: { participant: 'bot_lid@s.whatsapp.net' },
        },
      },
    } as WAMessage;
    const result = handler._isReplyToBot(msg);
    expect(result).toBe(true);
  });
});
