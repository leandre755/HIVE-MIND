import { jest, describe, it, expect } from '@jest/globals';

const mockSaveCreds = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
const mockEnd = jest.fn();
const mockRemoveAllListeners = jest.fn();
let connectionUpdateHandler: ((update: unknown) => void) | undefined;

const mockEv = {
  on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
    if (event === 'connection.update') {
      connectionUpdateHandler = handler as (update: unknown) => void;
    }
  }),
  removeAllListeners: mockRemoveAllListeners,
};

const mockSock = {
  ev: mockEv,
  end: mockEnd,
};

jest.unstable_mockModule('@whiskeysockets/baileys', () => ({
  makeWASocket: jest.fn(() => mockSock),
  useMultiFileAuthState: jest.fn().mockResolvedValue({
    state: { creds: { registered: true } },
    saveCreds: mockSaveCreds,
  } as unknown as never),
  fetchLatestBaileysVersion: jest
    .fn()
    .mockResolvedValue({ version: [2, 3000, 0] } as unknown as never),
  DisconnectReason: {
    loggedOut: 401,
  },
  Browsers: {
    ubuntu: jest.fn(),
  },
  delay: jest.fn().mockResolvedValue(undefined as unknown as never),
}));

describe('authenticateWhatsApp integration flow', () => {
  it('initializes socket and completes authentication with reconnect & cleanup', async () => {
    jest.useFakeTimers();
    const { authenticateWhatsApp } = await import('../../../cli/whatsappAuthHelper.js');

    const authPromise = authenticateWhatsApp('qr');

    // Allow promise tick to initialize startSock
    await jest.advanceTimersByTimeAsync(100);

    // Trigger reconnect (restartRequired 515)
    connectionUpdateHandler?.({
      connection: 'close',
      lastDisconnect: {
        date: new Date(),
        error: { output: { statusCode: 515 } },
      },
    });

    // Advance for reconnect timer (1500ms)
    await jest.advanceTimersByTimeAsync(1600);

    // Then trigger open (success)
    connectionUpdateHandler?.({
      connection: 'open',
    });

    await jest.advanceTimersByTimeAsync(100);

    const result = await authPromise;
    expect(result).toBe(true);
    expect(mockRemoveAllListeners).toHaveBeenCalledWith('creds.update');
    expect(mockEnd).toHaveBeenCalled();
    jest.useRealTimers();
  }, 20000);
});
