import { describe, it, beforeEach, afterEach, jest, expect } from '@jest/globals';
import { GLOBAL_CONTEXT_ID } from '../../../services/memory/constants.js';

type ResolvedContext = { context_id: string; type: 'user' | 'group' };
type ChainCalls = Array<{ method: string; args: unknown[] }>;

const mockResolveContextFromLegacyId =
  jest.fn<(legacyId: string) => Promise<ResolvedContext | null>>();
const mockFrom = jest.fn<(table: string) => unknown>();
const mockRpc =
  jest.fn<
    (fn: string, params: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
  >();

jest.unstable_mockModule('../../../services/tagService.js', () => ({
  tagService: {
    generateTags: jest.fn<(content: string) => Promise<string[]>>().mockResolvedValue(['tag']),
  },
}));

jest.unstable_mockModule('../../../services/supabase.js', () => ({
  supabase: {
    from: mockFrom,
    rpc: mockRpc,
  },
  db: {
    resolveContextFromLegacyId: mockResolveContextFromLegacyId,
  },
}));

type MemoryModule = typeof import('../../../services/memory.js');

function installQueryMock(resolver: (calls: ChainCalls) => unknown): ChainCalls[] {
  const chains: ChainCalls[] = [];
  mockFrom.mockImplementation((table: string) => {
    const calls: ChainCalls = [{ method: 'from', args: [table] }];
    chains.push(calls);
    const proxy = new Proxy({} as Record<string, unknown>, {
      get(_target: object, prop: string | symbol): unknown {
        if (prop === 'then') {
          return (
            onFulfilled?: ((value: unknown) => unknown) | null,
            onRejected?: ((reason: unknown) => unknown) | null,
          ): Promise<unknown> => Promise.resolve(resolver(calls)).then(onFulfilled, onRejected);
        }
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args });
          return proxy;
        };
      },
    });
    return proxy;
  });
  return chains;
}

const eqCallsOf = (chains: ChainCalls[]): Array<[string, unknown]> =>
  chains.flatMap((chain) =>
    chain
      .filter((c) => c.method === 'eq')
      .map((c): [string, unknown] => [c.args[0] as string, c.args[1]]),
  );

function useEmbeddings(
  embed: ((text: string, taskType?: string) => Promise<number[] | null>) | null,
) {
  (globalThis as { container?: unknown }).container = {
    has: () => embed !== null,
    get: () => ({ embed }),
  };
}

let semanticMemory: MemoryModule['semanticMemory'];
let factsMemory: MemoryModule['factsMemory'];
const originalContainer = (globalThis as { container?: unknown }).container;

beforeEach(async () => {
  jest.resetModules();
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const mod: MemoryModule = await import('../../../services/memory.js');
  semanticMemory = mod.semanticMemory;
  factsMemory = mod.factsMemory;
});

afterEach(() => {
  (globalThis as { container?: unknown }).container = originalContainer;
  jest.restoreAllMocks();
});

describe('semanticMemory - alignement context_id', () => {
  it('recall : fallback temporel filtré sur context_id résolu sans embeddings', async () => {
    const chains = installQueryMock(() => ({ data: [{ content: 'a', role: 'user' }] }));
    mockResolveContextFromLegacyId.mockResolvedValueOnce({ context_id: 'uuid-1', type: 'user' });
    useEmbeddings(null);

    const result = await semanticMemory.recall('123@s.whatsapp.net', 'requête', 5);

    expect(mockResolveContextFromLegacyId).toHaveBeenCalledWith('123@s.whatsapp.net');
    expect(eqCallsOf(chains)).toContainEqual(['context_id', 'uuid-1']);
    expect(result).toHaveLength(1);
  });

  it('recall : fallback temporel sur context_id quand la génération du vecteur échoue', async () => {
    const chains = installQueryMock(() => ({ data: [] }));
    mockResolveContextFromLegacyId.mockResolvedValueOnce({ context_id: 'uuid-2', type: 'user' });
    useEmbeddings(async () => null);

    await semanticMemory.recall('123@s.whatsapp.net', 'requête', 5);

    expect(eqCallsOf(chains)).toContainEqual(['context_id', 'uuid-2']);
  });

  it('recall : rappel local puis global via GLOBAL_CONTEXT_ID', async () => {
    mockResolveContextFromLegacyId.mockResolvedValueOnce({ context_id: 'uuid-3', type: 'user' });
    useEmbeddings(async () => [0.1, 0.2]);
    mockRpc.mockImplementation(async (_fn, params) => {
      if (params.match_context_id === 'uuid-3') {
        return {
          data: [{ id: '1', content: 'privé', role: 'user', created_at: new Date().toISOString() }],
          error: null,
        };
      }
      return {
        data: [
          { id: '2', content: 'global', role: 'system', created_at: new Date().toISOString() },
        ],
        error: null,
      };
    });

    const result = await semanticMemory.recall('123@s.whatsapp.net', 'requête', 5);

    expect(mockRpc).toHaveBeenCalledWith(
      'match_memories',
      expect.objectContaining({ match_context_id: 'uuid-3' }),
    );
    expect(mockRpc).toHaveBeenCalledWith(
      'match_memories',
      expect.objectContaining({ match_context_id: GLOBAL_CONTEXT_ID }),
    );
    expect(result).toHaveLength(2);
  });

  it('recall : le rappel global reste joignable quand la résolution de contexte échoue', async () => {
    mockResolveContextFromLegacyId.mockRejectedValueOnce(new Error('base indisponible'));
    useEmbeddings(async () => [0.1, 0.2]);
    mockRpc.mockResolvedValueOnce({
      data: [{ id: '2', content: 'global', role: 'system', created_at: new Date().toISOString() }],
      error: null,
    });

    const result = await semanticMemory.recall('123@s.whatsapp.net', 'requête', 5);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith(
      'match_memories',
      expect.objectContaining({ match_context_id: GLOBAL_CONTEXT_ID }),
    );
    expect(result).toHaveLength(1);
  });

  it('recall : vide quand le contexte est introuvable et les embeddings indisponibles', async () => {
    const chains = installQueryMock(() => ({ data: [] }));
    mockResolveContextFromLegacyId.mockResolvedValueOnce(null);
    useEmbeddings(null);

    const result = await semanticMemory.recall('123@s.whatsapp.net', 'requête', 5);

    expect(result).toEqual([]);
    expect(chains).toHaveLength(0);
  });

  it('recall : survit aux erreurs de rappel local et global', async () => {
    mockResolveContextFromLegacyId.mockResolvedValueOnce({ context_id: 'uuid-4', type: 'user' });
    useEmbeddings(async () => [0.1, 0.2]);
    mockRpc.mockImplementationOnce(async () => ({ data: null, error: new Error('rpc local') }));
    mockRpc.mockRejectedValueOnce(new Error('rpc global'));

    const result = await semanticMemory.recall('123@s.whatsapp.net', 'requête', 5);

    expect(result).toEqual([]);
  });

  it('getRecentContext : filtre sur context_id et retourne le contexte formaté', async () => {
    const chains = installQueryMock(() => ({ data: [{ role: 'user', content: 'salut' }] }));
    mockResolveContextFromLegacyId.mockResolvedValueOnce({ context_id: 'uuid-5', type: 'user' });

    const out = await semanticMemory.getRecentContext('123@s.whatsapp.net', 3);

    expect(eqCallsOf(chains)).toContainEqual(['context_id', 'uuid-5']);
    expect(out).toBe('[user]: salut');
  });

  it('getRecentContext : vide quand le contexte est introuvable', async () => {
    mockResolveContextFromLegacyId.mockResolvedValueOnce(null);

    const out = await semanticMemory.getRecentContext('123@s.whatsapp.net');

    expect(out).toBe('');
  });

  it('summarize : requêtes filtrées sur context_id et sortie franche si trop peu de messages', async () => {
    const chains = installQueryMock((calls) =>
      calls.some((c) => c.method === 'limit') ? { data: [] } : { count: 3 },
    );
    mockResolveContextFromLegacyId.mockResolvedValueOnce({ context_id: 'uuid-6', type: 'user' });

    const res = await semanticMemory.summarize('123@s.whatsapp.net', 50);

    expect(res).toEqual({ success: true, reason: 'Pas assez de messages à résumer' });
    expect(eqCallsOf(chains)).toContainEqual(['context_id', 'uuid-6']);
  });

  it('summarize : pas de résumé IA quand les vieux messages sont trop peu nombreux', async () => {
    const chains = installQueryMock((calls) =>
      calls.some((c) => c.method === 'limit')
        ? {
            data: Array.from({ length: 4 }, (_, i) => ({
              id: String(i),
              content: 'c',
              role: 'user',
              created_at: new Date().toISOString(),
            })),
          }
        : { count: 120 },
    );
    mockResolveContextFromLegacyId.mockResolvedValueOnce({ context_id: 'uuid-7', type: 'user' });

    const res = await semanticMemory.summarize('123@s.whatsapp.net', 50);

    expect(res).toEqual({
      success: true,
      reason: 'Pas assez de messages pour un résumé significatif',
    });
    expect(eqCallsOf(chains)).toEqual([
      ['context_id', 'uuid-7'],
      ['context_id', 'uuid-7'],
    ]);
  });

  it('cleanup : garde les derniers et supprime le reste via context_id', async () => {
    const chains = installQueryMock((calls) =>
      calls.some((c) => c.method === 'delete') ? { error: null } : { data: [{ id: 7 }, { id: 8 }] },
    );
    mockResolveContextFromLegacyId.mockResolvedValueOnce({ context_id: 'uuid-8', type: 'user' });

    await semanticMemory.cleanup('123@s.whatsapp.net', 50);

    const eqs = eqCallsOf(chains);
    expect(eqs).toContainEqual(['context_id', 'uuid-8']);
    expect(eqs.filter(([col]) => col === 'context_id')).toHaveLength(2);
  });

  it('factsMemory : remember et forget utilisent context_id et le conflit (context_id, key)', async () => {
    const chains = installQueryMock(() => ({ error: null, data: null }));
    mockResolveContextFromLegacyId.mockResolvedValueOnce({ context_id: 'uuid-9', type: 'user' });
    mockResolveContextFromLegacyId.mockResolvedValueOnce({ context_id: 'uuid-9', type: 'user' });

    await factsMemory.remember('123@s.whatsapp.net', 'lang', 'fr');
    await factsMemory.forget('123@s.whatsapp.net', 'lang');

    const upsertCall = chains.flat().find((c) => c.method === 'upsert');
    expect(upsertCall?.args[0]).toMatchObject({ context_id: 'uuid-9', key: 'lang', value: 'fr' });
    expect(upsertCall?.args[1]).toEqual({ onConflict: 'context_id,key' });
    expect(eqCallsOf(chains)).toContainEqual(['context_id', 'uuid-9']);
  });

  it('factsMemory : getAll et get filtrent sur context_id', async () => {
    installQueryMock((calls) =>
      calls.some((c) => c.method === 'single')
        ? { data: { value: 'fr' } }
        : { data: [{ key: 'lang', value: 'fr' }] },
    );
    mockResolveContextFromLegacyId.mockResolvedValueOnce({ context_id: 'uuid-10', type: 'user' });
    mockResolveContextFromLegacyId.mockResolvedValueOnce({ context_id: 'uuid-10', type: 'user' });

    const all = await factsMemory.getAll('123@s.whatsapp.net');
    const one = await factsMemory.get('123@s.whatsapp.net', 'lang');

    expect(all).toEqual({ lang: 'fr' });
    expect(one).toBe('fr');
  });

  it('recall : survit au rejet de la promesse de rappel local et exécute le rappel global', async () => {
    mockResolveContextFromLegacyId.mockResolvedValueOnce({ context_id: 'uuid-11', type: 'user' });
    useEmbeddings(async () => [0.1, 0.2]);
    mockRpc.mockRejectedValueOnce(new Error('rejet local'));
    mockRpc.mockResolvedValueOnce({
      data: [{ id: '3', content: 'global', role: 'system', created_at: new Date().toISOString() }],
      error: null,
    });

    const result = await semanticMemory.recall('123@s.whatsapp.net', 'requête', 5);

    expect(result).toHaveLength(1);
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });

  it('gardes contexte introuvable : summarize, cleanup et factsMemory sortent sans requête', async () => {
    installQueryMock(() => ({ data: [], error: null }));
    mockResolveContextFromLegacyId.mockResolvedValue(null);

    const res = await semanticMemory.summarize('123@s.whatsapp.net', 50);
    await semanticMemory.cleanup('123@s.whatsapp.net', 50);
    await factsMemory.remember('123@s.whatsapp.net', 'lang', 'fr');

    expect(res).toEqual({ success: false, reason: 'Contexte introuvable' });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('store : insère le souvenir avec le context_id résolu', async () => {
    const chains = installQueryMock(() => ({ error: null, data: null }));
    mockResolveContextFromLegacyId.mockResolvedValueOnce({ context_id: 'uuid-12', type: 'user' });
    useEmbeddings(async () => [0.1, 0.2]);

    await semanticMemory.store('123@s.whatsapp.net', 'un souvenir', 'user', { msgId: 'm1' });

    const insertCall = chains.flat().find((c) => c.method === 'insert');
    expect(insertCall?.args[0]).toMatchObject({
      context_id: 'uuid-12',
      content: 'un souvenir',
      role: 'user',
    });
  });

  it('store : abandonne l insertion quand le contexte est introuvable', async () => {
    installQueryMock(() => ({ error: null, data: null }));
    mockResolveContextFromLegacyId.mockResolvedValueOnce(null);
    useEmbeddings(async () => [0.1, 0.2]);

    await semanticMemory.store('123@s.whatsapp.net', 'un souvenir', 'user');

    expect(mockFrom).not.toHaveBeenCalled();
  });
});
