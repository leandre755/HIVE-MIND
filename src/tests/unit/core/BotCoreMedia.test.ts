import { describe, it, expect, jest } from '@jest/globals';
import path from 'path';

process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'dummy';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.NODE_ENV = 'test';
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

const mockSendVoiceNote = jest.fn<(chatId: string, filePath: string) => Promise<void>>(
  async () => {},
);
const mockSendText = jest.fn<(chatId: string, text: string) => Promise<Record<string, unknown>>>(
  async () => ({}),
);

jest.unstable_mockModule('../../../core/transport/baileys.js', () => ({
  baileysTransport: {
    connect: jest.fn(async () => {}),
    onMessage: jest.fn(),
    onGroupEvent: jest.fn(),
    setContainer: jest.fn(),
    sendText: mockSendText,
    sendUniversalResponse: jest.fn(async () => ({})),
    setPresence: jest.fn(async () => {}),
    sendVoice: jest.fn(async () => ({})),
    sendVoiceNote: mockSendVoiceNote,
    downloadMedia: jest.fn(async () => Buffer.from('')),
    sock: { user: { id: '33612345678@s.whatsapp.net', lid: '33687654321@lid' } },
  },
}));

jest.unstable_mockModule('../../../services/audio/audioConverter.js', () => ({
  convertPcmToOgg: jest.fn(async () => path.join(process.cwd(), 'hm_storage', 'test_audio.ogg')),
  convertOggToPcm: jest.fn(async () => Buffer.from('')),
}));

const { botCore } = await import('../../../core/index.js');
const { container } = await import('../../../core/ServiceContainer.js');
const { tieredContextLoader } = await import('../../../core/context/TieredContextLoader.js');
const {
  safeWriteFileSync,
  safeExistsSync,
  safeUnlinkSync,
  safeMkdirSync,
  safeRemoveDirectorySync,
} = await import('../../../utils/safeFs.js');

describe('BotCore Media & Audio Lifecycle', () => {
  const pcmFile = path.join(process.cwd(), 'hm_storage', 'test_audio.pcm');
  const oggFile = path.join(process.cwd(), 'hm_storage', 'test_audio.ogg');
  const dirFilePath = path.join(
    process.cwd(),
    'hm_storage',
    'tmp_download',
    'dir_error_target.txt',
  );

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    try {
      if (safeExistsSync(dirFilePath)) {
        safeRemoveDirectorySync(dirFilePath);
      }
    } catch {
      try {
        safeUnlinkSync(dirFilePath);
      } catch {
        /* ignore */
      }
    }
    try {
      if (safeExistsSync(pcmFile)) safeUnlinkSync(pcmFile);
    } catch {
      /* ignore */
    }
    try {
      if (safeExistsSync(oggFile)) safeUnlinkSync(oggFile);
    } catch {
      /* ignore */
    }
  });

  it('gère la réponse audio et nettoie les fichiers temporaires après délai', async () => {
    jest.useFakeTimers();
    safeMkdirSync(path.dirname(pcmFile), { recursive: true });
    safeWriteFileSync(pcmFile, 'pcm test');
    safeWriteFileSync(oggFile, 'ogg test');

    const loadSpy = jest
      .spyOn(tieredContextLoader, 'load')
      .mockResolvedValue({ systemPrompt: 'audio prompt' } as unknown as Awaited<
        ReturnType<typeof tieredContextLoader.load>
      >);

    const getToolsSpy = jest
      .spyOn(
        botCore as unknown as { _getLiveAudioTools: () => Promise<unknown[]> },
        '_getLiveAudioTools',
      )
      .mockResolvedValue([]);

    const fakeGeminiLive = {
      processAudioWithTools: jest.fn<() => Promise<unknown>>().mockResolvedValue({
        audioFile: pcmFile,
      }),
    };
    container.register('geminiLiveProvider', () => fakeGeminiLive, { singleton: true });
    container.register('config', () => ({ models: {} }), { singleton: true });

    (botCore.transport as unknown as { sendVoiceNote: typeof mockSendVoiceNote }).sendVoiceNote =
      mockSendVoiceNote;

    const message = {
      sender: 'UserAudio',
      audioBuffer: Buffer.from('fake audio data'),
      text: '',
      chatId: 'chat_audio',
      sourceChannel: 'cli',
    };

    try {
      const handled = await (
        botCore as unknown as {
          _handleNativeAudioFlow: (m: unknown, c: string) => Promise<boolean>;
        }
      )._handleNativeAudioFlow(message, 'chat_audio');

      expect(handled).toBe(true);
      expect(mockSendVoiceNote).toHaveBeenCalledWith('chat_audio', oggFile);

      await jest.advanceTimersByTimeAsync(10000);
      expect(safeExistsSync(pcmFile)).toBe(false);
      expect(safeExistsSync(oggFile)).toBe(false);
    } finally {
      loadSpy.mockRestore();
      getToolsSpy.mockRestore();
    }
  });

  it('loggue une erreur si safeUnlink échoue avec une erreur autre que ENOENT lors du nettoyage', async () => {
    jest.useFakeTimers();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const mockDownload = jest
      .spyOn(botCore.transport, 'downloadMedia')
      .mockResolvedValueOnce(Buffer.from('test content for dir error'));

    const msg = {
      mediaType: 'document',
      raw: { documentMessage: { fileName: 'dir_error_target.txt' } },
    };

    try {
      await (
        botCore as unknown as {
          _downloadMediaDocumentNotice: (
            m: unknown,
            s: string,
            c: string,
          ) => Promise<string | null>;
        }
      )._downloadMediaDocumentNotice(msg, 'UserTest', 'chat123');

      safeUnlinkSync(dirFilePath);
      safeMkdirSync(dirFilePath);

      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      jest.useRealTimers();

      for (let i = 0; i < 50 && consoleErrorSpy.mock.calls.length === 0; i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[BotCore] Erreur suppression fichier temporaire:'),
        expect.anything(),
      );
    } finally {
      consoleErrorSpy.mockRestore();
      mockDownload.mockRestore();
    }
  });
});
