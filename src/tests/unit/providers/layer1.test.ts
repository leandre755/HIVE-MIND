// src/tests/unit/providers/layer1.test.ts

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  ModelHealthRegistry,
  WINDOW_MS,
  BUCKET_COUNT,
  FAILURE_RATIO_THRESHOLD,
  MINIMUM_THROUGHPUT,
  COOLDOWN_STEPS_MS,
} from '../../../providers/layer1/ModelHealthRegistry.js';
import { CredentialProvider } from '../../../providers/layer1/CredentialProvider.js';
import { ServiceRegistry } from '../../../providers/layer1/ServiceRegistry.js';
import { SmartLayer } from '../../../providers/layer1/SmartLayer.js';
import { ExecutionLayer } from '../../../providers/layer0/ExecutionLayer.js';
import { ServerError, RateLimitError } from '../../../providers/layer0/errors.js';
import geminiAdapter from '../../../providers/adapters/gemini.js';
import type { AdapterChatResult } from '../../../providers/types.js';

describe('Layer 1 - ModelHealthRegistry', () => {
  beforeEach(() => {
    ModelHealthRegistry.resetInstance();
  });

  it('exports required constants correctly', () => {
    expect(WINDOW_MS).toBe(60000);
    expect(BUCKET_COUNT).toBe(6);
    expect(FAILURE_RATIO_THRESHOLD).toBe(0.5);
    expect(MINIMUM_THROUGHPUT).toBe(3);
    expect(COOLDOWN_STEPS_MS).toEqual([30000, 120000, 600000]);
  });

  it('records successes and calculates P50 latency', () => {
    const registry = ModelHealthRegistry.getInstance();
    const model = 'test-model';

    registry.recordSuccess(model, 100, 'test-fam');
    registry.recordSuccess(model, 200, 'test-fam');
    registry.recordSuccess(model, 300, 'test-fam');

    const stats = registry.getModelStats(model);
    expect(stats.throughput).toBe(3);
    expect(stats.failRatio).toBe(0);
    expect(stats.latencyP50Ms).toBe(200);
    expect(registry.isCircuitOpen(model)).toBe(false);
  });

  it('evaluates circuit opening after minimum throughput and failure ratio exceeded', () => {
    const registry = ModelHealthRegistry.getInstance();
    const model = 'failing-model';

    for (let i = 0; i < 5; i++) {
      registry.recordSuccess(model, 50, 'test-fam');
    }
    for (let i = 0; i < 5; i++) {
      registry.recordFailure(model, new ServerError('500 Server Error'), 'test-fam');
    }

    expect(registry.isCircuitOpen(model)).toBe(true);
  });

  it('escalates circuit opening to family when 2 distinct models fail with 5xx/Network errors', () => {
    const registry = ModelHealthRegistry.getInstance();
    const modelA = 'model-a';
    const modelB = 'model-b';
    const family = 'test-escalation-family';

    registry.recordFailure(modelA, new ServerError('500 Server Error'), family);
    registry.recordFailure(modelB, new ServerError('502 Bad Gateway'), family);

    expect(registry.isCircuitOpen(family)).toBe(true);
    expect(registry.isCircuitOpen(modelA)).toBe(true);
  });

  it('supports single-flight HALF_OPEN probe mode', () => {
    const registry = ModelHealthRegistry.getInstance();
    const model = 'probe-model';

    for (let i = 0; i < 10; i++) {
      registry.recordFailure(model, new Error('Error'), 'test-fam');
    }
    expect(registry.isCircuitOpen(model)).toBe(true);

    const originalNow = Date.now;
    const futureTime = originalNow() + 35000;
    jest.spyOn(Date, 'now').mockReturnValue(futureTime);

    try {
      expect(registry.tryAcquireHalfOpenProbe(model)).toBe(true);

      expect(registry.isCircuitOpen(model)).toBe(true);
      expect(registry.tryAcquireHalfOpenProbe(model)).toBe(false);

      registry.recordSuccess(model, 50, 'test-fam');
      expect(registry.isCircuitOpen(model)).toBe(false);
    } finally {
      jest.spyOn(Date, 'now').mockRestore();
    }
  });

  it('sorts candidates by composite preference score', () => {
    const registry = ModelHealthRegistry.getInstance();
    const modelA = 'model-fast';
    const modelB = 'model-slow';

    registry.recordSuccess(modelA, 50, 'fam');
    registry.recordSuccess(modelB, 500, 'fam');

    const sorted = registry.sortByPreference([modelB, modelA]);
    expect(sorted).toEqual([modelA, modelB]);
  });
});

describe('Layer 1 - CredentialProvider', () => {
  beforeEach(() => {
    CredentialProvider.resetInstance();
  });

  it('obtains instance and manages credentials cleanly', async () => {
    const provider = CredentialProvider.getInstance();
    expect(provider).toBeDefined();

    await provider.recordQuotaExceeded('test-model', 1);
  });
});

describe('Layer 1 - ServiceRegistry', () => {
  beforeEach(() => {
    ServiceRegistry.resetInstance();
  });

  it('loads service recipes from services_config.json', () => {
    const registry = ServiceRegistry.getInstance();
    const recipe = registry.getRecipe('EXECUTOR');

    expect(recipe).toBeDefined();
    expect(recipe.models.length).toBeGreaterThan(0);
    expect(recipe.timeoutMs).toBeGreaterThan(0);
  });

  it('returns default fallback recipe for unknown service', () => {
    const registry = ServiceRegistry.getInstance();
    const recipe = registry.getRecipe('UNKNOWN_SERVICE_ABC');

    expect(recipe).toBeDefined();
    expect(recipe.models.length).toBeGreaterThan(0);
  });
});

describe('Layer 1 - SmartLayer', () => {
  beforeEach(() => {
    SmartLayer.resetInstance();
    ModelHealthRegistry.resetInstance();
    CredentialProvider.resetInstance();
    ServiceRegistry.resetInstance();
  });

  it('executes non-streaming request using resolved candidate chain', async () => {
    const mockExecutionLayer = {
      execute: jest.fn<ExecutionLayer['execute']>().mockResolvedValue({
        content: 'Response from SmartLayer',
      } as unknown as AdapterChatResult),
      executeStream: jest.fn<ExecutionLayer['executeStream']>(),
    };

    const mockCredentialProvider = {
      getKey: jest.fn<CredentialProvider['getKey']>().mockResolvedValue({
        apiKey: 'dummy-api-key',
        keyIndex: 1,
        provider: 'codestral',
      }),
      recordQuotaExceeded: jest.fn<CredentialProvider['recordQuotaExceeded']>(),
    };

    const smart = new SmartLayer(
      ModelHealthRegistry.getInstance(),
      mockCredentialProvider as unknown as CredentialProvider,
      ServiceRegistry.getInstance(),
      mockExecutionLayer as unknown as ExecutionLayer,
    );

    const res = await smart.execute({
      serviceOrCategory: 'EXECUTOR',
      messages: [{ role: 'user', content: 'Test prompt' }],
    });

    expect(res.result.content).toBe('Response from SmartLayer');
    expect(res.attemptsCount).toBe(1);
    expect(mockExecutionLayer.execute).toHaveBeenCalledTimes(1);
  });

  it('enforces SSE streamStarted lock on errors after 1st token chunk', async () => {
    async function* mockStream() {
      yield { content: 'First token chunk' };
      throw new Error('Mid-stream connection drop');
    }

    const mockExecutionLayer = {
      execute: jest.fn<ExecutionLayer['execute']>(),
      executeStream: jest.fn<ExecutionLayer['executeStream']>().mockReturnValue(mockStream()),
    };

    const mockCredentialProvider = {
      getKey: jest.fn<CredentialProvider['getKey']>().mockResolvedValue({
        apiKey: 'dummy-api-key',
        keyIndex: 1,
        provider: 'codestral',
      }),
      recordQuotaExceeded: jest.fn<CredentialProvider['recordQuotaExceeded']>(),
    };

    const smart = new SmartLayer(
      ModelHealthRegistry.getInstance(),
      mockCredentialProvider as unknown as CredentialProvider,
      ServiceRegistry.getInstance(),
      mockExecutionLayer as unknown as ExecutionLayer,
    );

    const chunks: string[] = [];
    let caughtError: Error | null = null;

    try {
      for await (const chunk of smart.executeStream({
        serviceOrCategory: 'EXECUTOR',
        messages: [{ role: 'user', content: 'Stream prompt' }],
      })) {
        if (chunk.content) {
          chunks.push(chunk.content);
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        caughtError = err;
      }
    }

    expect(chunks).toEqual(['First token chunk']);
    expect(caughtError).not.toBeNull();
    expect(caughtError?.message).toBe('Mid-stream connection drop');
    expect(mockExecutionLayer.executeStream).toHaveBeenCalledTimes(1);
  });
});

describe('Layer 1 - SmartLayer (Streaming & Advanced Candidates)', () => {
  beforeEach(() => {
    SmartLayer.resetInstance();
    ModelHealthRegistry.resetInstance();
    CredentialProvider.resetInstance();
    ServiceRegistry.resetInstance();
  });

  it('handles missing credentials and candidate errors in executeStream', async () => {
    const mockExecutionLayer = {
      execute: jest.fn<ExecutionLayer['execute']>(),
      executeStream: jest.fn<ExecutionLayer['executeStream']>().mockImplementation(() => {
        throw new Error('Stream execution initialization failure');
      }),
    };

    let callCount = 0;
    const mockCredentialProvider = {
      getKey: jest.fn<CredentialProvider['getKey']>().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { apiKey: '', keyIndex: 0, provider: 'codestral' };
        }
        return { apiKey: 'valid-key', keyIndex: 1, provider: 'codestral' };
      }),
      recordQuotaExceeded: jest.fn<CredentialProvider['recordQuotaExceeded']>(),
    };

    const smart = new SmartLayer(
      ModelHealthRegistry.getInstance(),
      mockCredentialProvider as unknown as CredentialProvider,
      ServiceRegistry.getInstance(),
      mockExecutionLayer as unknown as ExecutionLayer,
    );

    const stream = smart.executeStream({
      serviceOrCategory: 'EXECUTOR',
      messages: [{ role: 'user', content: 'Stream test' }],
    });

    const chatSpy = jest.spyOn(geminiAdapter, 'chat').mockImplementation(async () => {
      throw new Error('Gemini chat mock error');
    });

    await expect(async () => {
      for await (const chunk of stream) {
        expect(chunk).toBeDefined();
      }
    }).rejects.toThrow();

    chatSpy.mockRestore();
  });

  it('Gemini-native SmartLayer execution forwards tools, normalized parameters, effective tokens, and abort signal', async () => {
    const chatSpy = jest.spyOn(geminiAdapter, 'chat').mockResolvedValueOnce({
      content: 'Mock Gemini response',
      usage: { total_tokens: 10 },
    });

    const mockCredentialProvider = {
      getKey: jest.fn<CredentialProvider['getKey']>().mockResolvedValue({
        apiKey: 'dummy-gemini-key',
        keyIndex: 0,
        provider: 'gemini',
      }),
      recordQuotaExceeded: jest.fn<CredentialProvider['recordQuotaExceeded']>(),
    };

    const smart = new SmartLayer(
      ModelHealthRegistry.getInstance(),
      mockCredentialProvider as unknown as CredentialProvider,
      ServiceRegistry.getInstance(),
      new ExecutionLayer(),
    );

    const abortController = new AbortController();
    const res = await smart.execute(
      {
        modelId: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'Hello gemini' }],
        tools: [
          {
            type: 'function',
            function: {
              name: 'testTool',
              description: 'A test tool',
              parameters: { type: 'object', properties: {} },
            },
          },
        ],
        params: {
          temperature: 0.12,
        },
      },
      {
        effectiveMaxTokens: 12,
        signal: abortController.signal,
      },
    );

    expect(res.result.content).toBe('Mock Gemini response');
    expect(chatSpy).toHaveBeenCalledTimes(1);
    const [, options] = chatSpy.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(options.apiKey).toBe('dummy-gemini-key');
    expect(options.tools).toHaveLength(1);
    expect(options.temperature).toBeCloseTo(0.12);
    expect(options.signal).toBeDefined();
    expect((options.wireParams as Record<string, unknown>).maxOutputTokens).toBe(12);
    chatSpy.mockRestore();
  });

  it('Gemini-native SmartLayer streaming falls back through geminiAdapter.chat and yields chunks', async () => {
    const chatSpy = jest.spyOn(geminiAdapter, 'chat').mockResolvedValueOnce({
      content: 'Streaming fallback content',
      thought: 'Streaming thought',
      toolCalls: [],
      usage: { total_tokens: 5 },
    });

    const mockCredentialProvider = {
      getKey: jest.fn<CredentialProvider['getKey']>().mockResolvedValue({
        apiKey: 'dummy-gemini-key',
        keyIndex: 0,
        provider: 'gemini',
      }),
      recordQuotaExceeded: jest.fn<CredentialProvider['recordQuotaExceeded']>(),
    };

    const smart = new SmartLayer(
      ModelHealthRegistry.getInstance(),
      mockCredentialProvider as unknown as CredentialProvider,
      ServiceRegistry.getInstance(),
      new ExecutionLayer(),
    );

    const chunks = [];
    for await (const chunk of smart.executeStream({
      modelId: 'gemini-2.5-flash',
      messages: [{ role: 'user', content: 'Stream gemini' }],
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('Streaming fallback content');
    expect(chunks[0].usedModel).toBe('gemini-2.5-flash');
    expect(chatSpy).toHaveBeenCalledTimes(1);
    const [, callOptions] = chatSpy.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(callOptions.signal).toBeDefined();
    chatSpy.mockRestore();
  });

  it('records quota exceeded when execute throws RateLimitError', async () => {
    const chatSpy = jest
      .spyOn(geminiAdapter, 'chat')
      .mockRejectedValueOnce(new RateLimitError('Quota exceeded'));

    const recordQuotaSpy = jest.fn<CredentialProvider['recordQuotaExceeded']>();
    const mockCredentialProvider = {
      getKey: jest.fn<CredentialProvider['getKey']>().mockResolvedValue({
        apiKey: 'dummy-gemini-key',
        keyIndex: 2,
        provider: 'gemini',
      }),
      recordQuotaExceeded: recordQuotaSpy,
    };

    const smart = new SmartLayer(
      ModelHealthRegistry.getInstance(),
      mockCredentialProvider as unknown as CredentialProvider,
      ServiceRegistry.getInstance(),
      new ExecutionLayer(),
    );

    await expect(
      smart.execute({
        modelId: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'test rate limit' }],
      }),
    ).rejects.toThrow('Quota exceeded');

    expect(recordQuotaSpy).toHaveBeenCalledWith('gemini-2.5-flash', 2);
    chatSpy.mockRestore();
  });
});

describe('Layer 1 - SmartLayer (Cancellation & Timeouts)', () => {
  beforeEach(() => {
    SmartLayer.resetInstance();
    ModelHealthRegistry.resetInstance();
    CredentialProvider.resetInstance();
    ServiceRegistry.resetInstance();
  });

  it('Gemini-native SmartLayer streaming propagates abort signal and respects cancellation', async () => {
    const abortController = new AbortController();
    abortController.abort();

    const chatSpy = jest.spyOn(geminiAdapter, 'chat').mockImplementation(async (_msgs, opts) => {
      if (opts.signal?.aborted) {
        throw new Error('This operation was aborted');
      }
      return { content: 'Should not reach here' };
    });

    const mockCredentialProvider = {
      getKey: jest.fn<CredentialProvider['getKey']>().mockResolvedValue({
        apiKey: 'dummy-gemini-key',
        keyIndex: 0,
        provider: 'gemini',
      }),
      recordQuotaExceeded: jest.fn<CredentialProvider['recordQuotaExceeded']>(),
    };

    const smart = new SmartLayer(
      ModelHealthRegistry.getInstance(),
      mockCredentialProvider as unknown as CredentialProvider,
      ServiceRegistry.getInstance(),
      new ExecutionLayer(),
    );

    const stream = smart.executeStream(
      {
        modelId: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'Stream cancel' }],
      },
      { signal: abortController.signal },
    );

    await expect(async () => {
      for await (const chunk of stream) {
        expect(chunk).toBeDefined();
      }
    }).rejects.toThrow('This operation was aborted');

    chatSpy.mockRestore();
  });

  it('Gemini-native SmartLayer streaming attaches listener and yields chunks when signal is not aborted', async () => {
    const abortController = new AbortController();

    const chatSpy = jest.spyOn(geminiAdapter, 'chat').mockResolvedValueOnce({
      content: 'stream chunk result',
      thought: 'gemini thought',
    });

    const mockCredentialProvider = {
      getKey: jest.fn<CredentialProvider['getKey']>().mockResolvedValue({
        apiKey: 'dummy-gemini-key',
        keyIndex: 0,
        provider: 'gemini',
      }),
      recordQuotaExceeded: jest.fn<CredentialProvider['recordQuotaExceeded']>(),
    };

    const smart = new SmartLayer(
      ModelHealthRegistry.getInstance(),
      mockCredentialProvider as unknown as CredentialProvider,
      ServiceRegistry.getInstance(),
      new ExecutionLayer(),
    );

    const stream = smart.executeStream(
      {
        modelId: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: 'Stream live' }],
      },
      { signal: abortController.signal },
    );

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('stream chunk result');
    expect(chunks[0].thought).toBe('gemini thought');
    expect(chunks[0].done).toBe(true);

    chatSpy.mockRestore();
  });
});

const makeSmartLayer = (creds: Partial<CredentialProvider>, exec: Partial<ExecutionLayer> = {}) =>
  new SmartLayer(
    ModelHealthRegistry.getInstance(),
    creds as unknown as CredentialProvider,
    ServiceRegistry.getInstance(),
    exec as unknown as ExecutionLayer,
  );

describe('Layer 1 - SmartLayer (Candidate Credential Fallback & Stream Errors)', () => {
  beforeEach(() => {
    SmartLayer.resetInstance();
    ModelHealthRegistry.resetInstance();
    CredentialProvider.resetInstance();
    ServiceRegistry.resetInstance();
  });

  it('execute skips models without valid apiKey and advances candidate chain', async () => {
    let callCount = 0;
    const getKeyMock = jest.fn<CredentialProvider['getKey']>().mockImplementation(async () => {
      callCount++;
      return {
        apiKey: callCount === 1 ? '' : 'valid-key',
        keyIndex: callCount,
        provider: 'codestral',
      };
    });

    const chatSpy = jest.spyOn(geminiAdapter, 'chat').mockResolvedValueOnce({
      content: 'success-after-skip',
    });

    const smart = makeSmartLayer(
      {
        getKey: getKeyMock,
        recordQuotaExceeded: jest.fn<CredentialProvider['recordQuotaExceeded']>(),
      },
      {
        execute: jest.fn<ExecutionLayer['execute']>().mockResolvedValue({
          content: 'success-after-skip',
        } as unknown as AdapterChatResult),
      },
    );

    const result = await smart.execute({
      serviceOrCategory: 'EXECUTOR',
      messages: [{ role: 'user', content: 'test' }],
    });
    expect(result.result.content).toBe('success-after-skip');
    expect(callCount).toBeGreaterThanOrEqual(2);

    chatSpy.mockRestore();
  });

  it('records quota exceeded when streamAttempt encounters RateLimitError before stream starts', async () => {
    const recordQuotaMock = jest.fn<CredentialProvider['recordQuotaExceeded']>();
    const chatSpy = jest
      .spyOn(geminiAdapter, 'chat')
      .mockRejectedValue(new RateLimitError('quota exceeded'));

    const smart = makeSmartLayer(
      {
        getKey: jest.fn<CredentialProvider['getKey']>().mockResolvedValue({
          apiKey: 'valid-key',
          keyIndex: 3,
          provider: 'codestral',
        }),
        recordQuotaExceeded: recordQuotaMock,
      },
      {
        executeStream: jest.fn<ExecutionLayer['executeStream']>().mockImplementation(() => {
          throw new RateLimitError('quota exceeded');
        }),
      },
    );

    const stream = smart.executeStream({
      serviceOrCategory: 'EXECUTOR',
      messages: [{ role: 'user', content: 'rate limit test' }],
    });

    await expect(async () => {
      for await (const chunk of stream) {
        expect(chunk).toBeDefined();
      }
    }).rejects.toThrow('quota exceeded');

    expect(recordQuotaMock).toHaveBeenCalled();
    chatSpy.mockRestore();
  });

  it('execute does not retry next candidates when caller signal is aborted', async () => {
    const abortController = new AbortController();
    const abortErr = new Error('The user aborted a request.');
    abortErr.name = 'AbortError';

    let calls = 0;
    const smart = makeSmartLayer(
      {
        getKey: jest.fn<CredentialProvider['getKey']>().mockImplementation(async () => {
          calls++;
          return { apiKey: 'key', keyIndex: 0, provider: 'codestral' };
        }),
        recordQuotaExceeded: jest.fn<CredentialProvider['recordQuotaExceeded']>(),
      },
      {
        execute: jest.fn<ExecutionLayer['execute']>().mockImplementation(async () => {
          abortController.abort();
          throw abortErr;
        }),
      },
    );

    await expect(
      smart.execute(
        { serviceOrCategory: 'EXECUTOR', messages: [{ role: 'user', content: 'test' }] },
        { signal: abortController.signal },
      ),
    ).rejects.toThrow('The user aborted a request.');

    expect(calls).toBe(1);
  });
});
