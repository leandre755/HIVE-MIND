import { describe, it, expect } from '@jest/globals';
import swarmDispatcher from '../../../core/concurrency/SwarmDispatcher.js';

describe('SwarmDispatcher (SS-03: Core / Concurrency Swarm)', () => {
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
});
