// tests/unit/transport/handlers/audioTranscribe.test.ts
// Couverture du chemin STT de AudioHandler (#36 : safeMkdir/safeWriteFile du
// flux _transcribeFromBuffer).
import { describe, it, beforeEach, jest, expect } from '@jest/globals';
import { AudioHandler } from '../../../../core/transport/handlers/audioHandler.js';

type MockTransportHost = {
  container: {
    has: (name: string) => boolean;
    get: (name: string) => { transcribe: (path: string) => Promise<string> };
  } | null;
  sock: Record<string, unknown> | null;
};

const mockLogger = {
  log: (_message: string) => undefined,
  error: (_message: string) => undefined,
  warn: (_message: string) => undefined,
};

function buildHandler(container: MockTransportHost['container']): AudioHandler {
  const transport: MockTransportHost = { container, sock: {} };
  return new AudioHandler(
    transport as unknown as ConstructorParameters<typeof AudioHandler>[0],
    mockLogger,
  );
}

describe('AudioHandler._transcribeFromBuffer', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('écrit le buffer via safeFs, transcrit puis nettoie le fichier temporaire', async () => {
    const handler = buildHandler({
      has: (name: string) => name === 'transcriptionService',
      get: () => ({ transcribe: async () => 'texte transcrit' }),
    });

    const text = await (
      handler as unknown as {
        _transcribeFromBuffer: (buffer: Buffer, fileName: string) => Promise<string | null>;
      }
    )._transcribeFromBuffer(Buffer.from('audio-bytes'), 'sample.stt.wav');

    expect(text).toBe('texte transcrit');
  });

  it('retourne null sans container', async () => {
    const handler = buildHandler(null);
    const text = await (
      handler as unknown as {
        _transcribeFromBuffer: (buffer: Buffer, fileName: string) => Promise<string | null>;
      }
    )._transcribeFromBuffer(Buffer.from('x'), 'a.wav');
    expect(text).toBeNull();
  });

  it('retourne null et journalise quand le service de transcription échoue', async () => {
    const errorSpy = jest.spyOn(mockLogger, 'error').mockImplementation(() => undefined);
    const handler = buildHandler({
      has: (name: string) => name === 'transcriptionService',
      get: () => ({
        transcribe: async () => {
          throw new Error('STT down');
        },
      }),
    });

    const text = await (
      handler as unknown as {
        _transcribeFromBuffer: (buffer: Buffer, fileName: string) => Promise<string | null>;
      }
    )._transcribeFromBuffer(Buffer.from('x'), 'b.wav');

    expect(text).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });
});
