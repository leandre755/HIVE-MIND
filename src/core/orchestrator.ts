// core/orchestrator.js
// Gestionnaire d'événements asynchrones - Sépare réception et traitement

import EventEmitter from 'events';
import { safeReadFileSync } from '../utils/safeFs.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { FairnessQueue } from './FairnessQueue.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface QueueEvent {
  type: string;
  chatId: string;
  data: unknown;
  timestamp?: number;
  priority?: number;
  [key: string]: unknown;
}

interface BacklogConfig {
  backlog_protection?: {
    cooldown_between_responses_ms?: number;
  };
}

// Charger la configuration de protection contre le backlog
let config: BacklogConfig;
try {
  config = JSON.parse(
    safeReadFileSync(join(__dirname, '..', 'config', 'config.json'), 'utf-8'),
  ) as BacklogConfig;
} catch {
  config = {
    backlog_protection: {
      cooldown_between_responses_ms: 2000,
    },
  };
}

// Variable locale pour la configuration active (modifiable pour les tests)
let activeConfig = config;

class Orchestrator extends EventEmitter {
  queue: FairnessQueue;
  processing: boolean;
  handlers: Map<string, (event: QueueEvent) => Promise<unknown>>;
  maxConcurrent: number;
  activeCount: number;
  lastProcessedTime: number;

  constructor() {
    super();
    this.queue = new FairnessQueue();
    this.processing = false;
    this.handlers = new Map();
    this.maxConcurrent = 3;
    this.activeCount = 0;
    this.lastProcessedTime = 0; // Timestamp du dernier traitement (pour cooldown)
  }

  /**
   * Enregistre un handler pour un type d'événement
   */
  registerHandler(type: string, handler: (event: QueueEvent) => Promise<unknown>) {
    this.handlers.set(type, handler);
  }

  /**
   * Met à jour la configuration (pour les tests)
   */
  setConfig(newConfig: BacklogConfig) {
    activeConfig = { ...activeConfig, ...newConfig };
    console.log('[Orchestrator] Configuration mise à jour');
  }

  /**
   * Ajoute un événement à la file d'attente
   */
  enqueue(event: QueueEvent) {
    const queueEvent: QueueEvent = {
      ...event,
      timestamp: event.timestamp || Date.now(),
      priority: event.priority || 3,
    };

    // Insertion intelligente via Fairness Queue
    // On considère les messages privés ou admin comme "Priority 1"
    const isPremium = (queueEvent.priority ?? 3) <= 1;
    this.queue.enqueue(queueEvent.chatId, queueEvent, isPremium);

    this.emit('queued', queueEvent);
    this.process().catch((err) => {
      console.error('[Orchestrator] Process error:', err);
    });
  }

  /**
   * Traite la file de manière asynchrone
   */
  async process() {
    if (this.activeCount >= this.maxConcurrent || this.queue.size === 0) {
      return;
    }

    while (this.queue.size > 0 && this.activeCount < this.maxConcurrent) {
      const event = this.queue.dequeue() as unknown as QueueEvent | null;
      if (!event) break;

      this.activeCount++;
      this.executeEventLifecycle(event);
    }
  }

  private executeEventLifecycle(event: QueueEvent) {
    this.handleEvent(event)
      .then(() => {
        this.emit('processed', event);
      })
      .catch((error) => {
        this.emit('error', { event, error });
      })
      .finally(() => {
        this.activeCount--;
        this.process().catch((err) => {
          console.error('[Orchestrator] Loop process error:', err);
        });
      });
  }

  /**
   * Dispatch vers le handler approprié
   */
  async handleEvent(event: QueueEvent) {
    this.emit('processing', event);

    const handler = this.handlers.get(event.type);
    if (!handler) {
      console.warn(`[Orchestrator] Aucun handler pour le type: ${event.type}`);
      return;
    }

    try {
      await this.applyCooldown();
      await handler(event);
      this.lastProcessedTime = Date.now(); // Mettre à jour le timestamp
    } catch (error) {
      console.error('[Orchestrator] Erreur lors du traitement:', error);
      throw error;
    }
  }

  private async applyCooldown() {
    const cooldownMs = activeConfig.backlog_protection?.cooldown_between_responses_ms;
    if (!cooldownMs) return;

    // Skip cooldown when queue is empty — no congestion to protect against
    if (this.queue.size === 0) return;

    const timeSinceLastProcess = Date.now() - this.lastProcessedTime;
    if (this.lastProcessedTime > 0 && timeSinceLastProcess < cooldownMs) {
      const waitTime = cooldownMs - timeSinceLastProcess;
      console.log(`[Orchestrator] ⏳ Cooldown appliqué: ${waitTime}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  /**
   * Statistiques de la file
   */
  getStats() {
    return {
      queueLength: this.queue.size,
      activeChats: this.queue.activeChats,
      activeCount: this.activeCount,
      handlers: Array.from(this.handlers.keys()),
    };
  }

  /**
   * Vide la file d'attente
   */
  clear() {
    this.queue = new FairnessQueue();
    this.emit('cleared');
  }
}

export const orchestrator = new Orchestrator();
export default Orchestrator;
