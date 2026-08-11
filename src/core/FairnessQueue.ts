// core/FairnessQueue.js
/**
 * File d'attente à équité garantie (Fairness Queue)
 * Implémente un algorithme Round-Robin pondéré entre les chatIds
 */

/** Shape of an event in the queue */
interface QueueEvent {
  readonly chatId: string;
  readonly timestamp?: number;
  [key: string]: unknown;
}

export class FairnessQueue {
  queues: Map<string, QueueEvent[]>;
  chatIds: string[];
  currentIndex: number;

  constructor() {
    // Map<chatId, Array<Event>>
    this.queues = new Map();
    // Liste circulaire des chatIds actifs
    this.chatIds = [];
    // Index courant pour le Round-Robin
    this.currentIndex = 0;
  }

  /**
   * Ajoute un événement à la file spécifique de son chatId
   * @param {string} chatId
   * @param {QueueEvent} event
   * @param {boolean} isPremium - Si vrai, saute la file (ex: Admin DM)
   */
  enqueue(chatId: string, event: QueueEvent, isPremium: boolean = false) {
    if (!this.queues.has(chatId)) {
      this.queues.set(chatId, []);
      this.chatIds.push(chatId);
    }

    const queue = this.queues.get(chatId);
    if (!queue) return; // Invariant: set above, but TypeScript requires the guard

    // Les événements premium (Admin) sont ajoutés au DÉBUT de leur file
    // et on pourrait même implémenter une file prioritaire séparée si besoin
    if (isPremium) {
      queue.unshift(event);
      // On s'assure que ce chat est le prochain servi
      const idx = this.chatIds.indexOf(chatId);
      if (idx !== -1) this.currentIndex = idx;
    } else {
      queue.push(event);
    }
  }

  /**
   * Récupère le prochain événement selon l'algo Round-Robin
   * CORRECTION: Utilise un snapshot pour éviter les race conditions
   * @returns {Object|null}
   */
  dequeue(): QueueEvent | null {
    if (this.chatIds.length === 0) return null;

    const totalChats = this.chatIds.length;
    for (let i = 0; i < totalChats; i++) {
      this.adjustCurrentIndex();
      if (this.chatIds.length === 0) return null;

      const event = this.tryDequeueCurrentChat();
      if (event) return event;
    }

    return null;
  }

  private adjustCurrentIndex() {
    if (this.currentIndex >= this.chatIds.length) {
      this.currentIndex = 0;
    }
  }

  private tryDequeueCurrentChat(): QueueEvent | null {
    const chatId = this.chatIds[this.currentIndex];
    const queue = this.queues.get(chatId);

    if (!queue || queue.length === 0) {
      this.removeChatFromRotation(chatId);
      return null;
    }

    const event = queue.shift() as QueueEvent;
    if (queue.length === 0) {
      this.removeChatFromRotation(chatId);
    } else {
      this.advance();
    }
    return event;
  }

  private removeChatFromRotation(chatId: string) {
    this.queues.delete(chatId);
    const idx = this.chatIds.indexOf(chatId);
    if (idx !== -1) {
      this.chatIds.splice(idx, 1);
    }
    if (this.chatIds.length > 0 && this.currentIndex >= this.chatIds.length) {
      this.currentIndex = 0;
    }
  }

  advance() {
    if (this.chatIds.length === 0) {
      this.currentIndex = 0;
    } else {
      this.currentIndex = (this.currentIndex + 1) % this.chatIds.length;
    }
  }

  get size() {
    let count = 0;
    for (const q of this.queues.values()) {
      count += q.length;
    }
    return count;
  }

  get activeChats() {
    return this.chatIds.length;
  }
}
