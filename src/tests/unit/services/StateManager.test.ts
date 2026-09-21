import { jest, describe, beforeEach, it, expect } from '@jest/globals';

const mockHGetAll = jest.fn<(...args: unknown[]) => Promise<Record<string, string> | null>>();
const mockHSet = jest.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(1);
const mockExpire = jest.fn<(...args: unknown[]) => Promise<number>>().mockResolvedValue(1);

jest.unstable_mockModule('../../../services/redisClient.js', () => ({
  redis: {
    hGetAll: mockHGetAll,
    hSet: mockHSet,
    expire: mockExpire,
  },
  default: {},
}));

const mockSingle = jest.fn<() => Promise<{ data: unknown; error: unknown }>>();
const mockEq = jest.fn().mockReturnValue({ single: mockSingle });
const mockSelect = jest.fn().mockReturnValue({ eq: mockEq });
const mockFrom = jest.fn().mockReturnValue({ select: mockSelect });

const mockResolveContext = jest
  .fn<(...args: unknown[]) => Promise<{ type: string; context_id: string }>>()
  .mockResolvedValue({
    type: 'user',
    context_id: 'user-uuid-123',
  });

jest.unstable_mockModule('../../../services/supabase.js', () => ({
  supabase: {
    from: mockFrom,
  },
  default: {
    from: mockFrom,
    resolveContextFromLegacyId: mockResolveContext,
  },
}));

const mockResolve = jest.fn<(...args: unknown[]) => Promise<string>>();
jest.unstable_mockModule('../../../services/state/IdentityMap.js', () => ({
  IdentityMap: {
    resolve: mockResolve,
  },
}));

describe('StateManager (SS-12: Distributed State Manager)', () => {
  let StateManager: typeof import('../../../services/state/StateManager.js').StateManager;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockResolve.mockResolvedValue('33612345678@s.whatsapp.net');
    mockResolveContext.mockResolvedValue({ type: 'user', context_id: 'user-uuid-123' });
    const mod = await import('../../../services/state/StateManager.js');
    StateManager = mod.StateManager;
  });

  it('hydrates from DB when Redis cache is partial (missing created_at) and preserves interaction_count', async () => {
    // Redis cache has interaction_count but lacks created_at
    mockHGetAll.mockResolvedValue({ interaction_count: '5' });

    mockSingle.mockResolvedValueOnce({
      data: {
        id: 'user-uuid-123',
        names: ['Alice'],
        created_at: '2026-01-01T00:00:00Z',
        interaction_count: 2,
      },
      error: null,
    });

    const state = await StateManager.getUser('33612345678@s.whatsapp.net');

    expect(state.id).toBe('user-uuid-123');
    // interaction_count in cache (5) should be preserved over DB value (2)
    expect(state.interaction_count).toBe(5);
    expect(mockHSet).toHaveBeenCalled();
  });
});
