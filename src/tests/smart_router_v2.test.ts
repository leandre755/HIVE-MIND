import { jest, describe, beforeEach, afterEach, it, expect } from '@jest/globals';

// Mock dependencies BEFORE importing the modules that use them
jest.unstable_mockModule('../services/redisClient.js', () => ({
  redis: {
    isReady: true,
    get: jest.fn(),
    mGet: jest.fn(),
    setEx: jest.fn(),
    multi: jest.fn(() => ({
      incr: jest.fn(),
      expire: jest.fn(),
      incrBy: jest.fn(),
      exec: jest.fn(),
    })),
  },
  ensureConnected: jest.fn(),
  checkHealth: jest.fn(),
  disconnect: jest.fn(),
}));

// Now we dynamically import the modules after mocking
const { quotaManager } = await import('../services/quotaManager.js');
const { envResolver } = await import('../services/envResolver.js');
const { providerRouter } = await import('../providers/index.js');
const { container } = await import('../core/ServiceContainer.js');

// Register quotaManager in the service container so callServiceRecipe resolves it correctly during tests
container.register('quotaManager', quotaManager);

type HealthResultShape = {
  healthy: boolean;
  blocked: boolean;
  rpmUsed: number;
  reason: string | null;
};

type QuotaManagerInternals = {
  quotas: Record<string, { rpm: number; tpm: number; rpd: number }>;
  getAvailableKeyForModel: (modelId: string, provider: string) => Promise<number>;
  isModelAvailable: (modelId: string) => Promise<boolean>;
  getModelHealth: (
    modelId: string,
    margins?: { rpm: number; tpm: number; rpd: number },
    keyIndex?: number,
  ) => Promise<HealthResultShape>;
  getHealthyFamilies: (
    familiesConfig: Record<string, { modeles?: { id?: string; types?: string[] }[] }>,
    margins?: { rpm: number; tpm: number; rpd: number },
  ) => Promise<string[]>;
  recordQuotaExceeded: (
    modelId: string,
    timeoutSeconds?: number,
    keyIndex?: number,
  ) => Promise<void>;
  recordUsage: (
    provider: string,
    modelId: string,
    estimatedTokens?: number,
    keyIndex?: number,
  ) => Promise<void>;
  _l0Cache: Map<string, { value: string | null; expiresAt: number }>;
};

type EnvResolverInternals = {
  getAvailableKeysForProvider: (provider: string) => number[];
};

type ProviderRouterInternals = {
  _recordModelFailure: (model: string) => void;
  _sortModelsByReliability: (models: string[]) => string[];
  _resolveModelsToTry: (family: string, options: Record<string, unknown>) => string[];
  modelFailureScore: Map<string, { score: number; lastFailureAt: number }>;
  chat: unknown;
};

const quotaInternals = (): QuotaManagerInternals =>
  quotaManager as unknown as QuotaManagerInternals;
const envInternals = (): EnvResolverInternals => envResolver as unknown as EnvResolverInternals;
const routerInternals = (): ProviderRouterInternals =>
  providerRouter as unknown as ProviderRouterInternals;

// Sauvegarde de l'implémentation réelle : certains tests réassignent
// getAvailableKeysForProvider (mock), il faut la restaurer en beforeEach pour
// éviter toute fuite d'état entre tests.
const originalGetAvailableKeysForProvider = envInternals().getAvailableKeysForProvider;

// Réinitialisation partagée de l'état mutable entre tests. Extraite en helper
// module-scope pour que chaque describe top-level (découpé pour rester sous le
// plafond max-lines-per-function) l'invoque sans duplication.
function resetSharedState() {
  jest.clearAllMocks();
  // Reset QuotaManager config for tests if needed
  quotaInternals().quotas = {
    'gemini-1.5-pro': { rpm: 10, tpm: 100000, rpd: 500 },
    'gemini-1.5-flash': { rpm: 20, tpm: 200000, rpd: 1000 },
    'audio-model': { rpm: 5, tpm: 10000, rpd: 100 },
  };
  // Fix contamination: clear the 2s-L0 in-memory cache so tests don't read
  // counters written by a previous test (audit anti-429, trouvaille #8).
  quotaInternals()._l0Cache.clear();
  // Restaure l'implémentation réelle de la résolution de clés après un mock.
  envInternals().getAvailableKeysForProvider = originalGetAvailableKeysForProvider;
  // Reset des états mutables du routeur pour des tests déterministes.
  routerInternals().modelFailureScore.clear();
}

describe('Smart Router V2 Logic', () => {
  beforeEach(() => {
    resetSharedState();
  });

  describe('EnvResolver', () => {
    it('should correctly identify and fetch multiple keys for a provider', () => {
      const keysToBackup: Record<string, string | undefined> = {};
      for (let i = 1; i <= 7; i++) {
        keysToBackup[`GEMINI_KEY_${i}`] = process.env[`GEMINI_KEY_${i}`];
        keysToBackup[`PROVIDER_KEY_GEMINI_${i}`] = process.env[`PROVIDER_KEY_GEMINI_${i}`];
        delete process.env[`GEMINI_KEY_${i}`];
        delete process.env[`PROVIDER_KEY_GEMINI_${i}`];
      }

      process.env.GEMINI_KEY_1 = 'key1';
      process.env.GEMINI_KEY_2 = 'key2';
      process.env.GEMINI_KEY_4 = 'key4';

      // Assume envResolver has a method getAvailableKeysForProvider
      const keys = envInternals().getAvailableKeysForProvider('GEMINI');

      expect(keys).toEqual([1, 2, 4]);

      // Clean up and restore
      for (let i = 1; i <= 7; i++) {
        if (keysToBackup[`GEMINI_KEY_${i}`] !== undefined) {
          process.env[`GEMINI_KEY_${i}`] = keysToBackup[`GEMINI_KEY_${i}`]!;
        } else {
          delete process.env[`GEMINI_KEY_${i}`];
        }
        if (keysToBackup[`PROVIDER_KEY_GEMINI_${i}`] !== undefined) {
          process.env[`PROVIDER_KEY_GEMINI_${i}`] = keysToBackup[`PROVIDER_KEY_GEMINI_${i}`]!;
        } else {
          delete process.env[`PROVIDER_KEY_GEMINI_${i}`];
        }
      }
    });
  });

  describe('ProviderRouter V2 - Model Filtering', () => {
    // FIX (audit anti-429, trouvaille #7): l'ancien test re-implémentait le
    // filtre inline (copie de EXCLUDED_ROTATION_TYPES) au lieu d'appeler la
    // vraie méthode. Il passait même si _resolveModelsToTry cassait. On teste
    // désormais la méthode réelle sur la config gemini réelle.
    it('exclut les modeles live_api/tts de la rotation chat standard via _resolveModelsToTry', () => {
      const models = routerInternals()._resolveModelsToTry('gemini', {});
      const EXCLUDED = ['live_api', 'tts', 'stt', 'audio', 'transcription'];

      // Modèles gemini réels portant un type exclu (live_api) : jamais en rotation chat.
      expect(models).not.toContain('gemini-2.5-flash');
      expect(models).not.toContain('gemini-3.1-flash-live-preview');
      // Modèles gemini purement tts/embedding (sans chat) : exclus aussi.
      expect(models).not.toContain('gemini-2.5-flash-tts');
      expect(models).not.toContain('gemini-embedding-001');
      // Un modèle chat pur est bien retenu.
      expect(models).toContain('gemini-3.5-flash');

      // INVARIANT : chaque modèle renvoyé est de type chat sans type exclu.
      const cfg = providerRouter.getFamilyConfig('gemini');
      const modeles = cfg?.modeles || [];
      for (const m of models) {
        const entry = modeles.find((x) => x.id === m);
        expect(entry).toBeDefined();
        expect(entry!.types ?? []).toContain('chat');
        expect((entry!.types ?? []).some((t) => EXCLUDED.includes(t))).toBe(false);
      }
    });
  });

  describe('QuotaManager V2 - Granular Tracking', () => {
    it('should return Key 2 when Key 1 has exhausted its RPM', async () => {
      const redisModule = await import('../services/redisClient.js');
      const redis = redisModule.redis as unknown as {
        get: jest.MockedFunction<(key: string) => Promise<string | null>>;
      };

      // Mock redis get behavior
      redis.get.mockImplementation(async (key: string) => {
        // Key 1 is exhausted for gemini-1.5-pro
        if (key === 'quota:gemini-1.5-pro:k1:rpm') return '10'; // Equal to limit 10
        // Key 2 is healthy
        if (key === 'quota:gemini-1.5-pro:k2:rpm') return '0';
        return null;
      });

      // Assume envResolver returns available indices 1, 2
      const mockGetKeys: unknown = jest.fn().mockReturnValue([1, 2]);
      envInternals().getAvailableKeysForProvider = mockGetKeys as (provider: string) => number[];

      // Test the new method
      const bestKeyIndex = await quotaInternals().getAvailableKeyForModel(
        'gemini-1.5-pro',
        'GEMINI',
      );

      expect(bestKeyIndex).toBe(2);
    });

    it('should keep Model B on Key 1 even if Model A exhausts Key 1', async () => {
      const redisModule = await import('../services/redisClient.js');
      const redis = redisModule.redis as unknown as {
        get: jest.MockedFunction<(key: string) => Promise<string | null>>;
      };

      redis.get.mockImplementation(async (key: string) => {
        if (key === 'quota:gemini-1.5-pro:k1:rpm') return '10'; // Exhausted
        if (key === 'quota:gemini-1.5-flash:k1:rpm') return '5'; // Healthy (limit is 20)
        return null;
      });

      const mockGetKeys: unknown = jest.fn().mockReturnValue([1, 2]);
      envInternals().getAvailableKeysForProvider = mockGetKeys as (provider: string) => number[];

      const bestKeyIndexPro = await quotaInternals().getAvailableKeyForModel(
        'gemini-1.5-pro',
        'GEMINI',
      );
      const bestKeyIndexFlash = await quotaInternals().getAvailableKeyForModel(
        'gemini-1.5-flash',
        'GEMINI',
      );

      expect(bestKeyIndexPro).toBe(2);
      expect(bestKeyIndexFlash).toBe(1);
    });
  });

  describe('callServiceRecipe Fallback Direct', () => {
    let originalChat: unknown;
    let originalIsModelAvailable: QuotaManagerInternals['isModelAvailable'];

    beforeEach(() => {
      originalChat = routerInternals().chat;
      originalIsModelAvailable = quotaInternals().isModelAvailable;

      // Mock de chat pour renvoyer un succès fictif
      const mockChat: unknown = jest.fn(() => Promise.resolve({ content: 'Mock response' }));
      routerInternals().chat = mockChat;
      // Par défaut, modèle disponible
      const mockModelAvailable: unknown = jest.fn(async () => true);
      quotaInternals().isModelAvailable = mockModelAvailable as (
        modelId: string,
      ) => Promise<boolean>;
    });

    afterEach(() => {
      routerInternals().chat = originalChat;
      quotaInternals().isModelAvailable = originalIsModelAvailable;
    });

    it('should call the primary model if it is available', async () => {
      // Utilisons la recette DREAM_SERVICE
      // primary: qwen/qwen3-32b (groq)
      // fallback: mistral-large-latest (mistral)
      const res = await providerRouter.callServiceRecipe('DREAM_SERVICE', [
        { role: 'user', content: 'test' },
      ]);

      expect(providerRouter.chat).toHaveBeenCalledTimes(1);
      expect(providerRouter.chat).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          model: 'qwen/qwen3-32b',
          family: 'groq',
        }),
      );
      expect(res.content).toBe('Mock response');
    });

    it('should bypass the primary model and call the fallback directly if the primary model has no quota', async () => {
      // Mocker indisponibilité pour le modèle 'qwen/qwen3-32b'
      const mockAvailability: unknown = jest.fn(
        async (modelId: string): Promise<boolean> => modelId !== 'qwen/qwen3-32b',
      );
      quotaInternals().isModelAvailable = mockAvailability as (modelId: string) => Promise<boolean>;

      const res = await providerRouter.callServiceRecipe('DREAM_SERVICE', [
        { role: 'user', content: 'test' },
      ]);

      expect(providerRouter.chat).toHaveBeenCalledTimes(1);
      expect(providerRouter.chat).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          model: 'mistral-large-latest',
          family: 'mistral',
        }),
      );
      expect(res.content).toBe('Mock response');
    });

    it('should throw an error if all models in the cascade are unavailable', async () => {
      // Mocker indisponibilité pour tous les modèles
      const mockAllUnavailable: unknown = jest.fn(async () => false);
      quotaInternals().isModelAvailable = mockAllUnavailable as (
        modelId: string,
      ) => Promise<boolean>;

      await expect(
        providerRouter.callServiceRecipe('DREAM_SERVICE', [{ role: 'user', content: 'test' }]),
      ).rejects.toThrow(/tous les modèles de la cascade sont indisponibles/);

      expect(providerRouter.chat).not.toHaveBeenCalled();
    });
  });
});
// =========================================================================
// Nouveaux tests écrits suite à l'audit anti-429 (2026-08-05).
// Les mécanismes « Zero-429 » (getModelHealth, getHealthyFamilies,
// recordQuotaExceeded, fiabilité, circuit breaker, mode dégradé) n'avaient
// AUCUN test. Les tests de comportements BUGGÉS documentent l'état actuel
// (tests de caractérisation) avec un pointeur vers le rapport d'audit —
// les corrections de production sont volontairement DIFFÉRÉES.
// =========================================================================

describe('Smart Router V2 — Audit: fiabilité', () => {
  beforeEach(() => {
    resetSharedState();
  });

  describe('Reliability Scoring (_recordModelFailure / _sortModelsByReliability)', () => {
    it('relègue le modèle défaillant en fin de rotation', () => {
      const router = routerInternals();
      router._recordModelFailure('model-a');
      router._recordModelFailure('model-a');

      const sorted = router._sortModelsByReliability(['model-a', 'model-b']);
      // model-b (score 0) doit passer devant model-a (score > 0).
      expect(sorted).toEqual(['model-b', 'model-a']);
    });

    it('laisse les modèles sans historique à leur position originelle', () => {
      const router = routerInternals();
      const sorted = router._sortModelsByReliability(['m1', 'm2', 'm3']);
      expect(sorted).toEqual(['m1', 'm2', 'm3']);
    });
  });
});
describe('Smart Router V2 — Audit: QuotaManager anti-429', () => {
  beforeEach(() => {
    resetSharedState();
  });

  describe('QuotaManager V2 - getModelHealth (marges de sécurité)', () => {
    it('déclare unhealthy quand RPM dépasse le seuil (80% de la limite)', async () => {
      const redisModule = await import('../services/redisClient.js');
      const redis = redisModule.redis as unknown as {
        get: jest.MockedFunction<(key: string) => Promise<string | null>>;
      };
      // gemini-1.5-pro a rpm:10 → seuil = floor(10 * 0.8) = 8.
      redis.get.mockImplementation(async (key: string) => {
        if (key === 'quota:gemini-1.5-pro:k1:rpm') return '10';
        return null;
      });

      const health = await quotaInternals().getModelHealth('gemini-1.5-pro', {
        rpm: 0.2,
        tpm: 0.1,
        rpd: 0.05,
      });
      expect(health.healthy).toBe(false);
      expect(health.reason).toMatch(/RPM proche limite/);
    });

    it('déclare healthy sous le seuil RPM', async () => {
      const redisModule = await import('../services/redisClient.js');
      const redis = redisModule.redis as unknown as {
        get: jest.MockedFunction<(key: string) => Promise<string | null>>;
      };
      redis.get.mockImplementation(async (key: string) => {
        if (key === 'quota:gemini-1.5-pro:k1:rpm') return '5';
        return null;
      });

      const health = await quotaInternals().getModelHealth('gemini-1.5-pro', {
        rpm: 0.2,
        tpm: 0.1,
        rpd: 0.05,
      });
      expect(health.healthy).toBe(true);
    });

    it('déclare blocked quand la clé est explicitement bloquée (429 antérieur)', async () => {
      const redisModule = await import('../services/redisClient.js');
      const redis = redisModule.redis as unknown as {
        get: jest.MockedFunction<(key: string) => Promise<string | null>>;
      };
      redis.get.mockImplementation(async (key: string) => {
        if (key === 'quota:gemini-1.5-pro:k1:blocked') return '1';
        return null;
      });

      const health = await quotaInternals().getModelHealth('gemini-1.5-pro', {
        rpm: 0.2,
        tpm: 0.1,
        rpd: 0.05,
      });
      expect(health.healthy).toBe(false);
      expect(health.blocked).toBe(true);
    });
  });

  describe('QuotaManager V2 - recordQuotaExceeded → L0 write-through', () => {
    it('bloque immédiatement la clé : getAvailableKeyForModel bascule sur la clé saine', async () => {
      const mockGetKeys: unknown = jest.fn().mockReturnValue([1, 2]);
      envInternals().getAvailableKeysForProvider = mockGetKeys as (provider: string) => number[];

      const redisModule = await import('../services/redisClient.js');
      const redis = redisModule.redis as unknown as {
        get: jest.MockedFunction<(key: string) => Promise<string | null>>;
      };
      redis.get.mockImplementation(async (key: string) => {
        if (key === 'quota:gemini-1.5-pro:k2:rpm') return '0';
        return null;
      });

      // k1 non bloquée → sélectionnée en premier (find(), ordre original).
      let best = await quotaInternals().getAvailableKeyForModel('gemini-1.5-pro', 'GEMINI');
      expect(best).toBe(1);

      // Un 429 réel bloque k1 via recordQuotaExceeded (write-through L0 synchrone).
      await quotaInternals().recordQuotaExceeded('gemini-1.5-pro', 60, 1);

      // La clé 1 est maintenant exclue sans même re-lire Redis (L0).
      best = await quotaInternals().getAvailableKeyForModel('gemini-1.5-pro', 'GEMINI');
      expect(best).toBe(2);
    });
  });

  describe('QuotaManager V2 - getAvailableKeyForModel sans clé', () => {
    // FIX (audit anti-429, trouvaille #5) : l'ancien « Fallback sécurisé »
    // retournait 1 (fail-open) quand le provider n'a AUCUNE clé, forçant une
    // tentative sur une clé inexistante (429). Désormais fail-closed : null,
    // le routeur saute le modèle via _selectKeyIndex.
    it('retourne null (fail-closed) quand le provider n a aucune clé', async () => {
      const mockNoKeys: unknown = jest.fn().mockReturnValue([]);
      envInternals().getAvailableKeysForProvider = mockNoKeys as (provider: string) => number[];

      const best = await quotaInternals().getAvailableKeyForModel('gemini-1.5-pro', 'GEMINI');
      expect(best).toBeNull();
    });
  });

  describe('QuotaManager V2 - getHealthyFamilies', () => {
    it('retire la famille quand aucun de ses modèles n est sain', async () => {
      const redisModule = await import('../services/redisClient.js');
      const redis = redisModule.redis as unknown as {
        get: jest.MockedFunction<(key: string) => Promise<string | null>>;
      };
      // RPM consumé = 10/10 → seuil 8 dépassé → gemini-1.5-pro malsain.
      redis.get.mockImplementation(async (key: string) => {
        if (key === 'quota:gemini-1.5-pro:k1:rpm') return '10';
        return null;
      });

      const healthy = await quotaInternals().getHealthyFamilies(
        { gemini: { modeles: [{ id: 'gemini-1.5-pro', types: ['chat'] }] } },
        { rpm: 0.2, tpm: 0.1, rpd: 0.05 },
      );
      expect(healthy).not.toContain('gemini');
    });

    it('retient la famille quand un modèle est sain', async () => {
      const redisModule = await import('../services/redisClient.js');
      const redis = redisModule.redis as unknown as {
        get: jest.MockedFunction<(key: string) => Promise<string | null>>;
      };
      redis.get.mockImplementation(async () => null);

      const healthy = await quotaInternals().getHealthyFamilies(
        { gemini: { modeles: [{ id: 'gemini-1.5-pro', types: ['chat'] }] } },
        { rpm: 0.2, tpm: 0.1, rpd: 0.05 },
      );
      expect(healthy).toContain('gemini');
    });
  });

  describe('Mode dégradé Redis DOWN (politique fail-closed cohérente)', () => {
    // FIX (audit anti-429, trouvaille #4/#5) : l'incohérence fail-open /
    // fail-closed est résolue — getModelHealth, getAvailableKeyForModel et
    // filterHealthyModels sont désormais FAIL-CLOSED, cohérent avec
    // isModelAvailable (1 req/min, blocage >5min). Une panne Redis ne doit
    // pas être convertie en requêtes non protégées (tempête de 429).
    it('getModelHealth est FAIL-CLOSED quand Redis est down', async () => {
      const redisModule = await import('../services/redisClient.js');
      const redis = redisModule.redis as unknown as { isReady: boolean };
      const original = redis.isReady;
      redis.isReady = false;
      try {
        const health = await quotaInternals().getModelHealth('gemini-1.5-pro', {
          rpm: 0.2,
          tpm: 0.1,
          rpd: 0.05,
        });
        expect(health.healthy).toBe(false);
        expect(health.reason).toContain('REDIS INACCESSIBLE');
      } finally {
        redis.isReady = original;
      }
    });

    it('getAvailableKeyForModel est FAIL-CLOSED (null) quand Redis est down', async () => {
      const redisModule = await import('../services/redisClient.js');
      const redis = redisModule.redis as unknown as { isReady: boolean };
      const original = redis.isReady;
      redis.isReady = false;
      try {
        const best = await quotaInternals().getAvailableKeyForModel('gemini-1.5-pro', 'GEMINI');
        expect(best).toBeNull();
      } finally {
        redis.isReady = original;
      }
    });

    it('isModelAvailable est FAIL-CLOSED (1 req/min) quand Redis est down', async () => {
      const redisModule = await import('../services/redisClient.js');
      const redis = redisModule.redis as unknown as { isReady: boolean };
      const original = redis.isReady;
      redis.isReady = false;
      try {
        const first = await quotaInternals().isModelAvailable('gemini-1.5-pro');
        const second = await quotaInternals().isModelAvailable('gemini-1.5-pro');
        expect(first).toBe(true);
        expect(second).toBe(false); // attendre 60s avant la requête suivante
      } finally {
        redis.isReady = original;
      }
    });
  });

  describe('Comptabilité L0 - recordUsage write-through (fix trouvaille #3)', () => {
    // FIX (audit anti-429, trouvaille #3) : l'ancien write-through reconstruisait
    // le compteur L0 depuis un L0 stalé (`parseInt(l0||0)+1`), sous-comptant
    // pendant 2s. Désormais recordUsage peuple le L0 avec les valeurs
    // AUTORITATIVES retournées par multi.exec().
    it('peuple le L0 avec la valeur autoritative de multi.exec()', async () => {
      const redisModule = await import('../services/redisClient.js');
      const redis = redisModule.redis as unknown as {
        get: jest.MockedFunction<(key: string) => Promise<string | null>>;
        multi: jest.MockedFunction<
          () => {
            incr: () => void;
            expire: () => void;
            incrBy: () => void;
            exec: () => Promise<unknown[]>;
          }
        >;
      };
      // Redis est déjà à 10 (bursts concurrents) mais le L0 est vide.
      redis.get.mockImplementation(async (key: string) => {
        if (key === 'quota:bug-model:k1:rpm') return '10';
        return null;
      });
      // multi.exec() renvoie les valeurs publiées par Redis : rpm incrémenté
      // 10→11, rpd=1. Ordre sans TPM : [incr rpm, expire rpm, incr rpd, expire rpd].
      redis.multi.mockReturnValue({
        incr: jest.fn(),
        expire: jest.fn(),
        incrBy: jest.fn(),
        exec: async () => [11, 'OK', 1, 'OK'],
      });
      quotaInternals().quotas['bug-model'] = { rpm: 10, tpm: 100000, rpd: 500 };
      quotaInternals()._l0Cache.clear();

      await quotaInternals().recordUsage('provider', 'bug-model', 0, 1);

      const health = await quotaInternals().getModelHealth('bug-model', {
        rpm: 0.2,
        tpm: 0.1,
        rpd: 0.05,
      });
      // FIX : le L0 reflète la valeur autoritative de Redis (11), et non un
      // compteur reconstruit depuis un L0 stale (1).
      expect(health.rpmUsed).toBe(11);
    });
  });
});
