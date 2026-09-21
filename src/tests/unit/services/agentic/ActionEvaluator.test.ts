import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.unstable_mockModule('../../../../services/supabase.js', () => ({
  supabase: null,
}));

jest.unstable_mockModule('../../../../providers/index.js', () => ({
  providerRouter: {},
}));

const { ActionEvaluator } = await import('../../../../services/agentic/ActionEvaluator.js');

describe('ActionEvaluator Lifecycle', () => {
  let evaluator: InstanceType<typeof ActionEvaluator>;

  beforeEach(() => {
    jest.useFakeTimers();
    evaluator = new ActionEvaluator();
  });

  afterEach(() => {
    evaluator.shutdown();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('tracks active feedback timer, resolves on timer expiry, and cleans up on shutdown', async () => {
    const feedbackPromise = evaluator._detectFeedback('chat123', new Date().toISOString());

    // Advance timers so feedbackWindow completes
    await jest.advanceTimersByTimeAsync(evaluator.feedbackWindow);
    await expect(feedbackPromise).resolves.toBeNull();

    // Now start a second feedback detection and shut down immediately
    const shutdownPromise = evaluator._detectFeedback('chat123', new Date().toISOString());
    evaluator.shutdown();
    await expect(shutdownPromise).resolves.toBeNull();
  });

  it('aborts evaluate and returns null when shutdown is called during feedback wait', async () => {
    const action = {
      id: 'action_1',
      tool: 'test_tool',
      params: {},
      result: 'success',
      error: null,
      duration_ms: 150,
      chatId: 'chat123',
      timestamp: new Date().toISOString(),
    };

    const evalPromise = evaluator.evaluate(action);
    evaluator.shutdown();
    const result = await evalPromise;
    expect(result).toBeNull();
  });

  it('returns null immediately from evaluate and _detectFeedback when already shut down', async () => {
    evaluator.shutdown();
    const evalResult = await evaluator.evaluate({
      id: 'action_2',
      tool: 'test_tool_2',
      params: {},
      result: 'success',
      error: null,
      duration_ms: 50,
      chatId: 'chat123',
      timestamp: new Date().toISOString(),
    });
    expect(evalResult).toBeNull();

    const feedbackResult = await evaluator._detectFeedback('chat123', new Date().toISOString());
    expect(feedbackResult).toBeNull();
  });

  it('completes evaluation when feedback window elapses normally without shutdown', async () => {
    const action = {
      id: 'action_normal',
      tool: 'test_tool',
      params: {},
      result: 'success',
      error: null,
      duration_ms: 100,
      chatId: 'chat123',
      timestamp: new Date().toISOString(),
    };

    const evalPromise = evaluator.evaluate(action);
    await jest.advanceTimersByTimeAsync(evaluator.feedbackWindow);
    const result = await evalPromise;
    expect(result).toBeDefined();
    expect(result?.score).toBeGreaterThan(0);
  });
});
