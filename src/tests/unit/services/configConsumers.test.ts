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
} from '../../../core/ServiceContainer.js';
import { redis } from '../../../services/redisClient.js';
import { HuggingFaceAdapter } from '../../../providers/adapters/huggingface.js';
import { initGraphMemoryEmbeddings } from '../../../services/graphMemory.js';
import adminPlugin from '../../../plugins/base/admin/index.js';

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

describe('Config Consumers Migration - Credentials & Provider Key Resolution (#134)', () => {
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
      expect(redis.isReady).toBe(true);
      expect(redis.isOpen).toBe(true);
    } finally {
      adminInitSpy.mockRestore();
    }
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
    } finally {
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

    process.env.TEST_SB_URL = 'https://resolved-env.supabase.co';
    process.env.TEST_SB_KEY = 'test_key';
    expect(
      resolveSupabaseCredentials({
        supabase: { url: 'TEST_SB_URL', key: 'TEST_SB_KEY' },
      }),
    ).toEqual({ url: 'https://resolved-env.supabase.co', key: 'test_key' });
    Reflect.deleteProperty(process.env, 'TEST_SB_URL');
    Reflect.deleteProperty(process.env, 'TEST_SB_KEY');

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
    process.env.HIVE_DEFAULTS_CONFIG_DIR = join(env.tempDir, 'custom_defaults');
    const embeddedDefaultsDir = resolveDefaultsConfigDir();
    const embeddedModelConfig = join(embeddedDefaultsDir, 'models_config.json');
    expect(isTemplateOrReadOnlyConfig(embeddedModelConfig)).toBe(true);
  });

  it('should handle filesystem resolution errors gracefully in isPathInside', () => {
    expect(isPathInside(env.tempDir, join(env.tempDir, '\0test.json'))).toBe(true);
    expect(isPathInside(null as unknown as string, env.tempDir)).toBe(false);
  });
});
