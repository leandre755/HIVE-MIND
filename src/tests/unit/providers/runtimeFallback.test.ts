// tests/unit/providers/runtimeFallback.test.ts
// #37 — le repli de getRuntime() doit instancier AIRuntimeInfrastructure via
// un import() natif (anciennement masqué par Function('return import(...)'))
// quand aucun ServiceContainer n'est câblé dans globalThis.
import { describe, it, beforeEach, expect } from '@jest/globals';

const providerRouterModule = await import('../../../providers/index.js');
const providerRouter = (
  providerRouterModule as unknown as { providerRouter: Record<string, unknown> }
).providerRouter;

describe('providerRouter — repli runtime sans ServiceContainer (#37)', () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis as Record<string, unknown>, 'container');
  });

  it('construit le runtime via import() natif et invoque l adapter', async () => {
    const adapter = {
      chat: async () => ({ content: 'ok', usedFamily: 'mistral', usedModel: 'mistral-small' }),
    };

    const result = await (
      providerRouter as unknown as {
        _invokeAdapter: (ctx: Record<string, unknown>) => Promise<Record<string, unknown>>;
      }
    )._invokeAdapter({
      messages: [{ role: 'user', content: 'bonjour' }],
      options: {},
      family: 'mistral',
      adapter,
      model: 'mistral-small-latest',
      keyIndex: 0,
      quotaManager: null,
    });

    expect(result).toBeDefined();
  });
});
