import { describe, beforeEach, afterEach, it, expect, jest } from '@jest/globals';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  safeMkdirSync,
  safeWriteFileSync,
  safeRemoveDirectorySync,
  safeExistsSync,
  safeReadFileSync,
  safeSymlinkSync,
} from '../../../utils/safeFs.js';
import {
  resolveConfigPath,
  resolveDefaultsConfigDir,
  resolveLegacyConfigDir,
  resolveUserConfigDir,
  isPathInside,
  isTemplateOrReadOnlyConfig,
} from '../../../config/ConfigPathResolver.js';
import { QuotaManager } from '../../../services/quotaManager.js';
import { VoiceProvider } from '../../../services/voice/voiceProvider.js';
import {
  ServiceContainer,
  countConfiguredAiKeys,
  isRedisConfigured,
  resolveSupabaseCredentials,
  isValidCredentialString,
  normalizeFamillesIa,
} from '../../../core/ServiceContainer.js';
import { redis } from '../../../services/redisClient.js';
import { HuggingFaceAdapter } from '../../../providers/adapters/huggingface.js';
import { initGraphMemoryEmbeddings } from '../../../services/graphMemory.js';
import adminPlugin from '../../../plugins/base/admin/index.js';
import {
  db,
  initSupabaseClient,
  isSupabaseUrlValid,
  isSupabaseKeyValid,
  resolveEnvOrVal,
  determineIfGroup,
} from '../../../services/supabase.js';

interface TestEnvironment {
  tempDir: string;
  prevEnvs: Map<string, string | undefined>;
}

const MONITORED_ENV_KEYS = [
  'HIVE_CONFIG_MODELS_CONFIG_JSON',
  'HIVE_CONFIG_CREDENTIALS_JSON',
  'HIVE_CONFIG_CONFIG_JSON',
  'HIVE_HOME_DIR',
  'HUGGINGFACE_KEY',
  'HF_TOKEN',
  'GEMINI_KEY',
  'OPENAI_KEY',
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'REDIS_URL',
  'HIVE_LEGACY_CONFIG_DIR',
  'HIVE_DEFAULTS_CONFIG_DIR',
  'HIVE_TRUST_PROJECT_CONFIG',
];

function setupTestEnv(): TestEnvironment {
  const tempDir = join(tmpdir(), `config-consumers-${randomUUID()}`);
  safeMkdirSync(tempDir, { recursive: true });
  const prevEnvs = new Map<string, string | undefined>();
  for (const key of MONITORED_ENV_KEYS) {
    prevEnvs.set(key, Reflect.get(process.env, key));
  }
  return { tempDir, prevEnvs };
}

function teardownTestEnv(env: TestEnvironment): void {
  for (const [key, value] of env.prevEnvs.entries()) {
    if (value !== undefined) {
      Reflect.set(process.env, key, value);
    } else {
      Reflect.deleteProperty(process.env, key);
    }
  }
  try {
    safeRemoveDirectorySync(env.tempDir);
  } catch {
    /* ignore */
  }
}

describe('Config Consumers Migration - Core Loaders (#134)', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = setupTestEnv();
  });

  afterEach(() => {
    teardownTestEnv(env);
  });

  it('should resolve and load custom models_config.json via QuotaManager', async () => {
    const customModelsConfig = {
      familles: {
        custom_provider: {
          modeles: [
            {
              id: 'custom-model-1',
              quota: { rpm: 42, tpm: 100000, rpd: 500 },
            },
          ],
        },
      },
    };

    const customPath = join(env.tempDir, 'custom_models.json');
    safeWriteFileSync(customPath, JSON.stringify(customModelsConfig));
    process.env.HIVE_CONFIG_MODELS_CONFIG_JSON = customPath;

    const qm = new QuotaManager();
    const qmInternals = qm as unknown as {
      quotas: Record<string, { rpm?: number; tpm?: number; rpd?: number }>;
      modelToProvider: Map<string, string>;
    };
    expect(qmInternals.modelToProvider.get('custom-model-1')).toBe('custom_provider');
    expect(qmInternals.quotas['custom-model-1']).toEqual({ rpm: 42, tpm: 100000, rpd: 500 });
  });

  it('should resolve credentials.json and populate VoiceProvider credentials', () => {
    const customCreds = {
      familles_ia: {
        minimax: 'test-key-minimax-12345',
      },
    };

    const customPath = join(env.tempDir, 'custom_credentials.json');
    safeWriteFileSync(customPath, JSON.stringify(customCreds));
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = customPath;

    const vp = new VoiceProvider({ enabled: true }, null);
    const internalCreds = (vp as unknown as { credentials: Record<string, string> }).credentials;
    expect(internalCreds.minimax).toBe('test-key-minimax-12345');
  });

  it('should resolve and load default credentials and models_config via ServiceContainer', () => {
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_KEY = 'dummy-key';
    process.env.GEMINI_KEY = 'test-gemini-key-val';
    const container = new ServiceContainer();
    const config = (
      container as unknown as {
        loadConfig: () => { credentials: unknown; modelsConfig: unknown };
      }
    ).loadConfig();
    expect(config.credentials).toBeDefined();
    expect(config.modelsConfig).toBeDefined();
  });

  it('should respect custom credentials and models_config in ServiceContainer', () => {
    const customCreds = {
      supabase: { url: 'https://custom.supabase.co', key: 'custom-key' },
      familles_ia: { gemini: 'test-gemini-key-val' },
    };
    const customModels = {
      reglages_generaux: {
        familles_prioritaires: ['custom'],
        mode_proactif: true,
        embeddings: {
          primary: { provider: 'test', model: 'test-emb', dimensions: 1536 },
          fallback: { provider: 'test', model: 'test-fallback', dimensions: 1536 },
        },
      },
      familles: {},
    };

    const credsPath = join(env.tempDir, 'creds.json');
    const modelsPath = join(env.tempDir, 'models.json');
    safeWriteFileSync(credsPath, JSON.stringify(customCreds));
    safeWriteFileSync(modelsPath, JSON.stringify(customModels));

    process.env.HIVE_CONFIG_CREDENTIALS_JSON = credsPath;
    process.env.HIVE_CONFIG_MODELS_CONFIG_JSON = modelsPath;

    const container = new ServiceContainer();
    const config = (
      container as unknown as {
        loadConfig: () => {
          credentials: { supabase: { url: string; key: string } };
          modelsConfig: { reglages_generaux: { familles_prioritaires: string[] } };
        };
      }
    ).loadConfig();

    expect(config.credentials.supabase.url).toBe('https://custom.supabase.co');
    expect(config.modelsConfig.reglages_generaux.familles_prioritaires).toEqual(['custom']);
  });

  it('should throw clear error when Supabase configuration is missing or invalid in ServiceContainer', () => {
    Reflect.deleteProperty(process.env, 'SUPABASE_URL');
    Reflect.deleteProperty(process.env, 'SUPABASE_KEY');
    Reflect.deleteProperty(process.env, 'SUPABASE_SERVICE_ROLE_KEY');
    process.env.GEMINI_KEY = 'test-gemini-key-val';

    const customCreds = {
      familles_ia: { gemini: 'test-gemini-key-val' },
    };
    const credsPath = join(env.tempDir, 'no_sb_creds.json');
    safeWriteFileSync(credsPath, JSON.stringify(customCreds));
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = credsPath;

    const container = new ServiceContainer();
    expect(() => (container as unknown as { loadConfig: () => unknown }).loadConfig()).toThrow(
      /Configuration Supabase manquante ou incomplète/,
    );
  });

  it('should throw clear error when no AI keys are configured in ServiceContainer', () => {
    process.env.SUPABASE_URL = 'https://valid.supabase.co';
    process.env.SUPABASE_KEY = 'valid-key';
    Reflect.deleteProperty(process.env, 'GEMINI_KEY');
    Reflect.deleteProperty(process.env, 'OPENAI_KEY');
    Reflect.deleteProperty(process.env, 'HF_TOKEN');
    Reflect.deleteProperty(process.env, 'HUGGINGFACE_KEY');

    const customCreds = {
      supabase: { url: 'https://valid.supabase.co', key: 'valid-key' },
      familles_ia: { gemini: 'VOTRE_CLE_GEMINI' },
    };
    const credsPath = join(env.tempDir, 'no_ai_creds.json');
    safeWriteFileSync(credsPath, JSON.stringify(customCreds));
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = credsPath;

    const container = new ServiceContainer();
    expect(() => (container as unknown as { loadConfig: () => unknown }).loadConfig()).toThrow(
      /Aucune clé API d'IA configurée/,
    );
    expect(() =>
      (container as unknown as { loadConfig: (mode?: string) => unknown }).loadConfig('minimal'),
    ).not.toThrow();
  });

  it('should initialize successfully in minimal mode without AI keys configured in ServiceContainer', async () => {
    Reflect.deleteProperty(process.env, 'GEMINI_KEY');
    Reflect.deleteProperty(process.env, 'OPENAI_KEY');
    Reflect.deleteProperty(process.env, 'ANTHROPIC_KEY');
    Reflect.deleteProperty(process.env, 'GROQ_KEY');
    Reflect.deleteProperty(process.env, 'MISTRAL_KEY');
    Reflect.deleteProperty(process.env, 'HF_TOKEN');
    Reflect.deleteProperty(process.env, 'HUGGINGFACE_KEY');

    const customCreds = {
      supabase: { url: 'https://custom.supabase.co', key: 'custom-key' },
      familles_ia: { gemini: 'VOTRE_CLE_GEMINI' },
    };
    const credsPath = join(env.tempDir, 'minimal_no_ai_creds.json');
    safeWriteFileSync(credsPath, JSON.stringify(customCreds));
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = credsPath;

    const { adminService } = await import('../../../services/adminService.js');
    const adminInitSpy = jest.spyOn(adminService, 'init').mockResolvedValue(undefined);
    try {
      const container = new ServiceContainer();
      await container.init({ mode: 'minimal' });
      expect(container.has('supabase')).toBe(true);
      expect(container.has('redis')).toBe(true);
      expect(container.has('adminService')).toBe(true);
      expect(container.has('memory')).toBe(false);
    } finally {
      adminInitSpy.mockRestore();
    }
  });

  it('should log clear message and continue when Redis is absent in ServiceContainer', () => {
    Reflect.deleteProperty(process.env, 'REDIS_URL');
    process.env.SUPABASE_URL = 'https://valid.supabase.co';
    process.env.SUPABASE_KEY = 'valid-key';
    process.env.GEMINI_KEY = 'test-gemini-key-val';

    const customCreds = {
      supabase: { url: 'https://valid.supabase.co', key: 'valid-key' },
      familles_ia: { gemini: 'test-gemini-key-val' },
    };
    const credsPath = join(env.tempDir, 'no_redis_creds.json');
    safeWriteFileSync(credsPath, JSON.stringify(customCreds));
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = credsPath;

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const container = new ServiceContainer();
      const config = (
        container as unknown as { loadConfig: () => { credentials: unknown } }
      ).loadConfig();
      expect(config.credentials).toBeDefined();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Redis non configuré : poursuite du démarrage en mode mémoire local',
        ),
      );
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('Config Consumers Migration - AI Provider Key Resolution (#134)', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = setupTestEnv();
  });

  afterEach(() => {
    teardownTestEnv(env);
  });

  it('should count AI keys with unmasked HF_TOKEN when credentials contains placeholder', () => {
    process.env.HF_TOKEN = 'hf_valid_test_token_12345';
    const count = countConfiguredAiKeys({
      huggingface: 'VOTRE_CLE_HF',
      gemini: 'VOTRE_CLE_GEMINI',
    });
    expect(count).toBe(1);
  });

  it('should count HF_TOKEN in familles_ia even when no environment variable is present', () => {
    Reflect.deleteProperty(process.env, 'HF_TOKEN');
    Reflect.deleteProperty(process.env, 'HUGGINGFACE_KEY');
    Reflect.deleteProperty(process.env, 'GEMINI_KEY');

    const count = countConfiguredAiKeys({
      HF_TOKEN: 'hf_standalone_token_9999',
    });
    expect(count).toBe(1);
  });

  it('should count AI keys case-insensitively and handle custom providers', () => {
    Reflect.deleteProperty(process.env, 'OPENAI_KEY');
    Reflect.deleteProperty(process.env, 'GEMINI_KEY');

    const count = countConfiguredAiKeys({
      OpenAI: 'sk-case-insensitive-test',
      CustomProvider: 'custom-secret-key-123',
      gemini: 'YOUR_GEMINI_KEY',
    });
    expect(count).toBe(2);
    expect(countConfiguredAiKeys(undefined)).toBe(0);
    expect(countConfiguredAiKeys(null as unknown as undefined)).toBe(0);
  });

  it('should normalize mixed-case provider keys in familles_ia so consumers can access them', () => {
    expect(normalizeFamillesIa(undefined)).toBeUndefined();
    expect(normalizeFamillesIa(null as unknown as undefined)).toBeUndefined();
    expect(normalizeFamillesIa({ invalidVal: 123 as unknown as string })).toEqual({});

    const customCreds = {
      supabase: { url: 'https://custom.supabase.co', key: 'custom-key' },
      familles_ia: { OpenAI: 'sk-test-openai-key-case', Gemini: 'gemini-key-val' },
    };
    const credsPath = join(env.tempDir, 'mixed_case_creds.json');
    safeWriteFileSync(credsPath, JSON.stringify(customCreds));
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = credsPath;

    const container = new ServiceContainer();
    const config = (
      container as unknown as {
        loadConfig: () => { credentials: { familles_ia: Record<string, string> } };
      }
    ).loadConfig();

    expect(config.credentials.familles_ia.openai).toBe('sk-test-openai-key-case');
    expect(config.credentials.familles_ia.OpenAI).toBe('sk-test-openai-key-case');
    expect(config.credentials.familles_ia.gemini).toBe('gemini-key-val');
  });

  it('should invoke registerBaseServices with loaded credentials during _doInit', async () => {
    const container = new ServiceContainer();
    const mockCreds = {
      supabase: { url: 'https://test.supabase.co', key: 'key' },
      familles_ia: { gemini: 'key' },
    };
    (container as unknown as { loadConfig: () => unknown }).loadConfig = () => ({
      credentials: mockCreds,
      modelsConfig: { reglages_generaux: { familles_prioritaires: [] } },
    });
    const registerBaseSpy = jest
      .spyOn(
        container as unknown as { registerBaseServices: (c?: unknown) => Promise<void> },
        'registerBaseServices',
      )
      .mockResolvedValue(undefined);
    const mockContainer = container as unknown as Record<string, unknown>;
    mockContainer.registerCoreMemoriesAndConsciousness = jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);
    mockContainer.registerEmbeddingService = jest.fn<() => void>();
    mockContainer.registerVoiceServices = jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);
    mockContainer.registerMemoryServices = jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);
    mockContainer.registerLiveAndDreamServices = jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);
    mockContainer.registerBrowserAndProviderRouter = jest
      .fn<() => Promise<void>>()
      .mockResolvedValue(undefined);

    await (container as unknown as { _doInit: (opts: { mode: 'full' }) => Promise<void> })._doInit({
      mode: 'full',
    });
    expect(registerBaseSpy).toHaveBeenCalledWith(mockCreds);

    // Re-invoquer _doInit lorsque container est déjà initialisé pour valider le court-circuit
    await (container as unknown as { _doInit: (opts: { mode: 'full' }) => Promise<void> })._doInit({
      mode: 'full',
    });
    expect(registerBaseSpy).toHaveBeenCalledTimes(1);
  });
});

describe('Config Consumers Migration - Supabase & Redis Resolution (#134)', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = setupTestEnv();
  });

  afterEach(() => {
    teardownTestEnv(env);
  });

  it('should keep redis unmocked when Redis IS configured in ServiceContainer', async () => {
    const { adminService } = await import('../../../services/adminService.js');
    const adminInitSpy = jest.spyOn(adminService, 'init').mockResolvedValue(undefined);
    try {
      const container = new ServiceContainer();
      await (
        container as unknown as {
          registerBaseServices: (creds?: unknown) => Promise<void>;
        }
      ).registerBaseServices({
        redis: { url: 'redis://localhost:6379' },
      });
      expect(redis).toBeDefined();
      // Prouve factuellement que switchToMock n'a pas été appelé :
      // les propriétés propres isOpen/isReady ne sont pas définies et valent false
      expect(Object.prototype.hasOwnProperty.call(redis, 'isOpen')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(redis, 'isReady')).toBe(false);
      expect(redis.isOpen).toBe(false);
      expect(redis.isReady).toBe(false);
    } finally {
      adminInitSpy.mockRestore();
    }
  });

  it('should activate switchToMock on redis when Redis is not configured in ServiceContainer', async () => {
    Reflect.deleteProperty(process.env, 'REDIS_URL');
    const { adminService } = await import('../../../services/adminService.js');
    const adminInitSpy = jest.spyOn(adminService, 'init').mockResolvedValue(undefined);
    try {
      const container = new ServiceContainer();
      await (
        container as unknown as {
          registerBaseServices: (creds?: unknown) => Promise<void>;
        }
      ).registerBaseServices({});
      // Prouve que switchToMock a été activé :
      expect(Object.prototype.hasOwnProperty.call(redis, 'isOpen')).toBe(true);
      expect(redis.isReady).toBe(true);
      expect(redis.isOpen).toBe(true);
    } finally {
      // Nettoyage et restauration de redis à son état réel non mocké
      delete (redis as unknown as Record<string, unknown>).isOpen;
      delete (redis as unknown as Record<string, unknown>).isReady;
      delete (redis as unknown as Record<string, unknown>).multi;
      adminInitSpy.mockRestore();
    }
  });

  it('should correctly evaluate resolveSupabaseCredentials and isRedisConfigured', () => {
    Reflect.deleteProperty(process.env, 'SUPABASE_URL');
    Reflect.deleteProperty(process.env, 'SUPABASE_KEY');
    Reflect.deleteProperty(process.env, 'SUPABASE_SERVICE_ROLE_KEY');
    Reflect.deleteProperty(process.env, 'REDIS_URL');

    expect(resolveSupabaseCredentials(undefined)).toBeNull();
    expect(
      resolveSupabaseCredentials({
        supabase: { url: 'https://valid.co', key: 'key1' },
      }),
    ).toEqual({ url: 'https://valid.co', key: 'key1' });

    expect(
      resolveSupabaseCredentials({
        supabase: {
          project_url: 'https://project-url.supabase.co',
          service_role_key: 'role-key-123',
        },
      }),
    ).toEqual({ url: 'https://project-url.supabase.co', key: 'role-key-123' });

    expect(
      resolveSupabaseCredentials({
        supabase: { url: 'https://VOTRE_PROJET.supabase.co', key: 'key1' },
      }),
    ).toBeNull();

    expect(
      resolveSupabaseCredentials({
        supabase: { url: '', key: 'key1' },
      }),
    ).toBeNull();
    expect(
      resolveSupabaseCredentials({
        supabase: { url: '   ', key: 'key1' },
      }),
    ).toBeNull();
    expect(
      resolveSupabaseCredentials({
        supabase: { url: 'https://valid.co', key: 'DUMMY' },
      }),
    ).toBeNull();
    expect(
      resolveSupabaseCredentials({
        supabase: { url: 'https://valid.co', key: '${SUPABASE_KEY}' },
      }),
    ).toBeNull();

    expect(isValidCredentialString('')).toBe(false);
    expect(isValidCredentialString('""')).toBe(false);
    expect(isValidCredentialString('   ')).toBe(false);
    expect(isValidCredentialString(undefined)).toBe(false);

    process.env.TEST_SB_URL = 'https://resolved-env.supabase.co';
    process.env.TEST_SB_KEY = 'test_key';
    expect(
      resolveSupabaseCredentials({
        supabase: { url: 'TEST_SB_URL', key: 'TEST_SB_KEY' },
      }),
    ).toEqual({ url: 'https://resolved-env.supabase.co', key: 'test_key' });
    Reflect.deleteProperty(process.env, 'TEST_SB_URL');
    Reflect.deleteProperty(process.env, 'TEST_SB_KEY');

    process.env.EMPTY_SB_VAL = '';
    expect(
      resolveSupabaseCredentials({
        supabase: { url: 'https://valid.supabase.co', key: 'EMPTY_SB_VAL' },
      }),
    ).toBeNull();

    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fallback-service-role-key';
    expect(
      resolveSupabaseCredentials({
        supabase: { url: 'https://valid.supabase.co', key: 'EMPTY_SB_VAL' },
      }),
    ).toEqual({
      url: 'https://valid.supabase.co',
      key: 'fallback-service-role-key',
    });
    Reflect.deleteProperty(process.env, 'SUPABASE_SERVICE_ROLE_KEY');

    expect(
      resolveSupabaseCredentials({
        supabase: { url: 'EMPTY_SB_VAL', key: 'EMPTY_SB_VAL' },
      }),
    ).toBeNull();
    Reflect.deleteProperty(process.env, 'EMPTY_SB_VAL');

    process.env.SUPABASE_URL = 'https://env-sb.supabase.co';
    process.env.SUPABASE_KEY = 'test_key';
    expect(resolveSupabaseCredentials({ familles_ia: { gemini: 'test' } })).toEqual({
      url: 'https://env-sb.supabase.co',
      key: 'test_key',
    });
    Reflect.deleteProperty(process.env, 'SUPABASE_URL');
    Reflect.deleteProperty(process.env, 'SUPABASE_KEY');

    expect(isRedisConfigured(undefined)).toBe(false);
    expect(isRedisConfigured({ redis: { url: 'redis://localhost:6379' } })).toBe(true);
    // Quoted URLs
    expect(isRedisConfigured({ redis: { url: '"redis://localhost:6379"' } })).toBe(true);
    expect(isRedisConfigured({ redis: { url: "'rediss://localhost:6379'" } })).toBe(true);
    // URL with username like your_app
    expect(
      isRedisConfigured({
        redis: { url: 'rediss://your_app:secret@redis.example.com:6379' },
      }),
    ).toBe(true);
    // Placeholders
    expect(isRedisConfigured({ redis: { url: 'redis://YOUR_HOST:6379' } })).toBe(false);
    expect(isRedisConfigured({ redis: { url: 'redis://VOTRE_HOTE:6379' } })).toBe(false);
    expect(isRedisConfigured({ redis: { url: '' } })).toBe(false);
    expect(isRedisConfigured({ redis: { url: '   ' } })).toBe(false);
    expect(isRedisConfigured({ redis: { url: 'DUMMY' } })).toBe(false);

    process.env.EMPTY_REDIS_VAR = '';
    expect(
      isRedisConfigured({
        redis: { url: 'EMPTY_REDIS_VAR' },
      }),
    ).toBe(false);
    Reflect.deleteProperty(process.env, 'EMPTY_REDIS_VAR');

    process.env.REDIS_URL = 'redis://env-redis-host:6379';
    expect(
      isRedisConfigured({
        redis: { url: 'REDIS_VAR_NOT_FOUND' },
      }),
    ).toBe(true);
    Reflect.deleteProperty(process.env, 'REDIS_URL');
  });
});

describe('Config Consumers Migration - Adapters, Write Confinement & Resilience (#134)', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = setupTestEnv();
  });

  afterEach(() => {
    teardownTestEnv(env);
  });

  it('should initialize HuggingFace client when valid HF_TOKEN is in credentials', () => {
    const customCreds = {
      familles_ia: {
        HF_TOKEN: 'mock-hf-test-valid-token-12345',
      },
    };
    const credsPath = join(env.tempDir, 'hf_creds.json');
    safeWriteFileSync(credsPath, JSON.stringify(customCreds));
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = credsPath;

    const adapter = new HuggingFaceAdapter();
    expect(adapter.client).not.toBeNull();
    expect(adapter.name).toBe('huggingface');
  });

  it('should initialize HuggingFace client when credentials use template format "huggingface": "${HUGGINGFACE_KEY}"', () => {
    const customCreds = {
      familles_ia: {
        huggingface: '${HUGGINGFACE_KEY}',
      },
    };
    const credsPath = join(env.tempDir, 'hf_creds_template.json');
    safeWriteFileSync(credsPath, JSON.stringify(customCreds));
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = credsPath;
    process.env.HUGGINGFACE_KEY = 'mock-hf-resolved-token-abc';

    const adapter = new HuggingFaceAdapter();
    expect(adapter.client).not.toBeNull();
  });

  it('should leave HuggingFace client as null when HF_TOKEN is placeholder or missing', () => {
    const customCreds = {
      familles_ia: {
        HF_TOKEN: 'VOTRE_CLE_HF',
      },
    };
    const credsPath = join(env.tempDir, 'hf_creds_placeholder.json');
    safeWriteFileSync(credsPath, JSON.stringify(customCreds));
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = credsPath;

    const adapter = new HuggingFaceAdapter();
    expect(adapter.client).toBeNull();
  });

  it('should prioritize valid huggingface key over placeholder HF_TOKEN', () => {
    const customCreds = {
      familles_ia: {
        HF_TOKEN: 'VOTRE_CLE_HF',
        huggingface: 'mock-valid-hf-token-prioritized',
      },
    };
    const credsPath = join(env.tempDir, 'hf_creds_precedence.json');
    safeWriteFileSync(credsPath, JSON.stringify(customCreds));
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = credsPath;

    const adapter = new HuggingFaceAdapter();
    expect(adapter.client).not.toBeNull();
  });

  it('should handle corrupted credentials.json gracefully and fallback to env in HuggingFace adapter', () => {
    const corruptCredsPath = join(env.tempDir, 'corrupt_hf_creds.json');
    safeWriteFileSync(corruptCredsPath, '{ invalid json');
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = corruptCredsPath;
    process.env.HF_TOKEN = 'mock-env-hf-token-fallback';

    const adapter = new HuggingFaceAdapter();
    expect(adapter.client).not.toBeNull();
  });

  it('should read transcription mode and redirect write to user directory in Admin plugin', async () => {
    const userHome = join(env.tempDir, 'fake_home');
    process.env.HIVE_HOME_DIR = userHome;

    const statusRes = await adminPlugin._setVoiceMode('status');
    expect(statusRes.success).toBe(true);
    expect(statusRes.message).toContain('Current transcription mode');

    const writeRes = await adminPlugin._setVoiceMode('full');
    expect(writeRes.success).toBe(true);

    const userConfigPath = join(userHome, 'config', 'config.json');
    expect(safeExistsSync(userConfigPath)).toBe(true);

    const saved = JSON.parse(safeReadFileSync(userConfigPath, 'utf-8'));
    expect(saved.voice_transcription?.mode).toBe('full');
  });

  it('should write directly to custom configPath when not a template in Admin plugin', async () => {
    const customConfigDir = join(env.tempDir, 'custom_cfg_dir');
    safeMkdirSync(customConfigDir, { recursive: true });
    const customConfigPath = join(customConfigDir, 'config.json');
    safeWriteFileSync(
      customConfigPath,
      JSON.stringify({ voice_transcription: { mode: 'restricted' } }, null, 2),
    );
    process.env.HIVE_CONFIG_CONFIG_JSON = customConfigPath;

    const res = await adminPlugin._setVoiceMode('full');
    expect(res.success).toBe(true);

    const saved = JSON.parse(safeReadFileSync(customConfigPath, 'utf-8'));
    expect(saved.voice_transcription?.mode).toBe('full');
  });

  it('should redirect writes away from defaults or legacy template to user config directory', () => {
    const userHome = join(env.tempDir, 'user_home');
    process.env.HIVE_HOME_DIR = userHome;

    const configPath = resolveConfigPath('models_config.json');
    const isReadOnlyOrTemplate = isTemplateOrReadOnlyConfig(configPath);

    expect(isReadOnlyOrTemplate).toBe(true);

    const targetWritePath = isReadOnlyOrTemplate
      ? join(resolveUserConfigDir(), 'models_config.json')
      : configPath;

    expect(targetWritePath).toBe(join(userHome, 'config', 'models_config.json'));
  });

  function verifyGraphMemoryFallbackWithWarning(): void {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const embeddings = initGraphMemoryEmbeddings();
      expect(embeddings).not.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[GraphMemory] Impossible de lire credentials.json, repli sur variables d’environnement:',
        ),
        expect.any(String),
      );
    } finally {
      warnSpy.mockRestore();
    }
  }

  it('should initialize embeddings from environment variables when credentials.json is missing in GraphMemory', () => {
    process.env.HIVE_LEGACY_CONFIG_DIR = env.tempDir;
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = join(env.tempDir, 'non_existent_creds.json');
    process.env.GEMINI_KEY = 'mock-gemini-key-12345';

    verifyGraphMemoryFallbackWithWarning();
  });

  it('should handle corrupted credentials.json gracefully and fallback to env in GraphMemory', () => {
    process.env.HIVE_LEGACY_CONFIG_DIR = env.tempDir;
    const corruptCredsPath = join(env.tempDir, 'corrupt_graph_creds.json');
    safeWriteFileSync(corruptCredsPath, '{ corrupt json');
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = corruptCredsPath;
    process.env.GEMINI_KEY = 'mock-gemini-key-fallback';

    verifyGraphMemoryFallbackWithWarning();
  });

  it('should return null without throwing when neither credentials nor env keys are present in GraphMemory', () => {
    process.env.HIVE_LEGACY_CONFIG_DIR = env.tempDir;
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = join(env.tempDir, 'non_existent_creds.json');
    Reflect.deleteProperty(process.env, 'GEMINI_KEY');
    Reflect.deleteProperty(process.env, 'OPENAI_KEY');

    const embeddings = initGraphMemoryEmbeddings();
    expect(embeddings).toBeNull();
  });
});

describe('Config Consumers Migration - Path Containment Helpers (#134)', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = setupTestEnv();
  });

  afterEach(() => {
    teardownTestEnv(env);
  });

  it('should correctly detect if a path is inside a parent directory with isPathInside', () => {
    const parent = join(resolveUserConfigDir(), 'parent_scope');
    expect(isPathInside(parent, join(parent, 'sub', 'file.json'))).toBe(true);
    expect(isPathInside(parent, join(parent, 'file.json'))).toBe(true);
    expect(isPathInside(parent, parent)).toBe(false);
    expect(isPathInside(parent, `${parent}_sibling/file.json`)).toBe(false);
    expect(isPathInside(parent, join(resolveUserConfigDir(), 'other', 'file.json'))).toBe(false);
  });

  it('should accurately identify template/read-only configs with isTemplateOrReadOnlyConfig', () => {
    const defaultsDir = resolveDefaultsConfigDir();
    const legacyDir = resolveLegacyConfigDir();

    expect(isTemplateOrReadOnlyConfig(join(defaultsDir, 'models_config.json'))).toBe(true);
    expect(isTemplateOrReadOnlyConfig(join(legacyDir, 'models_config.json'))).toBe(true);
    expect(isTemplateOrReadOnlyConfig(join(resolveUserConfigDir(), 'models_config.json'))).toBe(
      false,
    );
    expect(isTemplateOrReadOnlyConfig('/custom/unrelated/config.json')).toBe(false);
  });

  it('should accurately detect symlinks pointing to template or read-only configs', () => {
    const defaultsDir = resolveDefaultsConfigDir();
    const targetFile = join(defaultsDir, 'models_config.json');
    const symlinkPath = join(env.tempDir, 'symlink_to_template.json');

    safeSymlinkSync(targetFile, symlinkPath);

    expect(isPathInside(defaultsDir, symlinkPath)).toBe(true);
    expect(isTemplateOrReadOnlyConfig(symlinkPath)).toBe(true);
  });

  it('should protect embedded defaults in isTemplateOrReadOnlyConfig even when HIVE_DEFAULTS_CONFIG_DIR is overridden', () => {
    Reflect.deleteProperty(process.env, 'HIVE_DEFAULTS_CONFIG_DIR');
    const realEmbeddedDefaultsDir = resolveDefaultsConfigDir();
    const realEmbeddedModelConfig = join(realEmbeddedDefaultsDir, 'models_config.json');

    const customDefaultsDir = join(env.tempDir, 'custom_defaults');
    safeMkdirSync(customDefaultsDir, { recursive: true });
    process.env.HIVE_DEFAULTS_CONFIG_DIR = customDefaultsDir;

    // Le fichier réel des defaults embarqués doit rester protégé
    expect(isTemplateOrReadOnlyConfig(realEmbeddedModelConfig)).toBe(true);

    // Le fichier dans le répertoire personnalisé surchargé doit également être protégé
    const customModelConfig = join(customDefaultsDir, 'models_config.json');
    safeWriteFileSync(customModelConfig, '{}');
    expect(isTemplateOrReadOnlyConfig(customModelConfig)).toBe(true);
  });

  it('should handle filesystem resolution errors gracefully in isPathInside', () => {
    expect(isPathInside(env.tempDir, join(env.tempDir, '\0test.json'))).toBe(true);
    expect(isPathInside(null as unknown as string, env.tempDir)).toBe(false);
  });
});

describe('Supabase Client normalization & dynamic reinitialization', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = setupTestEnv();
  });

  afterEach(() => {
    teardownTestEnv(env);
  });

  it('should strip quotes and instantiate client with initSupabaseClient', () => {
    const client = initSupabaseClient('"https://test.supabase.co"', '"secret-key"');
    expect(client).not.toBeNull();

    const singleQuoteClient = initSupabaseClient("'https://single.supabase.co'", "'secret-key'");
    expect(singleQuoteClient).not.toBeNull();

    const unquotedClient = initSupabaseClient('https://unquoted.supabase.co', 'secret-key');
    expect(unquotedClient).not.toBeNull();
  });

  it('should resolve environment variables with or without quotes in initSupabaseClient', () => {
    process.env.TEST_CUSTOM_SB_URL = '"https://env-quoted.supabase.co"';
    process.env.TEST_CUSTOM_SB_KEY = "'env-key-quoted'";

    const client = initSupabaseClient('TEST_CUSTOM_SB_URL', 'TEST_CUSTOM_SB_KEY');
    expect(client).not.toBeNull();

    Reflect.deleteProperty(process.env, 'TEST_CUSTOM_SB_URL');
    Reflect.deleteProperty(process.env, 'TEST_CUSTOM_SB_KEY');
  });

  it('should fallback to process.env.SUPABASE_URL and process.env.SUPABASE_SERVICE_ROLE_KEY', () => {
    process.env.SUPABASE_URL = '"https://fallback.supabase.co"';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '"fallback-role-key"';

    const client = initSupabaseClient();
    expect(client).not.toBeNull();
  });

  it('should return null when URL is placeholder, invalid or missing in initSupabaseClient', () => {
    Reflect.deleteProperty(process.env, 'SUPABASE_URL');
    Reflect.deleteProperty(process.env, 'SUPABASE_SERVICE_ROLE_KEY');
    Reflect.deleteProperty(process.env, 'SUPABASE_KEY');

    expect(initSupabaseClient('"https://VOTRE_PROJET.supabase.co"', 'key')).toBeNull();
    expect(initSupabaseClient('not-a-valid-http-url', 'key')).toBeNull();
    expect(initSupabaseClient(undefined, undefined)).toBeNull();
  });

  it('should reinitialize db.client dynamically via db.reinit', () => {
    const client = db.reinit('"https://reinit.supabase.co"', '"reinit-key"');
    expect(client).not.toBeNull();
    expect(db.client).toBe(client);

    Reflect.deleteProperty(process.env, 'SUPABASE_URL');
    Reflect.deleteProperty(process.env, 'SUPABASE_SERVICE_ROLE_KEY');
    Reflect.deleteProperty(process.env, 'SUPABASE_KEY');

    const nullClient = db.reinit(undefined, undefined);
    expect(nullClient).toBeNull();
    expect(db.client).toBeNull();
  });

  it('should reinitialize db in ServiceContainer.registerBaseServices when credentials.supabase.url is present', async () => {
    const customCreds = {
      supabase: { url: '"https://container-quoted.supabase.co"', key: '"quoted-key"' },
      familles_ia: { gemini: 'VOTRE_CLE_GEMINI' },
    };
    const credsPath = join(env.tempDir, 'quoted_sb_creds.json');
    safeWriteFileSync(credsPath, JSON.stringify(customCreds));
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = credsPath;

    const { adminService } = await import('../../../services/adminService.js');
    const adminInitSpy = jest.spyOn(adminService, 'init').mockResolvedValue(undefined);
    try {
      const container = new ServiceContainer();
      await container.init({ mode: 'minimal' });
      const registeredDb = container.get<{ client: unknown }>('supabase');
      expect(registeredDb.client).not.toBeNull();
    } finally {
      adminInitSpy.mockRestore();
    }
  });

  it('should not call db.reinit when credentials.supabase.url is absent in registerBaseServices', async () => {
    const reinitSpy = jest.spyOn(db, 'reinit');
    const { adminService } = await import('../../../services/adminService.js');
    const adminInitSpy = jest.spyOn(adminService, 'init').mockResolvedValue(undefined);
    try {
      const container = new ServiceContainer();
      await (
        container as unknown as { registerBaseServices: (c?: unknown) => Promise<void> }
      ).registerBaseServices({});
      expect(reinitSpy).not.toHaveBeenCalled();
    } finally {
      reinitSpy.mockRestore();
      adminInitSpy.mockRestore();
    }
  });
});

describe('Container Env & Model Resilience', () => {
  let env: TestEnvironment;

  beforeEach(() => {
    env = setupTestEnv();
  });

  afterEach(() => {
    teardownTestEnv(env);
  });

  it('should initialize successfully in pure environment variable deployment without credentials.json', async () => {
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = join(env.tempDir, 'non_existent_credentials.json');
    process.env.SUPABASE_URL = 'https://pure-env.supabase.co';
    process.env.SUPABASE_KEY = 'pure-env-service-key-xyz';
    process.env.GEMINI_KEY = 'mock-pure-env-gemini-key';

    const { adminService } = await import('../../../services/adminService.js');
    const adminInitSpy = jest.spyOn(adminService, 'init').mockResolvedValue(undefined);
    try {
      const container = new ServiceContainer();
      await container.init({ mode: 'minimal' });
      expect(container.has('supabase')).toBe(true);
      expect(container.has('config')).toBe(true);
    } finally {
      adminInitSpy.mockRestore();
    }
  });

  it('should resolve placeholder keys like VOTRE_CLE_GEMINI to process.env.GEMINI_KEY in ServiceContainer', () => {
    const customCreds = {
      supabase: { url: 'https://test-placeholder.supabase.co', key: 'service-key-valid-123' },
      familles_ia: { gemini: 'VOTRE_CLE_GEMINI' },
    };
    const credsPath = join(env.tempDir, 'placeholder_creds.json');
    safeWriteFileSync(credsPath, JSON.stringify(customCreds));
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = credsPath;
    process.env.GEMINI_KEY = 'real-env-gemini-key-from-environment';

    const container = new ServiceContainer();
    const config = (
      container as unknown as {
        loadConfig: (mode?: string) => { credentials: { familles_ia?: Record<string, string> } };
      }
    ).loadConfig('full');
    expect(config.credentials.familles_ia?.gemini).toBe('VOTRE_CLE_GEMINI');
    expect(countConfiguredAiKeys(config.credentials.familles_ia)).toBeGreaterThanOrEqual(1);
  });

  it('should validate secret strings and reject placeholders when isUrl is false', () => {
    expect(isValidCredentialString('VOTRE_CLE_123')).toBe(false);
    expect(isValidCredentialString('YOUR_SECRET_TOKEN')).toBe(false);
    expect(isValidCredentialString('sk-ant-api-key-12345')).toBe(true);
  });

  it('should exercise registerEmbeddingService, registerMinimaxVoice, and registerGroqSTT branches', async () => {
    const container = new ServiceContainer();
    const mockModelsConfig = {
      reglages_generaux: {
        embeddings: {
          primary: { model: 'gemini-embedding-001', dimensions: 768 },
        },
      },
      voice_provider: {
        minimax_config: { voice_id: 'test' },
        stt_models: [{ model: 'whisper-large' }],
      },
    };

    const containerAny = container as unknown as {
      registerEmbeddingService: (c: unknown, m: unknown) => void;
      registerMinimaxVoice: (c: unknown, m: unknown) => Promise<void>;
      registerGroqSTT: (c: unknown, m: unknown) => Promise<void>;
      loadConfig: (mode?: string) => unknown;
    };

    containerAny.registerEmbeddingService(
      { familles_ia: { gemini: 'test-gemini-key', openai: 'test-openai-key' } },
      mockModelsConfig,
    );
    expect(container.has('embeddings')).toBe(true);

    containerAny.registerEmbeddingService({ familles_ia: {} }, mockModelsConfig);
    expect(container.has('embeddings')).toBe(true);

    await containerAny.registerMinimaxVoice(
      { familles_ia: { minimax: 'test-minimax-key' } },
      mockModelsConfig,
    );
    expect(container.has('voiceService')).toBe(true);

    await containerAny.registerMinimaxVoice({ familles_ia: {} }, mockModelsConfig);
    expect(container.has('voiceService')).toBe(true);

    await containerAny.registerGroqSTT(
      { familles_ia: { groq: 'test-groq-key' } },
      mockModelsConfig,
    );
    expect(container.has('transcriptionService')).toBe(true);

    await containerAny.registerGroqSTT({ familles_ia: {} }, mockModelsConfig);
    expect(container.has('transcriptionService')).toBe(true);

    process.env.HIVE_CONFIG_MODELS_CONFIG_JSON = join(env.tempDir, 'non_existent_models.json');
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = join(env.tempDir, 'non_existent_creds.json');
    expect(() => containerAny.loadConfig('minimal')).toThrow();
  });
});

describe('Supabase Validation & Group Resolution', () => {
  it('should strictly reject empty keys and placeholders in initSupabaseClient', () => {
    expect(initSupabaseClient('https://test.supabase.co', '')).toBeNull();
    expect(initSupabaseClient('https://test.supabase.co', '   ')).toBeNull();
    expect(initSupabaseClient('https://test.supabase.co', 'VOTRE_CLE_SERVICE')).toBeNull();
    expect(initSupabaseClient('https://test.supabase.co', 'YOUR_KEY_HERE')).toBeNull();
    expect(initSupabaseClient('https://test.supabase.co', 'valid-secret-key-123')).not.toBeNull();
  });

  it('should validate all branches of isSupabaseUrlValid and isSupabaseKeyValid', () => {
    expect(isSupabaseUrlValid(undefined)).toBe(false);
    expect(isSupabaseUrlValid('')).toBe(false);
    expect(isSupabaseUrlValid('ftp://example.com')).toBe(false);
    expect(isSupabaseUrlValid('https://VOTRE_PROJET.supabase.co')).toBe(false);
    expect(isSupabaseUrlValid('https://YOUR_PROJECT.supabase.co')).toBe(false);
    expect(isSupabaseUrlValid('DUMMY')).toBe(false);
    expect(isSupabaseUrlValid('PLACEHOLDER')).toBe(false);
    expect(isSupabaseUrlValid('https://valid.supabase.co')).toBe(true);

    expect(isSupabaseKeyValid(undefined)).toBe(false);
    expect(isSupabaseKeyValid('')).toBe(false);
    expect(isSupabaseKeyValid('   ')).toBe(false);
    expect(isSupabaseKeyValid('VOTRE_CLE_ICI')).toBe(false);
    expect(isSupabaseKeyValid('YOUR_KEY_HERE')).toBe(false);
    expect(isSupabaseKeyValid('key_with_VOTRE_CLE_inside')).toBe(false);
    expect(isSupabaseKeyValid('key_with_YOUR_KEY_inside')).toBe(false);
    expect(isSupabaseKeyValid('DUMMY')).toBe(false);
    expect(isSupabaseKeyValid('PLACEHOLDER')).toBe(false);
    expect(isSupabaseKeyValid('UNDEFINED')).toBe(false);
    expect(isSupabaseKeyValid('NULL')).toBe(false);
    expect(isSupabaseKeyValid('valid_service_role_key_12345')).toBe(true);
  });

  it('should resolve environment variables and handle unquoted or missing values', () => {
    expect(resolveEnvOrVal(undefined)).toBeUndefined();
    expect(resolveEnvOrVal('')).toBeUndefined();

    process.env.TEST_EXISTING_ENV = '"https://quoted-env.supabase.co"';
    expect(resolveEnvOrVal('TEST_EXISTING_ENV')).toBe('https://quoted-env.supabase.co');

    process.env.TEST_EMPTY_ENV = '';
    expect(resolveEnvOrVal('TEST_EMPTY_ENV')).toBe('TEST_EMPTY_ENV');

    expect(resolveEnvOrVal('NON_EXISTENT_VAR')).toBe('NON_EXISTENT_VAR');
    expect(resolveEnvOrVal('"literal-string"')).toBe('literal-string');

    Reflect.deleteProperty(process.env, 'TEST_EXISTING_ENV');
    Reflect.deleteProperty(process.env, 'TEST_EMPTY_ENV');
  });

  it('should correctly classify groups and users with determineIfGroup', () => {
    expect(determineIfGroup('12345@g.us', true)).toBe(true);
    expect(determineIfGroup('12345@G.US', true)).toBe(true);
    expect(determineIfGroup('33612345678@s.whatsapp.net', true)).toBe(false);

    expect(determineIfGroup('123e4567-e89b-12d3-a456-426614174000', false)).toBe(false);
    expect(determineIfGroup('user-12345', false)).toBe(false);
    expect(determineIfGroup('user_bob', false)).toBe(false);

    expect(determineIfGroup('chat_general', false)).toBe(true);
    expect(determineIfGroup('group_alpha', false)).toBe(true);
    expect(determineIfGroup('channel_dev', false)).toBe(true);
    expect(determineIfGroup('custom-channel-id', false)).toBe(true);

    expect(determineIfGroup('simpleuser', false)).toBe(false);
  });

  it('should not classify UUIDs or usernames with hyphens as groups in resolveContextFromLegacyId', async () => {
    const resolveUserSpy = jest.spyOn(db, 'resolveUser').mockResolvedValue('user-uuid-123');
    const resolveGroupSpy = jest.spyOn(db, 'resolveGroup').mockResolvedValue('group-uuid-456');

    try {
      const userContext = await db.resolveContextFromLegacyId('user-42');
      expect(resolveUserSpy).toHaveBeenCalledWith('cli', 'user-42');
      expect(resolveGroupSpy).not.toHaveBeenCalled();
      expect(userContext?.type).toBe('user');

      const uuidContext = await db.resolveContextFromLegacyId(
        '123e4567-e89b-12d3-a456-426614174000',
      );
      expect(resolveUserSpy).toHaveBeenCalledWith('cli', '123e4567-e89b-12d3-a456-426614174000');
      expect(uuidContext?.type).toBe('user');

      const groupContext = await db.resolveContextFromLegacyId('group_support');
      expect(resolveGroupSpy).toHaveBeenCalledWith('cli', 'group_support');
      expect(groupContext?.type).toBe('group');
    } finally {
      resolveUserSpy.mockRestore();
      resolveGroupSpy.mockRestore();
    }
  });
});

describe('Supabase User Identity & Concurrency Resolution', () => {
  let originalClient: unknown;

  beforeEach(() => {
    originalClient = db.client;
  });

  afterEach(() => {
    db.reinit(originalClient as unknown as import('@supabase/supabase-js').SupabaseClient);
  });

  it('should return null when client is null', async () => {
    db.reinit(undefined, undefined);
    expect(await db.resolveUser('cli', 'u1')).toBeNull();
    expect(await db.resolveGroup('cli', 'g1')).toBeNull();
  });

  it('should resolve existing user identity from user_identities table', async () => {
    const mockClientExisting = {
      from: (table: string) => {
        if (table === 'user_identities') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { user_id: 'existing-user-uuid' },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      },
    };
    db.reinit(mockClientExisting as unknown as import('@supabase/supabase-js').SupabaseClient);
    const resolvedExisting = await db.resolveUser('discord', 'disc-123');
    expect(resolvedExisting).toBe('existing-user-uuid');
  });

  it('should handle concurrent resolution and clean up losing user record', async () => {
    const deleteConcurrentSpy = jest
      .fn()
      .mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: null })) });
    let maybeSingleCallCount = 0;
    const mockClientConcurrent = {
      from: (table: string) => {
        if (table === 'user_identities') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => {
                    maybeSingleCallCount++;
                    if (maybeSingleCallCount === 1) return { data: null, error: null };
                    return {
                      data: { user_id: 'winner-concurrent-user-uuid' },
                      error: null,
                    };
                  },
                }),
              }),
            }),
            upsert: async () => ({ error: null }),
          };
        }
        if (table === 'users') {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: { id: 'loser-user-uuid' },
                  error: null,
                }),
              }),
            }),
            delete: deleteConcurrentSpy,
          };
        }
        return {};
      },
    };
    db.reinit(mockClientConcurrent as unknown as import('@supabase/supabase-js').SupabaseClient);
    const winnerId = await db.resolveUser('discord', 'concurrent-user');
    expect(winnerId).toBe('winner-concurrent-user-uuid');
    expect(deleteConcurrentSpy).toHaveBeenCalled();
  });

  it('should create fresh user and link identity successfully when no concurrency conflict exists', async () => {
    let singleCallCount = 0;
    const mockClientSuccess = {
      from: (table: string) => {
        if (table === 'user_identities') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => {
                    singleCallCount++;
                    if (singleCallCount === 1) return { data: null, error: null };
                    return { data: { user_id: 'brand-new-user-uuid' }, error: null };
                  },
                }),
              }),
            }),
            upsert: async () => ({ error: null }),
          };
        }
        if (table === 'users') {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: { id: 'brand-new-user-uuid' },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {};
      },
    };
    db.reinit(mockClientSuccess as unknown as import('@supabase/supabase-js').SupabaseClient);
    const createdId = await db.resolveUser('cli', 'fresh-user');
    expect(createdId).toBe('brand-new-user-uuid');
  });
});

describe('Supabase User Failure Cleanup & Group Resolution', () => {
  let originalClient: unknown;

  beforeEach(() => {
    originalClient = db.client;
  });

  afterEach(() => {
    db.reinit(originalClient as unknown as import('@supabase/supabase-js').SupabaseClient);
  });

  it('should return null when user insertion fails', async () => {
    const mockClientUserFail = {
      from: (table: string) => {
        if (table === 'user_identities') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        if (table === 'users') {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: null,
                  error: new Error('DB insert failed'),
                }),
              }),
            }),
          };
        }
        return {};
      },
    };
    db.reinit(mockClientUserFail as unknown as import('@supabase/supabase-js').SupabaseClient);
    expect(await db.resolveUser('telegram', 'tg-456')).toBeNull();
  });

  it('should clean up created user and return null when identity upsert fails', async () => {
    const deleteSpy = jest
      .fn()
      .mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: null })) });
    const mockClientIdentityFail = {
      from: (table: string) => {
        if (table === 'user_identities') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
            upsert: async () => ({ error: new Error('Upsert conflict') }),
          };
        }
        if (table === 'users') {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: { id: 'new-user-to-delete' },
                  error: null,
                }),
              }),
            }),
            delete: deleteSpy,
          };
        }
        return {};
      },
    };
    db.reinit(mockClientIdentityFail as unknown as import('@supabase/supabase-js').SupabaseClient);
    expect(await db.resolveUser('cli', 'cli-fail')).toBeNull();
    expect(deleteSpy).toHaveBeenCalled();
  });

  it('should resolve existing group from groups table', async () => {
    const mockGroupClient = {
      from: (table: string) => {
        if (table === 'groups') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({
                    data: { id: 'existing-group-uuid' },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return {};
      },
    };
    db.reinit(mockGroupClient as unknown as import('@supabase/supabase-js').SupabaseClient);
    expect(await db.resolveGroup('discord', 'disc-grp')).toBe('existing-group-uuid');
  });
});
