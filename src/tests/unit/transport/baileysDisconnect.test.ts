import { jest } from '@jest/globals';
import EventEmitter from 'events';

// Mock du logger
jest.unstable_mockModule('../../../utils/logger.js', () => ({
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

interface MockSock extends EventEmitter {
  ev: EventEmitter;
  end: jest.Mock<(_error?: Error) => void>;
  sendPresenceUpdate: jest.Mock<() => Promise<void>>;
}

describe('BaileysTransport - Intentional Disconnect', () => {
  let baileysTransport: unknown;
  let removeSpy: jest.SpiedFunction<() => void>;

  beforeEach(async () => {
    jest.useFakeTimers();

    const { default: bt } = await import('../../../core/transport/baileys.js');
    baileysTransport = bt;
    (baileysTransport as { isConnecting: boolean }).isConnecting = false;
    (baileysTransport as { isDisconnecting: boolean }).isDisconnecting = false;

    // Reset du timer s'il existait d'un test précédent
    if ((baileysTransport as { reconnectTimer: NodeJS.Timeout | null }).reconnectTimer) {
      clearTimeout((baileysTransport as { reconnectTimer: NodeJS.Timeout | null }).reconnectTimer!);
      (baileysTransport as { reconnectTimer: NodeJS.Timeout | null }).reconnectTimer = null;
    }

    removeSpy = jest.spyOn(
      baileysTransport as { _removeRegisteredListeners: () => void },
      '_removeRegisteredListeners',
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("ne devrait pas planifier de reconnexion lors d'une déconnexion intentionnelle", async () => {
    const mockSock = new EventEmitter() as MockSock;
    mockSock.ev = new EventEmitter();
    mockSock.end = jest.fn((_error: Error | undefined) => {
      mockSock.emit('connection.update', {
        connection: 'close',
        lastDisconnect: { error: new Error('Stream Closed') },
      });
    });
    mockSock.sendPresenceUpdate = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

    (baileysTransport as { sock: MockSock }).sock = mockSock;
    (baileysTransport as { saveCreds: unknown }).saveCreds = jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);

    // Act : appeler disconnect()
    await (baileysTransport as { disconnect: () => Promise<void> }).disconnect();

    // Assert
    expect((baileysTransport as { isDisconnecting: boolean }).isDisconnecting).toBe(false);
    expect(removeSpy).toHaveBeenCalled();
    expect(mockSock.end).toHaveBeenCalledWith(undefined);
    expect(
      (baileysTransport as { reconnectTimer: NodeJS.Timeout | null }).reconnectTimer,
    ).toBeNull();
  });
});
