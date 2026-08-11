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
        await eventInboxService.pushEvent('system_notification', 'cron_simulator', {
          message: 'Il est temps de vérifier les logs système.',
        });
      },
      30 * 60 * 1000,
    );
  },

  stop(): void {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
      console.log('[MailboxWatcher] 📧 Simulation écoute asynchrone arrêtée.');
    }
  },
};
