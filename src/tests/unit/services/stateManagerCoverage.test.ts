// tests/unit/services/stateManagerCoverage.test.ts
// Issue #112 (Palier 1) + #27 — Couverture unitaire de StateManager :
//  - helpers _flattenForRedis / _unflattenFromRedis / _parseNames (round-trip names JSON)
//  - getUser (cache hit / miss + hydratation / resolved null / lock failure)
//  - updateUserInteraction (pipeline multi), updatePreferences
//  - processSyncQueue (queue vide / batch upsert / rollback), activité de groupe
// Pattern de mock redis/supabase identique à StateManager.test.ts et memory.test.ts
// (jest.unstable_mockModule ESM, chaîne supabase thenable).
import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';

const JID = '33612345678@s.whatsapp.net';
const UUID = 'user-uuid-123';
const CACHE_KEY = `user:${UUID}:data`;
const SYNC_QUEUE_KEY = 'queue:sync:users';

// ── Mock Redis (jest.fn, même pattern que StateManager.test.ts) ──
const mockHGetAll = jest.fn<(...args: unknown[]) => Promise<Record<string, string>>>();
const mockHSet = jest.fn<(...args: unknown[]) => Promise<number>>();
const mockExpire = jest.fn<(...args: unknown[]) => Promise<number>>();
const mockSAdd = jest.fn<(...args: unknown[]) => Promise<number>>();
const mockSPopCount = jest.fn<(...args: unknown[]) => Promise<string[]>>();
const mockZIncrBy = jest.fn<(...args: unknown[]) => Promise<number>>();
const mockZRangeWithScores =
  jest.fn<(...args: unknown[]) => Promise<Array<{ value: string; score: number }>>>();
const mockZScore = jest.fn<(...args: unknown[]) => Promise<number | null>>();
const mockPipelineExec = jest.fn<() => Promise<unknown[]>>();
const mockPipeline = {
  hIncrBy: jest.fn<(...args: unknown[]) => unknown>(),
  hSet: jest.fn<(...args: unknown[]) => unknown>(),
  expire: jest.fn<(...args: unknown[]) => unknown>(),
  sAdd: jest.fn<(...args: unknown[]) => unknown>(),
  hGetAll: jest.fn<(...args: unknown[]) => unknown>(),
  exec: mockPipelineExec,
};
const mockRedis = {
  isOpen: true,
  hGetAll: mockHGetAll,
  hSet: mockHSet,
  expire: mockExpire,
  sAdd: mockSAdd,
  sPopCount: mockSPopCount,
  zIncrBy: mockZIncrBy,
  zRangeWithScores: mockZRangeWithScores,
  zScore: mockZScore,
  multi: jest.fn<() => typeof mockPipeline>(),
};
const installMultiMock = (): void => {
  mockRedis.multi.mockImplementation(() => mockPipeline);
};

jest.unstable_mockModule('../../../services/redisClient.js', () => ({
  redis: mockRedis,
  default: mockRedis,
}));

// ── Mock Supabase : chaîne thenable universelle (pattern memory.test.ts) ──
type ChainCalls = Array<{ method: string; args: unknown[] }>;

const queryChains: ChainCalls[] = [];
let queryResolver: (calls: ChainCalls) => unknown = (_calls: ChainCalls) => ({
  data: null,
  error: null,
});

const mockFrom = jest.fn<(table: string) => unknown>();
const installQueryMock = (): void => {
  mockFrom.mockImplementation((table: string) => {
    const calls: ChainCalls = [{ method: 'from', args: [table] }];
    queryChains.push(calls);
    const proxy = new Proxy({} as Record<string, unknown>, {
      get(_target: object, prop: string | symbol): unknown {
        if (prop === 'then') {
          return (ok?: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
            Promise.resolve(queryResolver(calls)).then(ok, ko);
        }
        return (...args: unknown[]) => {
          calls.push({ method: String(prop), args });
          return proxy;
        };
      },
    });
    return proxy;
  });
};
installQueryMock();

const upsertCalls = (): Array<{ method: string; args: unknown[] }> =>
  queryChains.flat().filter((c) => c.method === 'upsert');

const mockResolveContext = jest
  .fn<(id: string) => Promise<{ type: string; context_id: string } | null>>()
  .mockResolvedValue({ type: 'user', context_id: UUID });
const mockDbClient = { resolveContextFromLegacyId: mockResolveContext };

jest.unstable_mockModule('../../../services/supabase.js', () => ({
  supabase: { from: mockFrom },
  db: mockDbClient,
  default: mockDbClient,
}));

// ── Mock IdentityMap ──
const mockResolve = jest.fn<(...args: unknown[]) => Promise<string>>();
jest.unstable_mockModule('../../../services/state/IdentityMap.js', () => ({
  IdentityMap: { resolve: mockResolve },
}));

// ── Mock LockManager (unité testée séparément dans lockManagerCoverage.test.ts) ──
const mockLockAcquire = jest.fn<(...args: unknown[]) => Promise<string | null>>();
const mockLockAcquireWait = jest.fn<(...args: unknown[]) => Promise<string | null>>();
const mockLockRelease = jest.fn<(...args: unknown[]) => Promise<void>>();
const userLockMock = {
  acquire: mockLockAcquire,
  acquireWait: mockLockAcquireWait,
  release: mockLockRelease,
};
const mockLockCtor = jest.fn<(...args: unknown[]) => unknown>();
mockLockCtor.mockImplementation(() => userLockMock);
jest.unstable_mockModule('../../../services/state/LockManager.js', () => ({
  LockManager: mockLockCtor,
}));

const { StateManager } = await import('../../../services/state/StateManager.js');

let logSpy: ReturnType<typeof jest.spyOn>;
let warnSpy: ReturnType<typeof jest.spyOn>;
let errSpy: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  jest.clearAllMocks();
  installMultiMock();
  installQueryMock();
  queryChains.length = 0;
  queryResolver = () => ({ data: null, error: null });

  mockResolve.mockResolvedValue(JID);
  mockResolveContext.mockResolvedValue({ type: 'user', context_id: UUID });
  mockLockAcquire.mockResolvedValue('lock-1');
  mockLockAcquireWait.mockResolvedValue('lock-1');
  mockLockRelease.mockResolvedValue(undefined);

  mockHGetAll.mockResolvedValue({});
  mockHSet.mockResolvedValue(1);
  mockExpire.mockResolvedValue(1);
  mockSAdd.mockResolvedValue(1);
  mockSPopCount.mockResolvedValue([]);
  mockZIncrBy.mockResolvedValue(1);
  mockZRangeWithScores.mockResolvedValue([]);
  mockZScore.mockResolvedValue(null);
  mockPipelineExec.mockResolvedValue([]);
  mockRedis.isOpen = true;

  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errSpy.mockRestore();
});

describe('StateManager — helpers de sérialisation Redis (issue #27)', () => {
  it('round-trip names : ["Alexandre","Alex"] ressort identique après flatten puis unflatten', () => {
    const flat = StateManager._flattenForRedis({
      names: ['Alexandre', 'Alex'],
      interaction_count: 5,
      last_seen: 123,
    });
    // Les tableaux sont sérialisés en JSON (et non String(v) => "Alexandre,Alex")
    expect(flat.names).toBe('["Alexandre","Alex"]');
    expect(flat.interaction_count).toBe('5');
    expect(flat.last_seen).toBe('123');

    const unflat = StateManager._unflattenFromRedis(flat);
    expect(unflat.names).toEqual(['Alexandre', 'Alex']);
    expect(unflat.interaction_count).toBe(5);
    expect(unflat.last_seen).toBe(123);
  });

  it('_flattenForRedis : objets/tableaux en JSON, scalaires en String, null/undefined ignorés', () => {
    const flat = StateManager._flattenForRedis({
      count: 42,
      ok: true,
      meta: { a: 1 },
      tags: ['x'],
      nothing: null,
      missing: undefined,
    });
    expect(flat).toEqual({
      count: '42',
      ok: 'true',
      meta: '{"a":1}',
      tags: '["x"]',
    });
    expect(Object.hasOwn(flat, 'nothing')).toBe(false);
    expect(Object.hasOwn(flat, 'missing')).toBe(false);
  });

  it('_parseNames : valeurs legacy "Alex,Alexandre" retrouvées en tableau', () => {
    expect(StateManager._parseNames('Alex,Alexandre')).toEqual(['Alex', 'Alexandre']);
    expect(StateManager._parseNames('Alex')).toEqual(['Alex']);
    expect(StateManager._parseNames(' Alexandre , ,Alex,,')).toEqual(['Alexandre', 'Alex']);
  });

  it('_parseNames : JSON invalide -> repli split virgules', () => {
    expect(StateManager._parseNames('[broken json]')).toEqual(['[broken json]']);
  });

  it('_parseNames : noms non-string filtrés du tableau JSON', () => {
    expect(StateManager._parseNames('["Alex",42,null,"Bob",{"x":1}]')).toEqual(['Alex', 'Bob']);
    expect(StateManager._parseNames('[]')).toEqual([]);
  });

  it('_parseNames : JSON valide non-tableau -> string isolée, sinon ["Inconnu"]', () => {
    expect(StateManager._parseNames('"Alexandre"')).toEqual(['Alexandre']);
    expect(StateManager._parseNames('null')).toEqual(['Inconnu']);
    expect(StateManager._parseNames('123')).toEqual(['Inconnu']);
    expect(StateManager._parseNames('{"a":1}')).toEqual(['Inconnu']);
  });

  it('_unflattenFromRedis : conversions interaction_count / last_seen et objet null', () => {
    expect(StateManager._unflattenFromRedis(null)).toEqual({});
    const partial = StateManager._unflattenFromRedis({});
    expect(partial.interaction_count).toBe(0);
    expect(partial.names).toBeUndefined();
    // last_seen non numérique conservé tel quel
    const legacy = StateManager._unflattenFromRedis({ last_seen: 'hier' });
    expect(legacy.last_seen).toBe('hier');
  });
});

describe('StateManager.getUser', () => {
  it('cache hit : renvoie le profil depuis Redis sans toucher à Supabase ni aux locks', async () => {
    mockHGetAll.mockResolvedValue({
      created_at: '2026-01-01T00:00:00Z',
      names: '["Alexandre","Alex"]',
      interaction_count: '12',
      last_seen: '1700000000000',
      username: 'alex',
    });

    const state = await StateManager.getUser(JID);

    expect(mockHGetAll).toHaveBeenCalledWith(CACHE_KEY);
    expect(mockLockAcquireWait).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(state.jid).toBe(JID);
    expect(state.id).toBe(UUID);
    expect(state.names).toEqual(['Alexandre', 'Alex']);
    expect(state.interaction_count).toBe(12);
    expect(state.last_seen).toBe(1700000000000);
    expect(state.username).toBe('alex');
  });

  it('cache hit sans names : repli sur ["Inconnu"]', async () => {
    mockHGetAll.mockResolvedValue({ created_at: '2026-01-01T00:00:00Z', interaction_count: '4' });

    const state = await StateManager.getUser(JID);
    expect(state.names).toEqual(['Inconnu']);
    expect(state.interaction_count).toBe(4);
  });

  it('cache hit : names legacy "Alex,Alexandre" désérialisés en tableau', async () => {
    mockHGetAll.mockResolvedValue({
      created_at: '2026-01-01T00:00:00Z',
      names: 'Alex,Alexandre',
      interaction_count: '1',
    });

    const state = await StateManager.getUser(JID);
    expect(state.names).toEqual(['Alex', 'Alexandre']);
  });

  it('resolved null : renvoie le profil minimal Inconnu', async () => {
    mockResolveContext.mockResolvedValue(null);

    const state = await StateManager.getUser(JID);

    expect(state).toEqual({ jid: JID, names: ['Inconnu'], interaction_count: 0 });
    expect(mockHGetAll).not.toHaveBeenCalled();
  });

  it('contexte non-user : renvoie le profil minimal Inconnu', async () => {
    mockResolveContext.mockResolvedValue({ type: 'group', context_id: 'g-1' });

    const state = await StateManager.getUser(JID);

    expect(state).toEqual({ jid: JID, names: ['Inconnu'], interaction_count: 0 });
  });

  it('cache miss : hydrate depuis Supabase, préserve interaction_count du cache et libère le verrou', async () => {
    // Cache partiel : interaction_count incrémenté mais pas de created_at
    mockHGetAll.mockResolvedValue({ interaction_count: '5' });
    queryResolver = () => ({
      data: {
        id: UUID,
        names: ['Alice'],
        created_at: '2026-01-01T00:00:00Z',
        interaction_count: 2,
      },
      error: null,
    });

    const state = await StateManager.getUser(JID);

    expect(mockLockAcquireWait).toHaveBeenCalledWith(UUID);
    expect(mockHSet).toHaveBeenCalledWith(
      CACHE_KEY,
      expect.objectContaining({
        names: '["Alice"]',
        created_at: '2026-01-01T00:00:00Z',
        interaction_count: '5',
      }),
    );
    expect(mockExpire).toHaveBeenCalledWith(CACHE_KEY, 86400);
    expect(mockLockRelease).toHaveBeenCalledWith(UUID, 'lock-1');
    expect(state.id).toBe(UUID);
    expect(state.names).toEqual(['Alice']);
    expect(state.interaction_count).toBe(5);
  });

  it('round-trip end-to-end : names ["Alexandre","Alex"] identiques après hSet puis relecture', async () => {
    mockHGetAll.mockResolvedValue({});
    queryResolver = () => ({
      data: {
        id: UUID,
        names: ['Alexandre', 'Alex'],
        created_at: '2026-01-01T00:00:00Z',
        interaction_count: 2,
      },
      error: null,
    });

    const first = await StateManager.getUser(JID);
    expect(first.names).toEqual(['Alexandre', 'Alex']);

    // Récupérer exactement ce qui a été écrit dans Redis puis rejouer une lecture
    const written = mockHSet.mock.calls.at(0)?.at(1) as Record<string, string>;
    expect(written.names).toBe('["Alexandre","Alex"]');
    expect(written.names).not.toBe('Alexandre,Alex');

    mockHGetAll.mockResolvedValue(written);
    const second = await StateManager.getUser(JID);
    expect(second.names).toEqual(['Alexandre', 'Alex']);
  });

  it('double check après lock : hydratation sautée si un autre worker a rempli le cache', async () => {
    const fullHash = {
      created_at: '2026-01-01T00:00:00Z',
      names: '["Bob"]',
      interaction_count: '3',
    };
    mockHGetAll.mockResolvedValueOnce({}).mockResolvedValue(fullHash);

    const state = await StateManager.getUser(JID);

    expect(mockLockAcquireWait).toHaveBeenCalledWith(UUID);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockHSet).not.toHaveBeenCalled();
    expect(mockLockRelease).toHaveBeenCalledWith(UUID, 'lock-1');
    expect(state.names).toEqual(['Bob']);
    expect(state.interaction_count).toBe(3);
  });

  it('cache miss sans ligne DB : renvoie le profil minimal et libère le verrou', async () => {
    mockHGetAll.mockResolvedValue({});
    queryResolver = () => ({ data: null, error: null });

    const state = await StateManager.getUser(JID);

    expect(mockHSet).not.toHaveBeenCalled();
    expect(mockLockRelease).toHaveBeenCalledWith(UUID, 'lock-1');
    expect(state.id).toBe(UUID);
    expect(state.names).toEqual(['Inconnu']);
    expect(state.interaction_count).toBe(0);
  });

  it('lock failure : renvoie le profil minimal sans hydrater', async () => {
    mockHGetAll.mockResolvedValue({});
    mockLockAcquireWait.mockResolvedValue(null);

    const state = await StateManager.getUser(JID);

    expect(state).toEqual({
      jid: JID,
      id: UUID,
      names: ['Inconnu'],
      interaction_count: 0,
    });
    expect(queryChains).toHaveLength(0);
    expect(mockLockRelease).not.toHaveBeenCalled();
  });

  it('erreur Supabase pendant l hydratation : le verrou est quand même libéré (finally)', async () => {
    mockHGetAll.mockResolvedValue({});
    queryResolver = () => Promise.reject(new Error('db down'));

    await expect(StateManager.getUser(JID)).rejects.toThrow('db down');
    expect(mockLockRelease).toHaveBeenCalledWith(UUID, 'lock-1');
  });
});

describe('StateManager.updateUserInteraction', () => {
  it('pipeline multi : incrément, last_seen, pushname, TTL et dirty queue', async () => {
    await StateManager.updateUserInteraction(JID, 'Alex');

    expect(mockPipeline.hIncrBy).toHaveBeenCalledWith(CACHE_KEY, 'interaction_count', 1);
    expect(mockPipeline.hSet).toHaveBeenCalledWith(CACHE_KEY, 'last_seen', expect.any(Number));
    expect(mockPipeline.hSet).toHaveBeenCalledWith(CACHE_KEY, 'last_pushname', 'Alex');
    expect(mockPipeline.expire).toHaveBeenCalledWith(CACHE_KEY, 86400);
    expect(mockPipeline.sAdd).toHaveBeenCalledWith(SYNC_QUEUE_KEY, UUID);
    expect(mockPipelineExec).toHaveBeenCalledTimes(1);
  });

  it('pushName null : ne stocke pas last_pushname', async () => {
    await StateManager.updateUserInteraction(JID, null);

    expect(mockPipeline.hSet).toHaveBeenCalledTimes(1);
    expect(mockPipeline.hSet).toHaveBeenCalledWith(CACHE_KEY, 'last_seen', expect.any(Number));
    expect(mockPipeline.sAdd).toHaveBeenCalledWith(SYNC_QUEUE_KEY, UUID);
  });

  it('contexte non-user : no-op', async () => {
    mockResolveContext.mockResolvedValue({ type: 'group', context_id: 'g-1' });

    await StateManager.updateUserInteraction(JID, 'Alex');
    expect(mockRedis.multi).not.toHaveBeenCalled();
  });

  it('Redis fermé : no-op (fail safe)', async () => {
    mockRedis.isOpen = false;

    await StateManager.updateUserInteraction(JID, 'Alex');
    expect(mockRedis.multi).not.toHaveBeenCalled();
  });
});

describe('StateManager.updatePreferences', () => {
  it('écrit language/timezone et ajoute à la dirty queue', async () => {
    await StateManager.updatePreferences(JID, {
      language: 'fr',
      timezone: 'Europe/Paris',
    });

    expect(mockPipeline.hSet).toHaveBeenCalledWith(CACHE_KEY, 'language', 'fr');
    expect(mockPipeline.hSet).toHaveBeenCalledWith(CACHE_KEY, 'timezone', 'Europe/Paris');
    expect(mockPipeline.sAdd).toHaveBeenCalledWith(SYNC_QUEUE_KEY, UUID);
    expect(mockPipelineExec).toHaveBeenCalledTimes(1);
  });

  it('préférences vides : aucun hSet mais queue quand même', async () => {
    await StateManager.updatePreferences(JID, {});

    expect(mockPipeline.hSet).not.toHaveBeenCalled();
    expect(mockPipeline.sAdd).toHaveBeenCalledWith(SYNC_QUEUE_KEY, UUID);
  });

  it('contexte non-user et Redis fermé : no-op', async () => {
    mockResolveContext.mockResolvedValue(null);
    await StateManager.updatePreferences(JID, { language: 'fr' });

    mockResolveContext.mockResolvedValue({ type: 'user', context_id: UUID });
    mockRedis.isOpen = false;
    await StateManager.updatePreferences(JID, { language: 'fr' });

    expect(mockRedis.multi).not.toHaveBeenCalled();
  });
});

describe('StateManager.processSyncQueue', () => {
  it('queue vide ou null : sort sans appeler Supabase', async () => {
    mockSPopCount.mockResolvedValue([]);
    await StateManager.processSyncQueue();
    mockSPopCount.mockResolvedValueOnce(null as unknown as string[]);
    await StateManager.processSyncQueue();

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('Redis fermé : no-op', async () => {
    mockRedis.isOpen = false;

    await StateManager.processSyncQueue();
    expect(mockSPopCount).not.toHaveBeenCalled();
  });

  it('batch upsert : mappe le cache vers la table users avec fallback username Inconnu', async () => {
    mockSPopCount.mockResolvedValue(['u1', 'u2', 'u3', 'u4', '']);
    mockPipelineExec.mockResolvedValue([
      {
        last_pushname: 'Alex',
        interaction_count: '3',
        language: 'fr',
        timezone: 'Europe/Paris',
      },
      { interaction_count: '7' },
      null,
      { last_pushname: 'Zoe' },
      { anything: '1' },
    ]);
    queryResolver = () => ({ data: null, error: null });

    await StateManager.processSyncQueue(50);

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Syncing 5 users'));
    expect(mockPipeline.hGetAll).toHaveBeenCalledWith('user:u1:data');
    expect(mockPipeline.hGetAll).toHaveBeenCalledWith('user:u3:data');

    const upsert = upsertCalls().at(0);
    expect(upsert).toBeDefined();
    expect(upsert?.args.at(1)).toEqual({ onConflict: 'id' });
    expect(upsert?.args.at(0)).toEqual([
      {
        id: 'u1',
        username: 'Alex',
        interaction_count: 3,
        language: 'fr',
        timezone: 'Europe/Paris',
        updated_at: expect.any(String),
      },
      {
        id: 'u2',
        username: 'Inconnu',
        interaction_count: 7,
        language: null,
        timezone: null,
        updated_at: expect.any(String),
      },
      {
        id: 'u4',
        username: 'Zoe',
        interaction_count: 0,
        language: null,
        timezone: null,
        updated_at: expect.any(String),
      },
    ]);
    // Pas d'erreur => pas de rollback
    expect(mockSAdd).not.toHaveBeenCalled();
  });

  it('rollback : remet les UUIDs dans la queue quand upsert échoue', async () => {
    const uuids = ['u1', 'u2'];
    mockSPopCount.mockResolvedValue(uuids);
    mockPipelineExec.mockResolvedValue([{ interaction_count: '1' }, { interaction_count: '2' }]);
    queryResolver = () => ({ data: null, error: { message: 'boom' } });

    await StateManager.processSyncQueue();

    expect(errSpy).toHaveBeenCalledWith('[StateManager] Sync Error:', { message: 'boom' });
    expect(mockSAdd).toHaveBeenCalledWith(SYNC_QUEUE_KEY, uuids);
  });

  it('aucune donnée exploitable en cache : pas d upsert', async () => {
    mockSPopCount.mockResolvedValue(['u1']);
    mockPipelineExec.mockResolvedValue([null]);

    await StateManager.processSyncQueue();

    expect(upsertCalls()).toHaveLength(0);
  });
});

describe('StateManager — activité de groupe', () => {
  it('recordGroupActivity : ZINCRBY + TTL 30 jours', async () => {
    await StateManager.recordGroupActivity('group@g.us', 'user@s.whatsapp.net');

    expect(mockZIncrBy).toHaveBeenCalledWith(
      'group:group@g.us:leaderboard',
      1,
      'user@s.whatsapp.net',
    );
    expect(mockExpire).toHaveBeenCalledWith('group:group@g.us:leaderboard', 86400 * 30);
  });

  it('getGroupLeaderboard : ZREVRANGE WITHSCORES limité à 10 par défaut', async () => {
    const entries = [
      { value: 'u1@s.whatsapp.net', score: 150 },
      { value: 'u2@s.whatsapp.net', score: 120 },
    ];
    mockZRangeWithScores.mockResolvedValue(entries);

    const result = await StateManager.getGroupLeaderboard('group@g.us');

    expect(mockZRangeWithScores).toHaveBeenCalledWith('group:group@g.us:leaderboard', 0, 9, {
      REV: true,
    });
    expect(result).toEqual(entries);
  });

  it('getGroupLeaderboard : limite personnalisée', async () => {
    mockZRangeWithScores.mockResolvedValue([]);

    await StateManager.getGroupLeaderboard('group@g.us', 3);

    expect(mockZRangeWithScores).toHaveBeenCalledWith('group:group@g.us:leaderboard', 0, 2, {
      REV: true,
    });
  });

  it('getUserGroupScore : score du membre ou 0 si absent', async () => {
    mockZScore.mockResolvedValue(42);
    expect(await StateManager.getUserGroupScore('group@g.us', 'u1@s.whatsapp.net')).toBe(42);

    mockZScore.mockResolvedValue(null);
    expect(await StateManager.getUserGroupScore('group@g.us', 'u1@s.whatsapp.net')).toBe(0);

    expect(mockZScore).toHaveBeenCalledWith('group:group@g.us:leaderboard', 'u1@s.whatsapp.net');
  });
});
