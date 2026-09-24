import { eventInboxService } from './EventInboxService.js';

let intervalId: NodeJS.Timeout | null = null;

export const mailboxWatcher = {
  start(): void {
    if (intervalId !== null) {
      console.log('[MailboxWatcher] 📧 Watcher déjà démarré.');
      return;
    }
    console.log('[MailboxWatcher] 📧 Simulation écoute asynchrone démarrée...');
    // Simule la réception d'un événement externe toutes les 30 minutes
    intervalId = setInterval(
      async () => {
        // setInterval ignore la promesse renvoyée par ce callback : sans ce
        // try/catch, un rejet de pushEvent deviendrait un unhandled rejection.
        try {
          await eventInboxService.pushEvent('system_notification', 'cron_simulator', {
            message: 'Il est temps de vérifier les logs système.',
          });
        } catch (error) {
          console.error(
            '[MailboxWatcher] 📧 Erreur lors de la simulation écoute asynchrone:',
            error,
          );
        }
      },
      30 * 60 * 1000,
    );
    intervalId.unref();
  },

  stop(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
      console.log('[MailboxWatcher] 📧 Simulation écoute asynchrone arrêtée.');
    }
  },
};
