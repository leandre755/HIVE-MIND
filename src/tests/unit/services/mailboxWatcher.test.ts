// tests/unit/services/mailboxWatcher.test.ts
// Issue #20 — le callback async passé à setInterval doit absorber les rejets
// de pushEvent : setInterval ignore la promesse, un rejet deviendrait un
// unhandled rejection capable de tuer le processus.
import { describe, it, beforeEach, afterEach, jest, expect } from '@jest/globals';

const pushEventMock = jest.fn(async (..._args: unknown[]) => undefined);

jest.unstable_mockModule('../../../services/events/EventInboxService.js', () => ({
  eventInboxService: { pushEvent: pushEventMock },
}));

const { mailboxWatcher } = await import('../../../services/events/MailboxWatcher.js');

describe('MailboxWatcher — rejet du callback asynchrone (#20)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    pushEventMock.mockReset();
    pushEventMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    mailboxWatcher.stop();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('avale une erreur de pushEvent sans rejet non géré et la journalise', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('inbox down');
    pushEventMock.mockRejectedValue(failure);

    mailboxWatcher.start();
    await jest.advanceTimersByTimeAsync(30 * 60 * 1000);

    expect(pushEventMock).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[MailboxWatcher] 📧 Erreur lors de la simulation écoute asynchrone:',
      failure,
    );
    consoleErrorSpy.mockRestore();
  });

  it('pousse toujours l événement nominal quand pushEvent réussit', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

    mailboxWatcher.start();
    mailboxWatcher.start(); // garde anti-double-démarrage
    await jest.advanceTimersByTimeAsync(30 * 60 * 1000);

    expect(pushEventMock).toHaveBeenCalledTimes(1);
    expect(pushEventMock).toHaveBeenCalledWith('system_notification', 'cron_simulator', {
      message: 'Il est temps de vérifier les logs système.',
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    mailboxWatcher.stop();
    await jest.advanceTimersByTimeAsync(60 * 60 * 1000);
    expect(pushEventMock).toHaveBeenCalledTimes(1);

    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });
});
