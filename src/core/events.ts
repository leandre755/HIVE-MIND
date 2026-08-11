// core/events.js
// Bus d'événements interne pour la communication entre modules

import EventEmitter from 'events';

class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50); // Augmente la limite pour les plugins
  }

  /**
   * Émet un événement avec logging optionnel
   * @param event L'événement à publier
   * @param args Les arguments associés
   */
  publish(event: string, ...args: unknown[]) {
    if (process.env.DEBUG === 'true') {
      console.log('[EventBus] %s', event, args[0] ? JSON.stringify(args[0]).substring(0, 100) : '');
    }
    this.emit(event, ...args);
  }

  /**
   * S'abonne à un événement
   * @param event L'événement à écouter
   * @param handler Le gestionnaire d'événement
   */
  subscribe(event: string, handler: (...args: unknown[]) => void) {
    this.on(event, handler);
  }

  /**
   * S'abonne à un événement une seule fois
   * @param event L'événement à écouter
   * @param handler Le gestionnaire d'événement
   */
  subscribeOnce(event: string, handler: (...args: unknown[]) => void) {
    this.once(event, handler);
  }

  /**
   * Se désabonne d'un événement
   * @param event L'événement
   * @param handler Le gestionnaire d'événement
   */
  unsubscribe(event: string, handler: (...args: unknown[]) => void) {
    this.off(event, handler);
  }
}

// Événements standards du bot
export const BotEvents = {
  // Messages
  MESSAGE_RECEIVED: 'message:received',
  MESSAGE_SENT: 'message:sent',
  MESSAGE_FAILED: 'message:failed',
  REACTION_RECEIVED: 'message:reaction',

  // IA
  AI_REQUEST: 'ai:request',
  AI_RESPONSE: 'ai:response',
  AI_ERROR: 'ai:error',

  // Plugins
  PLUGIN_LOADED: 'plugin:loaded',
  PLUGIN_EXECUTED: 'plugin:executed',
  PLUGIN_ERROR: 'plugin:error',

  // Tool Progress (Async Rendering)
  TOOL_PROGRESS: 'tool:progress',

  // Scheduler
  JOB_TRIGGERED: 'scheduler:job_triggered',
  JOB_COMPLETED: 'scheduler:job_completed',
  JOB_FAILED: 'scheduler:job_failed',

  // Groupes
  GROUP_JOIN: 'group:join',
  GROUP_LEAVE: 'group:leave',
  GROUP_PROMOTE: 'group:promote',
  GROUP_DEMOTE: 'group:demote',

  // Connexion
  CONNECTED: 'connection:open',
  DISCONNECTED: 'connection:close',
  QR_RECEIVED: 'connection:qr',

  // Mémoire
  MEMORY_STORED: 'memory:stored',
  MEMORY_RECALLED: 'memory:recalled',

  // Événements asynchrones externes (Inbox)
  EVENT_INBOX: 'event:inbox',

  // Déclencheurs proactifs
  PROACTIVE_TRIGGER: 'proactive:trigger',

  // Services
  SERVICE_START: 'service:start',
  SERVICE_END: 'service:end',

  // Custom events for cross-module signaling
  CUSTOM: 'custom:event',

  // Système (Kill Switch, erreurs critiques)
  SYSTEM_ERROR: 'system:error',

  // Transport fatal (conflit de session, irrécupérable automatiquement)
  FATAL_TRANSPORT_CONFLICT: 'transport:fatal',
};

export const eventBus = new EventBus();
export default EventBus;
