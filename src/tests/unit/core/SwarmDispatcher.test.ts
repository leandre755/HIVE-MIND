import { describe, it, expect, beforeEach } from '@jest/globals';
import swarmDispatcher from '../../../core/concurrency/SwarmDispatcher.js';

describe('SwarmDispatcher (SS-03: Core / Concurrency Swarm)', () => {
  beforeEach(() => {
    const internals = swarmDispatcher as unknown as {
      globalQueue: Array<() => void>;
      accessMap: Map<string, Promise<unknown>>;
      metrics: {
        activeThreads: number;
        queuedTasks: number;
        totalProcessed: number;
        errors: number;
      };
    };
    internals.globalQueue.length = 0;
    internals.accessMap.clear();
    internals.metrics.activeThreads = 0;
    internals.metrics.queuedTasks = 0;
    internals.metrics.totalProcessed = 0;
    internals.metrics.errors = 0;
  });
  it('sérialise strictement les tâches asynchrones d un même JID', async () => {
    const jid = 'chat_serial@whatsapp.net';
    const executionOrder: number[] = [];

    const task1 = swarmDispatcher.dispatch(jid, { id: 'm1' }, async () => {
      await new Promise((r) => setTimeout(r, 25));
      executionOrder.push(1);
      return 1;
    });

    const task2 = swarmDispatcher.dispatch(jid, { id: 'm2' }, async () => {
      executionOrder.push(2);
      return 2;
    });

    const [r1, r2] = await Promise.all([task1, task2]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(executionOrder).toEqual([1, 2]);
  });

  it('exécute en parallèle les tâches de JIDs distincts', async () => {
    const jidA = 'user_A@domain.com';
    const jidB = 'user_B@domain.com';
    const trace: { jid: string; start: number }[] = [];

    const pA = swarmDispatcher.dispatch(jidA, { id: 'mA' }, async () => {
      trace.push({ jid: 'A', start: Date.now() });
      await new Promise((r) => setTimeout(r, 30));
    });

    const pB = swarmDispatcher.dispatch(jidB, { id: 'mB' }, async () => {
      trace.push({ jid: 'B', start: Date.now() });
      await new Promise((r) => setTimeout(r, 30));
    });

    await Promise.all([pA, pB]);
    expect(trace).toHaveLength(2);
  });

  it('retourne les métriques de concurrence et de workers système', () => {
    const metrics = swarmDispatcher.getMetrics();
    expect(metrics).toBeDefined();
    expect(typeof metrics.maxConcurrency).toBe('number');
    expect(metrics.maxConcurrency).toBeGreaterThanOrEqual(2);
    expect(typeof metrics.totalProcessed).toBe('number');
  });

  it('respecte strictement le plafond maxConcurrency sous forte charge concurrente', async () => {
    const max = 3;
    const originalGetMax = swarmDispatcher.getMaxConcurrency;
    swarmDispatcher.getMaxConcurrency = () => max;

    let activeCount = 0;
    let maxObservedOverlap = 0;
    let maxObservedMetrics = 0;
    const taskPromises: Promise<unknown>[] = [];

    try {
      for (let i = 0; i < 15; i++) {
        const jid = `load_user_${i}@domain.com`;
        taskPromises.push(
          swarmDispatcher.dispatch(jid, { id: `task_${i}` }, async () => {
            activeCount++;
            maxObservedOverlap = Math.max(maxObservedOverlap, activeCount);
            maxObservedMetrics = Math.max(
              maxObservedMetrics,
              swarmDispatcher.getMetrics().activeThreads,
            );
            try {
              await new Promise((r) => setTimeout(r, 15));
            } finally {
              activeCount--;
            }
          }),
        );
      }
      await Promise.all(taskPromises);
    } finally {
      swarmDispatcher.getMaxConcurrency = originalGetMax;
    }

    expect(maxObservedOverlap).toBeLessThanOrEqual(max);
    expect(maxObservedMetrics).toBeLessThanOrEqual(max);
    expect(activeCount).toBe(0);
    expect(swarmDispatcher.getMetrics().activeThreads).toBe(0);
  });

  it('empêche le queue barging en respectant la file globale', async () => {
    const max = 2;
    const originalGetMax = swarmDispatcher.getMaxConcurrency;
    swarmDispatcher.getMaxConcurrency = () => max;

    const executionOrder: number[] = [];

    try {
      // Tâches 1 et 2 remplissent la capacité
      const t1 = swarmDispatcher.dispatch('jid_1', { id: 'm1' }, async () => {
        await new Promise((r) => setTimeout(r, 40));
        executionOrder.push(1);
      });

      const t2 = swarmDispatcher.dispatch('jid_2', { id: 'm2' }, async () => {
        await new Promise((r) => setTimeout(r, 40));
        executionOrder.push(2);
      });

      // Tâche 3 entre dans la file d'attente globale après saturation avérée
      await new Promise((r) => setImmediate(r));
      expect(swarmDispatcher.getMetrics().activeThreads).toBe(max);

      const t3 = swarmDispatcher.dispatch('jid_3', { id: 'm3' }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        executionOrder.push(3);
      });

      // Tâche 4 arrive peu après : elle doit attendre derrière t3, sans sauter la file
      const t4 = swarmDispatcher.dispatch('jid_4', { id: 'm4' }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        executionOrder.push(4);
      });

      await Promise.all([t1, t2, t3, t4]);
    } finally {
      swarmDispatcher.getMaxConcurrency = originalGetMax;
    }

    // t3 doit impérativement être exécuté avant t4
    expect(executionOrder.indexOf(3)).toBeLessThan(executionOrder.indexOf(4));
  });

  it('exécute les commandes prioritaires (!stop) sans attendre une tâche bloquée du même JID', async () => {
    const jid = 'chat_stuck@whatsapp.net';
    const executionOrder: string[] = [];
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });

    // Tâche 1 lente
    const t1 = swarmDispatcher.dispatch(jid, { id: 'slow_task' }, async () => {
      await slowGate;
      executionOrder.push('slow');
    });

    // Commande prioritaire !stop envoyée sur le même JID pendant que t1 tourne
    const tStop = swarmDispatcher.dispatch(jid, { id: 'stop_msg', text: '!stop' }, async () => {
      executionOrder.push('stop');
    });

    await tStop;
    expect(executionOrder).toEqual(['stop']);

    releaseSlow();
    await t1;

    // !stop s'est exécuté immédiatement avant la libération de la tâche lente
    expect(executionOrder[0]).toBe('stop');
    expect(executionOrder[1]).toBe('slow');
  });

  it('préserve la sérialisation du JID pour les commandes prioritaires non-urgentes (!ping)', async () => {
    const jid = 'chat_ping@whatsapp.net';
    const executionOrder: string[] = [];

    const t1 = swarmDispatcher.dispatch(jid, { id: 'slow_task' }, async () => {
      await new Promise((r) => setTimeout(r, 40));
      executionOrder.push('slow');
    });

    const tPing = swarmDispatcher.dispatch(jid, { id: 'ping_msg', text: '!ping' }, async () => {
      executionOrder.push('ping');
    });

    await Promise.all([t1, tPing]);

    expect(executionOrder[0]).toBe('slow');
    expect(executionOrder[1]).toBe('ping');
  });

  it('débloque les tâches ultérieures du JID après un signal d urgence !stop', async () => {
    const jid = 'chat_hang@whatsapp.net';
    const executionOrder: string[] = [];
    let releaseHung!: () => void;
    const hungGate = new Promise<void>((resolve) => {
      releaseHung = resolve;
    });

    // Tâche 1 bloquée (longue)
    const tHung = swarmDispatcher.dispatch(jid, { id: 'hung_task' }, async () => {
      await hungGate;
      executionOrder.push('hung');
    });

    // Signal d'urgence !stop
    await swarmDispatcher.dispatch(jid, { id: 'emergency_stop', text: '!stop' }, async () => {
      executionOrder.push('stop');
    });

    // Tâche 3 envoyée après le !stop sur le même JID
    await swarmDispatcher.dispatch(jid, { id: 'next_task' }, async () => {
      executionOrder.push('next');
    });

    expect(executionOrder).toContain('stop');
    expect(executionOrder).toContain('next');
    // 'next' s'est exécuté immédiatement sans attendre la tâche suspendue
    expect(executionOrder).not.toContain('hung');
    expect(executionOrder.indexOf('next')).toBeGreaterThan(executionOrder.indexOf('stop'));

    // Libération déterministe de la tâche suspendue
    releaseHung();
    await tHung;
    expect(executionOrder).toContain('hung');
    expect(executionOrder.indexOf('hung')).toBeGreaterThan(executionOrder.indexOf('next'));
  });
});
