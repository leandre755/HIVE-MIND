import { describe, beforeEach, afterEach, it, expect } from '@jest/globals';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import {
  safeMkdirSync,
  safeWriteFileSync,
  safeRemoveDirectorySync,
  safeExistsSync,
  safeReadFileSync,
} from '../../../utils/safeFs.js';
import {
  resolveConfigPath,
  resolveDefaultsConfigDir,
  resolveLegacyConfigDir,
  resolveUserConfigDir,
} from '../../../config/ConfigPathResolver.js';
import { QuotaManager } from '../../../services/quotaManager.js';
import { VoiceProvider } from '../../../services/voice/voiceProvider.js';
import { ServiceContainer } from '../../../core/ServiceContainer.js';
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
  'GEMINI_KEY',
  'OPENAI_KEY',
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
      familles_ia: { CUSTOM_TOKEN: 'custom-val' },
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

  it('should redirect writes away from defaults or legacy template to user config directory', () => {
    const userHome = join(env.tempDir, 'user_home');
    process.env.HIVE_HOME_DIR = userHome;

    const configPath = resolveConfigPath('models_config.json');
    const defaultsDir = resolveDefaultsConfigDir();
    const legacyDir = resolveLegacyConfigDir();
    const isReadOnlyOrTemplate =
      configPath.startsWith(defaultsDir) || configPath.startsWith(legacyDir);

    expect(isReadOnlyOrTemplate).toBe(true);

    const targetWritePath = isReadOnlyOrTemplate
      ? join(resolveUserConfigDir(), 'models_config.json')
      : configPath;

    expect(targetWritePath).toBe(join(userHome, 'config', 'models_config.json'));
  });

  it('should initialize embeddings from environment variables when credentials.json is missing in GraphMemory', () => {
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = join(env.tempDir, 'non_existent_creds.json');
    process.env.GEMINI_KEY = 'mock-gemini-key-12345';

    const embeddings = initGraphMemoryEmbeddings();
    expect(embeddings).not.toBeNull();
  });

  it('should return null without throwing when neither credentials nor env keys are present in GraphMemory', () => {
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = join(env.tempDir, 'non_existent_creds.json');
    Reflect.deleteProperty(process.env, 'GEMINI_KEY');
    Reflect.deleteProperty(process.env, 'OPENAI_KEY');

    const embeddings = initGraphMemoryEmbeddings();
    expect(embeddings).toBeNull();
  });
});
