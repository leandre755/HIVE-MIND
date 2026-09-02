import { describe, it, expect, beforeEach } from '@jest/globals';
import { FairnessQueue } from '../../../core/FairnessQueue.js';

describe('FairnessQueue (SS-02: Core / Concurrency)', () => {
  let queue: FairnessQueue;

  beforeEach(() => {
    queue = new FairnessQueue();
  });

  describe('Initialisation', () => {
    it('initialise avec un état vide et des métriques à zéro', () => {
      expect(queue.size).toBe(0);
      expect(queue.activeChats).toBe(0);
      expect(queue.dequeue()).toBeNull();
    });
  });

  describe('Enqueue & Dequeue (Mono-Chat)', () => {
    it('enfile et défile un événement unique avec nettoyage de la rotation', () => {
      const event = { chatId: 'chat_1', message: 'Hello' };
      queue.enqueue('chat_1', event);

      expect(queue.size).toBe(1);
      expect(queue.activeChats).toBe(1);

      const dequeued = queue.dequeue();
      expect(dequeued).toEqual(event);
      expect(queue.size).toBe(0);
      expect(queue.activeChats).toBe(0);
      expect(queue.dequeue()).toBeNull();
    });

    it('défile les événements en FIFO strict pour un même chat', () => {
      const e1 = { chatId: 'chat_1', id: 1 };
      const e2 = { chatId: 'chat_1', id: 2 };
      queue.enqueue('chat_1', e1);
      queue.enqueue('chat_1', e2);

      expect(queue.size).toBe(2);
      expect(queue.dequeue()).toEqual(e1);
      expect(queue.size).toBe(1);
      expect(queue.dequeue()).toEqual(e2);
      expect(queue.size).toBe(0);
      expect(queue.activeChats).toBe(0);
    });
  });

  describe('Round-Robin Interleaving (Prévention de la Famine / Anti-Starvation)', () => {
    it('alterne équitablement entre les différents chats actifs', () => {
      queue.enqueue('user_A', { chatId: 'user_A', msg: 'A1' });
      queue.enqueue('user_A', { chatId: 'user_A', msg: 'A2' });
      queue.enqueue('user_B', { chatId: 'user_B', msg: 'B1' });
      queue.enqueue('user_C', { chatId: 'user_C', msg: 'C1' });

      expect(queue.size).toBe(4);
      expect(queue.activeChats).toBe(3);

      // Tour 1 : user_A, user_B, user_C
      expect(queue.dequeue()).toEqual({ chatId: 'user_A', msg: 'A1' });
      expect(queue.dequeue()).toEqual({ chatId: 'user_B', msg: 'B1' });
      expect(queue.dequeue()).toEqual({ chatId: 'user_C', msg: 'C1' });

      // Tour 2 : user_A récupère le worker car user_B et user_C sont purgés
      expect(queue.dequeue()).toEqual({ chatId: 'user_A', msg: 'A2' });
      expect(queue.dequeue()).toBeNull();
      expect(queue.size).toBe(0);
      expect(queue.activeChats).toBe(0);
    });
  });

  describe('Bypass Prioritaire / Premium (Admin DM)', () => {
    it('insère les messages VIP en tête de file et positionne la rotation immédiatement', () => {
      queue.enqueue('user_A', { chatId: 'user_A', msg: 'A1' });
      queue.enqueue('user_A', { chatId: 'user_A', msg: 'A2' });
      queue.enqueue('user_B', { chatId: 'user_B', msg: 'B1' });

      // VIP injecté sur user_A
      queue.enqueue('user_A', { chatId: 'user_A', msg: 'A_VIP' }, true);

      // A_VIP doit sortir en tout premier
      expect(queue.dequeue()).toEqual({ chatId: 'user_A', msg: 'A_VIP' });
      // La rotation Round-Robin continue vers user_B
      expect(queue.dequeue()).toEqual({ chatId: 'user_B', msg: 'B1' });
      // Puis les messages restants de user_A
      expect(queue.dequeue()).toEqual({ chatId: 'user_A', msg: 'A1' });
      expect(queue.dequeue()).toEqual({ chatId: 'user_A', msg: 'A2' });
      expect(queue.dequeue()).toBeNull();
    });

    it('gère un événement premium pour un chat entrant', () => {
      queue.enqueue('chat_standard', { chatId: 'chat_standard', msg: 'STD' });
      queue.enqueue('chat_vip', { chatId: 'chat_vip', msg: 'VIP' }, true);

      expect(queue.dequeue()).toEqual({ chatId: 'chat_vip', msg: 'VIP' });
      expect(queue.dequeue()).toEqual({ chatId: 'chat_standard', msg: 'STD' });
    });
  });

  describe('advance et gestion des limites de rotation', () => {
    it('gère le rebouclage modulo et ne crash pas sur file vide', () => {
      queue.advance();
      expect(queue.currentIndex).toBe(0);

      queue.enqueue('c1', { chatId: 'c1' });
      queue.enqueue('c2', { chatId: 'c2' });
      expect(queue.currentIndex).toBe(0);
      queue.advance();
      expect(queue.currentIndex).toBe(1);
      queue.advance();
      expect(queue.currentIndex).toBe(0);
    });
  });
});
