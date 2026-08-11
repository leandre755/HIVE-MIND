// tests/unit/services/MemoryDecay.test.ts
import { describe, it, beforeEach, beforeAll, jest, expect } from '@jest/globals';

// Set dummy env vars for Supabase and Redis BEFORE any imports
process.env.SUPABASE_URL = 'http://localhost:54321';
process.env.SUPABASE_KEY = 'dummy-key';
process.env.REDIS_URL = 'redis://localhost:6379';

type MemoryDecayModule = typeof import('../../../services/memory/MemoryDecay.js');
type SupabaseModule = typeof import('../../../services/supabase.js');
type ProviderModule = typeof import('../../../providers/index.js');

let memoryDecay: MemoryDecayModule['memoryDecay'];
let supabase: SupabaseModule['supabase'];
let providerRouter: ProviderModule['providerRouter'];
let db: SupabaseModule['default'];

type SupabaseQueryBuilder = ReturnType<NonNullable<SupabaseModule['supabase']>['from']>;

interface QueryBuilder {
  data: unknown;
  error: unknown;
  select: () => QueryBuilder;
  eq: () => QueryBuilder;
  is: () => QueryBuilder;
  gte: () => QueryBuilder;
  insert: () => Promise<{ error: unknown }>;
  update: () => QueryBuilder;
  execute: (resolveFn: (value: { data: unknown; error: unknown }) => void) => Promise<void>;
}

const createQueryBuilderMock = (data: unknown): QueryBuilder => {
  const builder: QueryBuilder = {
    data,
    error: null,
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    gte: () => builder,
    insert: () => Promise.resolve({ error: null }),
    update: () => builder,
    execute: (resolveFn: (value: { data: unknown; error: unknown }) => void) =>
      Promise.resolve(resolveFn({ data, error: null })),
  };
  return builder;
};

describe('MemoryDecay unit tests', () => {
  beforeAll(async () => {
    // Import redis client and mock connect immediately
    const redisModule = await import('../../../services/redisClient.js');
    jest
      .spyOn(redisModule.redis as { connect: () => Promise<unknown> }, 'connect')
      .mockImplementation(async () => redisModule.redis);

    // Import the services
    const mdModule = await import('../../../services/memory/MemoryDecay.js');
    memoryDecay = mdModule.memoryDecay;

    const supabaseModule = await import('../../../services/supabase.js');
    supabase = supabaseModule.supabase;
    db = supabaseModule.default;

    const providersModule = await import('../../../providers/index.js');
    providerRouter = providersModule.providerRouter;
  });

  beforeEach(() => {
    jest.restoreAllMocks();

    // Default resolveContext mock
    if (db) {
      jest.spyOn(db, 'resolveContextFromLegacyId').mockImplementation(async () => ({
        context_id: 'chat_123',
        type: 'group',
      }));
    }
  });

  it('should decay active memories and update decay score and archived_at when keep is false', async () => {
    // Set created_at to 5 days ago to guarantee decay
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const mockMemories = [
      {
        id: '1',
        role: 'assistant',
        content: 'Memory 1',
        recall_count: 0,
        decay_score: 1.0,
        created_at: fiveDaysAgo,
      },
      {
        id: '2',
        role: 'assistant',
        content: 'Memory 2',
        recall_count: 1,
        decay_score: 0.8,
        created_at: fiveDaysAgo,
      },
    ];

    const supabaseSpy = jest
      .spyOn(supabase!, 'from')
      .mockImplementation(
        (_table: string) => createQueryBuilderMock(mockMemories) as unknown as SupabaseQueryBuilder,
      );

    const result = await memoryDecay.decay('chat_123');

    expect(supabaseSpy).toHaveBeenCalledWith('memories');
    expect(result.archived).toBe(2);
    expect(result.kept).toBe(0);
  });

  it('should trigger consolidation when 5 or more memories are archived', async () => {
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const mockMemories = Array.from({ length: 6 }, (_, i) => ({
      id: `${i}`,
      role: 'assistant',
      content: `Memory ${i}`,
      recall_count: 0,
      decay_score: 1.0,
      created_at: fiveDaysAgo,
    }));

    jest
      .spyOn(supabase!, 'from')
      .mockImplementation(
        (_table: string) => createQueryBuilderMock(mockMemories) as unknown as SupabaseQueryBuilder,
      );

    // Mock providerRouter.chat for consolidation
    const chatMock = jest.spyOn(providerRouter, 'chat').mockImplementation(async () => {
      return { content: 'This is a consolidated gist.' };
    });

    const result = await memoryDecay.decay('chat_123');

    expect(result.archived).toBe(6);

    // Allow the setImmediate consolidation callback to run
    await new Promise((resolve) => setImmediate(resolve));

    expect(chatMock).toHaveBeenCalled();
  });
});
