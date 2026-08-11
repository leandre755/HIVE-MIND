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
import { ServerError } from '../../../providers/layer0/errors.js';
import type { AdapterChatResult } from '../../../providers/types.js';

describe('Layer 1 - ModelHealthRegistry', () => {
  beforeEach(() => {
    ModelHealthRegistry.resetInstance();
  });

  it('exports required constants correctly', () => {
    expect(WINDOW_MS).toBe(60000);
    expect(BUCKET_COUNT).toBe(6);
    expect(FAILURE_RATIO_THRESHOLD).toBe(0.5);
    expect(MINIMUM_THROUGHPUT).toBe(10);
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
