import { jest, describe, beforeEach, it, expect } from '@jest/globals';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import {
  safeMkdirSync,
  safeWriteFileSync,
  safeRemoveDirectorySync,
} from '../../../utils/safeFs.js';

// Mock imports
jest.unstable_mockModule('../../../providers/index.js', () => ({
  providerRouter: {
    callServiceRecipe: jest.fn(),
  },
}));

const { AIRuntimeInfrastructure } =
  await import('../../../services/runtime/RuntimeInfrastructure.js');
const { providerRouter } = await import('../../../providers/index.js');

function withPricingConfig(
  content: string,
  fn: (runtime: InstanceType<typeof AIRuntimeInfrastructure>) => void,
): void {
  const tempDir = join(tmpdir(), `finops-pricing-${randomUUID()}`);
  safeMkdirSync(tempDir, { recursive: true });
  const pricingPath = join(tempDir, 'pricing.json');
  safeWriteFileSync(pricingPath, content);
  const prevPricing = process.env.HIVE_CONFIG_PRICING_JSON;
  process.env.HIVE_CONFIG_PRICING_JSON = pricingPath;

  try {
    const customRuntime = new AIRuntimeInfrastructure(50.0);
    fn(customRuntime);
  } finally {
    if (prevPricing !== undefined) {
      Reflect.set(process.env, 'HIVE_CONFIG_PRICING_JSON', prevPricing);
    } else {
      Reflect.deleteProperty(process.env, 'HIVE_CONFIG_PRICING_JSON');
    }
    try {
      safeRemoveDirectorySync(tempDir);
    } catch {
      /* ignore */
    }
  }
}

describe('AIRuntimeInfrastructure', () => {
  let runtime: InstanceType<typeof AIRuntimeInfrastructure>;

  beforeEach(() => {
    jest.clearAllMocks();
    runtime = new AIRuntimeInfrastructure(1.0); // max budget $1.0
  });

  describe('RuntimeFinOps', () => {
    it('should correctly initialize budget and track usage', () => {
      const usage = runtime.finOps.recordUsage('gemini/gemini-2.5-flash', 1000000, 1000000); // 1M tokens each
      expect(usage.totalCost).toBeGreaterThan(0);
      expect(runtime.finOps.getSessionCost()).toBe(usage.totalCost);
    });

    it('should trigger kill switch when budget is exceeded', () => {
      const usage = runtime.finOps.recordUsage('gemini/gemini-2.5-flash', 50000000, 50000000); // 50M tokens each
      expect(usage.budgetSafe).toBe(false);
    });

    it('should calculate Lagrangian KKT lambda correctly based on budget depletion', () => {
      // Initially 0 cost, lambda should be 0
      expect(runtime.finOps.calculateLambda()).toBe(0);

      // Record some usage: let's record enough to consume 50% of the budget ($0.50)
      const finOpsInternals = runtime.finOps as unknown as { currentSessionCost: number };
      finOpsInternals.currentSessionCost = 0.5; // budget is 1.0

      // At 50% usage: (0.5)^4 = 0.0625
      expect(runtime.finOps.calculateLambda()).toBeCloseTo(0.0625, 4);

      // At 100% usage: (1.0)^4 = 1.0
      finOpsInternals.currentSessionCost = 1.0;
      expect(runtime.finOps.calculateLambda()).toBe(1.0);

      // Beyond 100% usage, lambda is capped at 1.0
      finOpsInternals.currentSessionCost = 2.0;
      expect(runtime.finOps.calculateLambda()).toBe(1.0);
    });

    it('should load custom model pricing resolved via resolveConfigPath', () => {
      const customPricing = {
        default: { input: 1.0, output: 2.0 },
        models: {
          'custom/benchmark-model': { input: 5.0, output: 10.0 },
        },
      };
      withPricingConfig(JSON.stringify(customPricing), (customRuntime) => {
        const usage = customRuntime.finOps.recordUsage(
          'custom/benchmark-model',
          1_000_000,
          1_000_000,
        );
        expect(usage.inputCost).toBeCloseTo(5.0, 4);
        expect(usage.outputCost).toBeCloseTo(10.0, 4);
        expect(usage.totalCost).toBeCloseTo(15.0, 4);
      });
    });

    it('should fallback to default pricing when pricing.json is corrupted or unreadable', () => {
      withPricingConfig('{ broken: json', (fallbackRuntime) => {
        const usage = fallbackRuntime.finOps.recordUsage('unlisted/model', 1_000_000, 1_000_000);
        expect(usage.inputCost).toBeCloseTo(0.15, 4);
        expect(usage.outputCost).toBeCloseTo(0.6, 4);
        expect(usage.totalCost).toBeCloseTo(0.75, 4);
      });
    });

    it('should fallback to default pricing when pricing.json is null', () => {
      withPricingConfig('null', (nullRuntime) => {
        const usage = nullRuntime.finOps.recordUsage('unlisted/model', 1_000_000, 1_000_000);
        expect(usage.inputCost).toBeCloseTo(0.15, 4);
        expect(usage.outputCost).toBeCloseTo(0.6, 4);
        expect(usage.totalCost).toBeCloseTo(0.75, 4);
      });
    });

    it('should fallback to default pricing when pricing.json has invalid shape or missing models', () => {
      withPricingConfig(JSON.stringify({ p: 1 }), (invalidRuntime) => {
        const usage = invalidRuntime.finOps.recordUsage('unlisted/model', 1_000_000, 1_000_000);
        expect(usage.inputCost).toBeCloseTo(0.15, 4);
        expect(usage.outputCost).toBeCloseTo(0.6, 4);
        expect(usage.totalCost).toBeCloseTo(0.75, 4);
      });
    });

    it('should fallback to default pricing when pricing rates are negative or non-finite', () => {
      withPricingConfig(
        JSON.stringify({
          default: { input: -0.15, output: 0.6 },
          models: {},
        }),
        (negativeRuntime) => {
          const usage = negativeRuntime.finOps.recordUsage('unlisted/model', 1_000_000, 1_000_000);
          expect(usage.inputCost).toBeCloseTo(0.15, 4);
          expect(usage.outputCost).toBeCloseTo(0.6, 4);
          expect(usage.totalCost).toBeCloseTo(0.75, 4);
        },
      );
    });
  });

  describe('RuntimeSentinel', () => {
    it('should allow safe tools automatically without LLM evaluation', async () => {
      const result = await runtime.sentinel.evaluate(
        { function: { name: 'list_directory', arguments: '{}' } },
        { authorityLevel: 'User', senderName: 'Jean' },
        [],
      );
      expect(result.allowed).toBe(true);
      expect(result.risk_level).toBe('low');
    });

    it('should allow admin actions automatically', async () => {
      const result = await runtime.sentinel.evaluate(
        { function: { name: 'execute_bash_command', arguments: '{"command":"ls"}' } },
        { authorityLevel: 'Global Admin', senderName: 'Jean' },
        [],
      );
      expect(result.allowed).toBe(true);
      expect(result.risk_level).toBe('low');
    });

    it('should query LLM safety recipe for potentially risky actions', async () => {
      (
        providerRouter.callServiceRecipe as jest.MockedFunction<
          typeof providerRouter.callServiceRecipe
        >
      ).mockResolvedValueOnce({
        content: JSON.stringify({
          allowed: false,
          risk_level: 'high',
          reason: 'Unsafe command execution',
          intervention_prompt: 'Use read_file instead',
        }),
      });

      const result = await runtime.sentinel.evaluate(
        { function: { name: 'execute_bash_command', arguments: '{"command":"rm -rf /"}' } },
        { authorityLevel: 'User', senderName: 'Jean' },
        [],
      );

      expect(result.allowed).toBe(false);
      expect(result.risk_level).toBe('high');
      expect(result.reason).toContain('Unsafe command execution');
    });
  });

  describe('RalphController', () => {
    it('should flag laziness and provide kickback instructions if agentic laziness is detected', async () => {
      (
        providerRouter.callServiceRecipe as jest.MockedFunction<
          typeof providerRouter.callServiceRecipe
        >
      ).mockResolvedValueOnce({
        content: JSON.stringify({
          is_complete: false,
          laziness_detected: true,
          kickback_message: 'Please complete the remaining code.',
        }),
      });

      const result = await runtime.ralph.verifyCompletion(
        'Implement auth flow',
        'Here is the plan, you can implement the rest.',
      );
      expect(result.is_complete).toBe(false);
      expect(result.laziness_detected).toBe(true);
      expect(result.kickback_message).toBe('Please complete the remaining code.');
    });
  });
});
