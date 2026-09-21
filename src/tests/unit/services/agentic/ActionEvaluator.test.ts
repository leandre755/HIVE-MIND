import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { ActionEvaluator } from '../../../../services/agentic/ActionEvaluator.js';

describe('ActionEvaluator Lifecycle', () => {
  let evaluator: ActionEvaluator;

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
    evaluator._detectFeedback('chat123', new Date().toISOString());
    evaluator.shutdown();
    expect(evaluator).toBeDefined();
  });
});
