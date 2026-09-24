// tests/unit/services/stateManagerNames.test.ts
// Issue #27 — intégrité du tableau `names` dans le round-trip Redis :
// _flattenForRedis sérialise tableaux/objets en JSON, _unflattenFromRedis
// reconstruit via _parseNames (JSON.parse + Array.isArray, repli legacy).
import { describe, it, expect, jest } from '@jest/globals';

jest.unstable_mockModule('../../../services/redisClient.js', () => ({
  redis: { isOpen: false },
  getRedisClient: () => null,
  switchToMock: () => undefined,
}));

jest.unstable_mockModule('../../../services/supabase.js', () => ({
  supabase: null,
  default: { resolveContextFromLegacyId: async () => null },
}));

jest.unstable_mockModule('../../../services/state/LockManager.js', () => ({
  LockManager: class {
    async acquireWait(): Promise<string | null> {
      return null;
    }
    async release(): Promise<void> {
      return undefined;
    }
  },
}));

jest.unstable_mockModule('../../../services/state/IdentityMap.js', () => ({
  IdentityMap: { resolve: async (identifier: string) => identifier },
}));

const { StateManager } = await import('../../../services/state/StateManager.js');

type Helpers = {
  _flattenForRedis: (obj: Record<string, unknown>) => Record<string, string>;
  _unflattenFromRedis: (obj: Record<string, string> | null) => Record<string, unknown>;
  _parseNames: (raw: string) => string[];
};
const helpers = StateManager as unknown as Helpers;

describe('StateManager — sérialisation names (#27)', () => {
  it('round-trip : le tableau names survit à Redis sans aplatissement', () => {
    const flat = helpers._flattenForRedis({
      names: ['Alexandre', 'Alex'],
      interaction_count: 3,
      last_seen: 1700000000000,
    });
    // Le tableau est sérialisé en JSON (et non String(v) -> "Alexandre,Alex").
    expect(flat.names).toBe('["Alexandre","Alex"]');
    expect(flat.interaction_count).toBe('3');

    const restored = helpers._unflattenFromRedis(flat) as unknown as {
      names: string[];
      interaction_count: number;
      last_seen: number;
    };
    expect(restored.names).toEqual(['Alexandre', 'Alex']);
    expect(restored.interaction_count).toBe(3);
    expect(restored.last_seen).toBe(1700000000000);
  });

  it('_flattenForRedis : objets en JSON, scalaires en String, null/undefined ignorés', () => {
    const flat = helpers._flattenForRedis({
      profile: { a: 1 },
      name: 'Alex',
      count: 0,
      flag: false,
      none: null,
      missing: undefined,
    });
    expect(flat).toEqual({
      profile: '{"a":1}',
      name: 'Alex',
      count: '0',
      flag: 'false',
    });
  });

  it('_parseNames : JSON valide, filtrage des non-strings, strings isolées', () => {
    expect(helpers._parseNames('["a","b"]')).toEqual(['a', 'b']);
    expect(helpers._parseNames('["a",42,null,"b",{"x":1}]')).toEqual(['a', 'b']);
    expect(helpers._parseNames('"solo"')).toEqual(['solo']);
  });

  it('_parseNames : repli legacy (liste à virgules, valeurs non tableau)', () => {
    // Lignes écrites avant le fix : String(v) produisait "Alex,Alexandre".
    expect(helpers._parseNames('Alex,Alexandre')).toEqual(['Alex', 'Alexandre']);
    expect(helpers._parseNames('Solo')).toEqual(['Solo']);
    expect(helpers._parseNames('null')).toEqual(['Inconnu']);
    expect(helpers._parseNames('123')).toEqual(['Inconnu']);
    expect(helpers._parseNames('{"bad":1')).toEqual(['{"bad":1']);
  });

  it('_unflattenFromRedis : null -> {}, conversions numériques bornées', () => {
    expect(helpers._unflattenFromRedis(null)).toEqual({});
    const restored = helpers._unflattenFromRedis({
      interaction_count: '5',
      last_seen: '1700000000000',
    }) as unknown as { interaction_count: number; last_seen: number };
    expect(restored.interaction_count).toBe(5);
    expect(restored.last_seen).toBe(1700000000000);

    // Valeurs non numériques : interaction_count rejeté (repli 0, jamais de
    // NaN dans un profil), last_seen non numérique conservé tel quel.
    const corrupted = helpers._unflattenFromRedis({
      interaction_count: 'non-numérique',
      last_seen: 'nan',
    }) as unknown as { interaction_count: number; last_seen: string };
    expect(corrupted.interaction_count).toBe(0);
    expect(corrupted.last_seen).toBe('nan');
  });
});
