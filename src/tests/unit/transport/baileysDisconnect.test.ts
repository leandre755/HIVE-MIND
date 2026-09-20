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

interface IBaileysTransport {
  isConnecting: boolean;
  isDisconnecting: boolean;
  reconnectTimer: NodeJS.Timeout | null;
  sock: MockSock | null;
  saveCreds: jest.Mock<() => Promise<void>> | null;
  disconnect: () => Promise<void>;
  connect: (sessionPath: string) => Promise<void>;
  _handleConnectionUpdate: (u: unknown, s: string) => void;
  _removeRegisteredListeners: () => void;
  _cleanupPreviousSocket: () => Promise<void>;
}

describe('BaileysTransport - Intentional Disconnect & Reconnect Timer', () => {
  let baileysTransport: IBaileysTransport;
  let removeSpy: jest.SpiedFunction<() => void>;

  beforeEach(async () => {
    jest.useFakeTimers();

    const { default: bt } = await import('../../../core/transport/baileys.js');
    baileysTransport = bt as unknown as IBaileysTransport;
    baileysTransport.isConnecting = false;
    baileysTransport.isDisconnecting = false;

    if (baileysTransport.reconnectTimer) {
      clearTimeout(baileysTransport.reconnectTimer);
      baileysTransport.reconnectTimer = null;
    }

    removeSpy = jest.spyOn(baileysTransport, '_removeRegisteredListeners');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("ne devrait pas planifier de reconnexion lors d'une déconnexion intentionnelle", async () => {
    const mockSock = new EventEmitter() as MockSock;
    mockSock.ev = new EventEmitter();

    mockSock.end = jest.fn((_error: Error | undefined) => {});
    mockSock.sendPresenceUpdate = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

    baileysTransport.sock = mockSock;
    baileysTransport.saveCreds = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

    // Act
    await baileysTransport.disconnect();

    // Assert
    expect(baileysTransport.isDisconnecting).toBe(false);
    expect(removeSpy).toHaveBeenCalled();
    expect(mockSock.end).toHaveBeenCalledWith(undefined);
    expect(baileysTransport.reconnectTimer).toBeNull();
  });

  it("devrait annuler le reconnectTimer actif lors d'un appel direct à disconnect()", async () => {
    baileysTransport.sock = null;
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    baileysTransport.reconnectTimer = setTimeout(() => {}, 1000);

    await baileysTransport.disconnect();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(expect.any(Object));
    expect(baileysTransport.reconnectTimer).toBeNull();
    expect(baileysTransport.isDisconnecting).toBe(false);
  });

  it('ne devrait pas exécuter la logique de reconnexion dans _handleConnectionUpdate si isDisconnecting est vrai', () => {
    baileysTransport.isDisconnecting = true;

    baileysTransport._handleConnectionUpdate(
      {
        connection: 'close',
        lastDisconnect: { error: new Error('Stream Closed') },
      },
      'session',
    );

    expect(baileysTransport.reconnectTimer).toBeNull();
  });

  it('devrait planifier une reconnexion avec setTimeout et unref() si la connexion est perdue', () => {
    baileysTransport.isDisconnecting = false;

    // Simuler une perte de connexion involontaire
    baileysTransport._handleConnectionUpdate(
      {
        connection: 'close',
        lastDisconnect: { error: new Error('Stream Closed') },
      },
      'session',
    );

    expect(baileysTransport.reconnectTimer).not.toBeNull();
  });

  it("devrait nettoyer un reconnectTimer existant lors d'un appel à connect()", async () => {
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
    baileysTransport.reconnectTimer = setTimeout(() => {}, 1000);

    baileysTransport.isConnecting = true;

    await baileysTransport.connect('session');

    expect(clearTimeoutSpy).toHaveBeenCalledWith(expect.any(Object));
    expect(baileysTransport.reconnectTimer).toBeNull();
  });

  it("devrait attendre que la connexion en cours soit terminée lors de l'appel à disconnect()", async () => {
    baileysTransport.sock = null;
    baileysTransport.isConnecting = true;

    // Lancer la déconnexion en asynchrone
    const disconnectPromise = baileysTransport.disconnect();

    // Vérifier que isDisconnecting a été mis à jour
    expect(baileysTransport.isDisconnecting).toBe(true);

    // Résoudre l'attente : on simule que connect() a fini de setup et a aborté
    baileysTransport.isConnecting = false;

    // Avancer les timers pour sortir du Promise(resolve => setTimeout(100))
    await jest.advanceTimersByTimeAsync(150);

    await disconnectPromise;
    expect(baileysTransport.isDisconnecting).toBe(false);
  });
});

describe('BaileysTransport - connect() error handling', () => {
  let baileysTransport: IBaileysTransport;

  beforeEach(async () => {
    jest.resetModules();
    // Reset env
    const { default: bt } = await import('../../../core/transport/baileys.js');
    baileysTransport = bt as unknown as IBaileysTransport;
    baileysTransport.isConnecting = false;
    baileysTransport.isDisconnecting = false;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('devrait reset isConnecting à false si une erreur se produit pendant connect()', async () => {
    // Force une erreur en mockant _cleanupPreviousSocket
    jest
      .spyOn(baileysTransport, '_cleanupPreviousSocket')
      .mockRejectedValue(new Error('Cleanup Failed'));

    await expect(baileysTransport.connect('session')).rejects.toThrow('Cleanup Failed');

    // Vérifier que la variable a bien été reset
    expect(baileysTransport.isConnecting).toBe(false);
  });
});
