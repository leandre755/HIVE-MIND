import { describe, it, expect, jest } from '@jest/globals';
import { DisconnectReason, type ConnectionState, type WASocket } from '@whiskeysockets/baileys';
import {
  handleConnectionClose,
  processConnectionUpdate,
  cleanupActiveSocket,
  scheduleReconnect,
  type SocketContext,
} from '../../../cli/whatsappAuthHelper.js';

type DisconnectInfo = NonNullable<Partial<ConnectionState>['lastDisconnect']>;

const createDisconnect = (statusCode?: number): DisconnectInfo => ({
  date: new Date(),
  error: {
    output: {
      statusCode,
    },
  } as unknown as Error,
});

describe('whatsappAuthHelper - Connection Handling', () => {
  it('does nothing when connection is closed but already finished', () => {
    const onReconnect = jest.fn();
    const onFail = jest.fn();

    handleConnectionClose(
      createDisconnect(515),
      false,
      true,
      true, // isFinished = true
      onReconnect,
      onFail,
    );

    expect(onReconnect).not.toHaveBeenCalled();
    expect(onFail).not.toHaveBeenCalled();
  });

  it('calls onFail when logged out', () => {
    const onReconnect = jest.fn();
    const onFail = jest.fn();

    handleConnectionClose(
      createDisconnect(DisconnectReason.loggedOut),
      false,
      false,
      false,
      onReconnect,
      onFail,
    );

    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onReconnect).not.toHaveBeenCalled();
  });

  it('calls onReconnect immediately when registered (status 515 restartRequired)', () => {
    const onReconnect = jest.fn();
    const onFail = jest.fn();

    handleConnectionClose(
      createDisconnect(515),
      false,
      true, // isRegistered = true
      false,
      onReconnect,
      onFail,
    );

    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(onFail).not.toHaveBeenCalled();
  });

  it('calls onReconnect when pairing was requested and connection dropped', () => {
    const onReconnect = jest.fn();
    const onFail = jest.fn();

    handleConnectionClose(
      createDisconnect(408),
      true, // pairingRequested = true
      false,
      false,
      onReconnect,
      onFail,
    );

    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(onFail).not.toHaveBeenCalled();
  });

  it('calls onFail on unexpected error without registered or pairing flags', () => {
    const onReconnect = jest.fn();
    const onFail = jest.fn();

    handleConnectionClose(createDisconnect(500), false, false, false, onReconnect, onFail);

    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onReconnect).not.toHaveBeenCalled();
  });

  describe('processConnectionUpdate', () => {
    it('calls finish(true) on connection open', () => {
      const finish = jest.fn();
      const reconnect = jest.fn();
      const ctx: SocketContext = {
        mode: 'qr',
        isRegisteredLive: () => true,
        pairingState: { requested: false },
        isFinishedLive: () => false,
        finish,
        reconnect,
      };

      processConnectionUpdate({ connection: 'open' }, ctx);

      expect(finish).toHaveBeenCalledWith(true);
    });

    it('delegates to handleConnectionClose on connection close', () => {
      const finish = jest.fn();
      const reconnect = jest.fn();
      const ctx: SocketContext = {
        mode: 'pairing',
        isRegisteredLive: () => true,
        pairingState: { requested: false },
        isFinishedLive: () => false,
        finish,
        reconnect,
      };

      processConnectionUpdate(
        {
          connection: 'close',
          lastDisconnect: createDisconnect(515),
        },
        ctx,
      );

      expect(reconnect).toHaveBeenCalledTimes(1);
      expect(finish).not.toHaveBeenCalled();
    });
  });

  describe('cleanupActiveSocket and scheduleReconnect', () => {
    it('handles null socket safely in cleanupActiveSocket', () => {
      expect(() => cleanupActiveSocket(null)).not.toThrow();
    });

    it('cleans up event listeners and ends active socket in cleanupActiveSocket', () => {
      const mockSocket = {
        ev: {
          removeAllListeners: jest.fn(),
        },
        end: jest.fn(),
      } as unknown as WASocket;

      cleanupActiveSocket(mockSocket);

      expect(mockSocket.ev.removeAllListeners).toHaveBeenCalledWith('creds.update');
      expect(mockSocket.ev.removeAllListeners).toHaveBeenCalledWith('connection.update');
      expect(mockSocket.end).toHaveBeenCalledWith(undefined);
    });

    it('catches and ignores socket.end errors safely', () => {
      const throwingSocket = {
        ev: {
          removeAllListeners: jest.fn(),
        },
        end: jest.fn().mockImplementation(() => {
          throw new Error('Socket already destroyed');
        }),
      } as unknown as WASocket;

      expect(() => cleanupActiveSocket(throwingSocket)).not.toThrow();
    });

    it('schedules reconnect and clears previous timer in scheduleReconnect', () => {
      jest.useFakeTimers();
      const callback = jest.fn();
      const previousTimer = setTimeout(() => {}, 10000);
      const clearSpy = jest.spyOn(global, 'clearTimeout');

      const newTimer = scheduleReconnect(previousTimer, callback, 1500);

      expect(clearSpy).toHaveBeenCalledWith(previousTimer);
      expect(callback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1500);
      expect(callback).toHaveBeenCalledTimes(1);

      clearTimeout(newTimer);
      jest.useRealTimers();
    });
  });
});
