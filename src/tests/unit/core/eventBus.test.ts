// tests/unit/core/eventBus.test.ts
// MOD 3 — EventBus & TOOL_PROGRESS + MOD 4 — SYSTEM_ERROR
import { describe, it, beforeEach, jest, expect } from '@jest/globals';
import { eventBus, BotEvents } from '../../../core/events.js';

describe('EventBus (MOD 3 + MOD 4)', () => {
  beforeEach(() => {
    eventBus.removeAllListeners();
  });

  it('BotEvents.TOOL_PROGRESS is defined', () => {
    expect(BotEvents.TOOL_PROGRESS).toBe('tool:progress');
  });

  it('BotEvents.SYSTEM_ERROR is defined', () => {
    expect(BotEvents.SYSTEM_ERROR).toBe('system:error');
  });

  it('publish emits event that subscribers receive', () => {
    const handler = jest.fn();
    eventBus.subscribe('test:event', handler);
    eventBus.publish('test:event', { data: 'hello' });
    expect(handler).toHaveBeenCalledWith({ data: 'hello' });
  });

  it('subscribeOnce fires handler only once', () => {
    const handler = jest.fn();
    eventBus.subscribeOnce('test:once', handler);
    eventBus.publish('test:once', 'a');
    eventBus.publish('test:once', 'b');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe removes the handler', () => {
    const handler = jest.fn();
    eventBus.subscribe('test:unsub', handler);
    eventBus.unsubscribe('test:unsub', handler);
    eventBus.publish('test:unsub', 'data');
    expect(handler).not.toHaveBeenCalled();
  });

  it('TOOL_PROGRESS event carries tool, status, chatId', () => {
    const handler = jest.fn();
    eventBus.subscribe(BotEvents.TOOL_PROGRESS, handler);
    const payload = { tool: 'bash', status: 'running', chatId: 'c1' };
    eventBus.publish(BotEvents.TOOL_PROGRESS, payload);
    expect(handler).toHaveBeenCalledWith(payload);
  });

  it('SYSTEM_ERROR event carries BUDGET_EXCEEDED', () => {
    const handler = jest.fn();
    eventBus.subscribe(BotEvents.SYSTEM_ERROR, handler);
    eventBus.publish(BotEvents.SYSTEM_ERROR, { type: 'BUDGET_EXCEEDED', sessionCost: 2.5 });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'BUDGET_EXCEEDED' }));
  });
});
