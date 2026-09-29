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
  fileExists as containerFileExists,
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
  fileExists as supabaseFileExists,
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

let env: TestEnvironment;

function setupTestEnv(): TestEnvironment {
  const tempDir = join(tmpdir(), `config-consumers-${randomUUID()}`);
  safeMkdirSync(tempDir, { recursive: true });
  const prevEnvs = new Map<string, string | undefined>();
  for (const key of MONITORED_ENV_KEYS) prevEnvs.set(key, Reflect.get(process.env, key));
  return { tempDir, prevEnvs };
}

function teardownTestEnv(targetEnv: TestEnvironment): void {
  for (const [key, value] of targetEnv.prevEnvs.entries()) {
    if (value !== undefined) Reflect.set(process.env, key, value);
    else Reflect.deleteProperty(process.env, key);
  }
  try {
    safeRemoveDirectorySync(targetEnv.tempDir);
  } catch {
    /* ignore */
  }
}

function setTestConfig(key: string, filename: string, data: unknown): string {
  const target = join(env.tempDir, filename);
  safeWriteFileSync(target, typeof data === 'string' ? data : JSON.stringify(data));
  Reflect.set(process.env, key, target);
  return target;
}

const resetRedis = () =>
  ['isOpen', 'isReady', 'multi'].forEach((k) => Reflect.deleteProperty(redis, k));

beforeEach(() => {
  resetRedis();
  env = setupTestEnv();
});
afterEach(() => {
  teardownTestEnv(env);
  resetRedis();
});

async function withMockedAdmin<T>(fn: () => Promise<T>): Promise<T> {
  const { adminService } = await import('../../../services/adminService.js');
  const spy = jest.spyOn(adminService, 'init').mockResolvedValue(undefined);
  try {
    return await fn();
  } finally {
    spy.mockRestore();
  }
}

const defNull = async () => ({ data: null, error: null });
const eqChain = (maybeSingle: () => Promise<unknown>) => ({
  eq: () => ({
    eq: () => ({ maybeSingle }),
    limit: () => ({ maybeSingle }),
    maybeSingle,
    single: maybeSingle,
  }),
});

function mockDbClient(handlers: {
  user_identities?: { maybeSingle?: () => Promise<unknown>; upsert?: () => Promise<unknown> };
  users?: { single?: () => Promise<unknown>; delete?: jest.Mock };
  groups?: { maybeSingle?: () => Promise<unknown> };
}) {
  const delMock = jest
    .fn()
    .mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: null })) });
  return {
    from: (table: string) => {
      if (table === 'user_identities') {
        return {
          select: () => eqChain(handlers.user_identities?.maybeSingle ?? defNull),
          upsert: handlers.user_identities?.upsert ?? (async () => ({ error: null })),
        };
      }
      if (table === 'users') {
        return {
          insert: () => ({ select: () => ({ single: handlers.users?.single ?? defNull }) }),
          delete: handlers.users?.delete ?? delMock,
        };
      }
      return table === 'groups'
        ? { select: () => eqChain(handlers.groups?.maybeSingle ?? defNull) }
        : {};
    },
  };
}

describe('Config Consumers Migration - Core Loaders (#134)', () => {
  it('should resolve and load custom models_config.json via QuotaManager', async () => {
    setTestConfig('HIVE_CONFIG_MODELS_CONFIG_JSON', 'custom_models.json', {
      familles: {
        custom_provider: {
          modeles: [{ id: 'custom-model-1', quota: { rpm: 42, tpm: 100000, rpd: 500 } }],
        },
      },
    });
    const qm = new QuotaManager() as unknown as {
      quotas: Record<string, unknown>;
      modelToProvider: Map<string, string>;
    };
    expect(qm.modelToProvider.get('custom-model-1')).toBe('custom_provider');
    expect(qm.quotas['custom-model-1']).toEqual({ rpm: 42, tpm: 100000, rpd: 500 });
  });

  it('should resolve credentials.json and populate VoiceProvider credentials', () => {
    setTestConfig('HIVE_CONFIG_CREDENTIALS_JSON', 'custom_credentials.json', {
      familles_ia: { minimax: 'test-key-minimax-12345' },
    });
    const vp = new VoiceProvider({ enabled: true }, null);
    const internalCreds = (vp as unknown as { credentials: Record<string, string> }).credentials;
    expect(internalCreds.minimax).toBe('test-key-minimax-12345');
  });

  it('should resolve and load default credentials and models_config via ServiceContainer', () => {
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_KEY = 'dummy-key';
    process.env.GEMINI_KEY = 'test-gemini-key-val';
    const config = (
      new ServiceContainer() as unknown as {
        loadConfig: () => { credentials: unknown; modelsConfig: unknown };
      }
    ).loadConfig();
    expect(config.credentials).toBeDefined();
    expect(config.modelsConfig).toBeDefined();
  });

  it('should respect custom credentials and models_config in ServiceContainer', () => {
    setTestConfig('HIVE_CONFIG_CREDENTIALS_JSON', 'creds.json', {
      supabase: { url: 'https://custom.supabase.co', key: 'custom-key' },
      familles_ia: { gemini: 'test-gemini-key-val' },
    });
    const emb = { provider: 'test', model: 'test-emb', dimensions: 1536 };
    setTestConfig('HIVE_CONFIG_MODELS_CONFIG_JSON', 'models.json', {
      reglages_generaux: {
        familles_prioritaires: ['custom'],
        mode_proactif: true,
        embeddings: { primary: emb, fallback: emb },
      },
      familles: {},
    });
    const config = (
      new ServiceContainer() as unknown as {
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
    ['SUPABASE_URL', 'SUPABASE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'].forEach((k) =>
      Reflect.deleteProperty(process.env, k),
    );
    process.env.GEMINI_KEY = 'test-gemini-key-val';
    setTestConfig('HIVE_CONFIG_CREDENTIALS_JSON', 'no_sb_creds.json', {
      familles_ia: { gemini: 'test-gemini-key-val' },
    });
    expect(() =>
      (new ServiceContainer() as unknown as { loadConfig: () => unknown }).loadConfig(),
    ).toThrow(/Configuration Supabase manquante ou incomplète/);
  });

  it('should throw clear error when no AI keys are configured in ServiceContainer', () => {
    process.env.SUPABASE_URL = 'https://valid.supabase.co';
    process.env.SUPABASE_KEY = 'valid-key';
    ['GEMINI_KEY', 'OPENAI_KEY', 'HF_TOKEN', 'HUGGINGFACE_KEY'].forEach((k) =>
      Reflect.deleteProperty(process.env, k),
    );
    setTestConfig('HIVE_CONFIG_CREDENTIALS_JSON', 'no_ai_creds.json', {
      supabase: { url: 'https://valid.supabase.co', key: 'valid-key' },
      familles_ia: { gemini: 'VOTRE_CLE_GEMINI' },
    });

    const container = new ServiceContainer();
    expect(() => (container as unknown as { loadConfig: () => unknown }).loadConfig()).toThrow(
      /Aucune clé API d'IA configurée/,
    );
    expect(() =>
      (container as unknown as { loadConfig: (mode?: string) => unknown }).loadConfig('minimal'),
    ).not.toThrow();
  });

  it('should initialize successfully in minimal mode without AI keys configured in ServiceContainer', async () => {
    [
      'GEMINI_KEY',
      'OPENAI_KEY',
      'ANTHROPIC_KEY',
      'GROQ_KEY',
      'MISTRAL_KEY',
      'HF_TOKEN',
      'HUGGINGFACE_KEY',
    ].forEach((k) => Reflect.deleteProperty(process.env, k));
    setTestConfig('HIVE_CONFIG_CREDENTIALS_JSON', 'minimal_no_ai_creds.json', {
      supabase: { url: 'https://custom.supabase.co', key: 'custom-key' },
      familles_ia: { gemini: 'VOTRE_CLE_GEMINI' },
    });

    await withMockedAdmin(async () => {
      const container = new ServiceContainer();
      await container.init({ mode: 'minimal' });
      expect(container.has('supabase')).toBe(true);
      expect(container.has('redis')).toBe(true);
      expect(container.has('adminService')).toBe(true);
      expect(container.has('memory')).toBe(false);
    });
  });

  it('should log clear message and continue when Redis is absent in ServiceContainer', () => {
    Reflect.deleteProperty(process.env, 'REDIS_URL');
    process.env.SUPABASE_URL = 'https://valid.supabase.co';
    process.env.SUPABASE_KEY = 'valid-key';
    process.env.GEMINI_KEY = 'test-gemini-key-val';
    setTestConfig('HIVE_CONFIG_CREDENTIALS_JSON', 'no_redis_creds.json', {
      supabase: { url: 'https://valid.supabase.co', key: 'valid-key' },
      familles_ia: { gemini: 'test-gemini-key-val' },
    });

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const config = (
        new ServiceContainer() as unknown as { loadConfig: () => { credentials: unknown } }
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
  it('should count AI keys with unmasked HF_TOKEN when credentials contains placeholder', () => {
    process.env.HF_TOKEN = 'hf_valid_test_token_12345';
    expect(countConfiguredAiKeys({ huggingface: 'VOTRE_CLE_HF', gemini: 'VOTRE_CLE_GEMINI' })).toBe(
      1,
    );
  });

  it('should count HF_TOKEN in familles_ia even when no environment variable is present', () => {
    ['HF_TOKEN', 'HUGGINGFACE_KEY', 'GEMINI_KEY'].forEach((k) =>
      Reflect.deleteProperty(process.env, k),
    );
    expect(countConfiguredAiKeys({ HF_TOKEN: 'hf_standalone_token_9999' })).toBe(1);
  });

  it('should count AI keys case-insensitively and handle custom providers', () => {
    ['OPENAI_KEY', 'GEMINI_KEY'].forEach((k) => Reflect.deleteProperty(process.env, k));
    expect(
      countConfiguredAiKeys({
        OpenAI: 'sk-case-insensitive-test',
        CustomProvider: 'custom-secret-key-123',
        gemini: 'YOUR_GEMINI_KEY',
      }),
    ).toBe(2);
    expect(countConfiguredAiKeys(undefined)).toBe(0);
    expect(countConfiguredAiKeys(null as unknown as undefined)).toBe(0);
  });

  it('should normalize mixed-case provider keys in familles_ia so consumers can access them', () => {
    expect(normalizeFamillesIa(undefined)).toBeUndefined();
    expect(normalizeFamillesIa(null as unknown as undefined)).toBeUndefined();
    expect(normalizeFamillesIa({ invalidVal: 123 as unknown as string })).toEqual({});

    setTestConfig('HIVE_CONFIG_CREDENTIALS_JSON', 'mixed_case_creds.json', {
      supabase: { url: 'https://custom.supabase.co', key: 'custom-key' },
      familles_ia: { OpenAI: 'sk-test-openai-key-case', Gemini: 'gemini-key-val' },
    });

    const config = (
      new ServiceContainer() as unknown as {
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
    [
      'registerCoreMemoriesAndConsciousness',
      'registerVoiceServices',
      'registerMemoryServices',
      'registerLiveAndDreamServices',
      'registerBrowserAndProviderRouter',
    ].forEach((fn) => {
      Reflect.set(mockContainer, fn, jest.fn<() => Promise<void>>().mockResolvedValue(undefined));
    });
    mockContainer.registerEmbeddingService = jest.fn<() => void>();

    const targetContainer = container as unknown as {
      _doInit: (opts: { mode: 'full' }) => Promise<void>;
    };
    await targetContainer._doInit({ mode: 'full' });
    expect(registerBaseSpy).toHaveBeenCalledWith(mockCreds);

    await targetContainer._doInit({ mode: 'full' });
    expect(registerBaseSpy).toHaveBeenCalledTimes(1);
  });
});

describe('Config Consumers Migration - Supabase & Redis Resolution (#134)', () => {
  it('should keep redis unmocked when Redis IS configured in ServiceContainer', async () => {
    await withMockedAdmin(async () => {
      const container = new ServiceContainer();
      await (
        container as unknown as { registerBaseServices: (creds?: unknown) => Promise<void> }
      ).registerBaseServices({ redis: { url: 'redis://localhost:6379' } });
      expect(redis).toBeDefined();
      expect(Object.prototype.hasOwnProperty.call(redis, 'isOpen')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(redis, 'isReady')).toBe(false);
      expect(redis.isOpen).toBe(false);
      expect(redis.isReady).toBe(false);
    });
  });

  it('should activate switchToMock on redis when Redis is not configured in ServiceContainer', async () => {
    Reflect.deleteProperty(process.env, 'REDIS_URL');
    await withMockedAdmin(async () => {
      try {
        const container = new ServiceContainer();
        await (
          container as unknown as { registerBaseServices: (creds?: unknown) => Promise<void> }
        ).registerBaseServices({});
        expect(Object.prototype.hasOwnProperty.call(redis, 'isOpen')).toBe(true);
        expect(redis.isReady).toBe(true);
        expect(redis.isOpen).toBe(true);
      } finally {
        resetRedis();
      }
    });
  });

  it('should correctly evaluate resolveSupabaseCredentials and isRedisConfigured', () => {
    ['SUPABASE_URL', 'SUPABASE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'REDIS_URL'].forEach((k) =>
      Reflect.deleteProperty(process.env, k),
    );

    expect(resolveSupabaseCredentials(undefined)).toBeNull();
    [
      { url: 'https://VOTRE_PROJET.supabase.co', key: 'k' },
      { url: '', key: 'k' },
      { url: '   ', key: 'k' },
      { url: 'https://valid.co', key: 'DUMMY' },
      { url: 'https://valid.co', key: '${SUPABASE_KEY}' },
    ].forEach((supabase) => expect(resolveSupabaseCredentials({ supabase })).toBeNull());

    expect(
      resolveSupabaseCredentials({ supabase: { url: 'https://valid.co', key: 'key1' } }),
    ).toEqual({ url: 'https://valid.co', key: 'key1' });
    expect(
      resolveSupabaseCredentials({
        supabase: {
          project_url: 'https://project-url.supabase.co',
          service_role_key: 'role-key-123',
        },
      }),
    ).toEqual({ url: 'https://project-url.supabase.co', key: 'role-key-123' });

    ['', '""', '   ', undefined].forEach((s) => expect(isValidCredentialString(s)).toBe(false));

    process.env.TEST_SB_URL = 'https://resolved-env.supabase.co';
    process.env.TEST_SB_KEY = 'test_key';
    expect(
      resolveSupabaseCredentials({ supabase: { url: 'TEST_SB_URL', key: 'TEST_SB_KEY' } }),
    ).toEqual({ url: 'https://resolved-env.supabase.co', key: 'test_key' });
    ['TEST_SB_URL', 'TEST_SB_KEY'].forEach((k) => Reflect.deleteProperty(process.env, k));

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
    ).toEqual({ url: 'https://valid.supabase.co', key: 'fallback-service-role-key' });
    Reflect.deleteProperty(process.env, 'SUPABASE_SERVICE_ROLE_KEY');

    expect(
      resolveSupabaseCredentials({ supabase: { url: 'EMPTY_SB_VAL', key: 'EMPTY_SB_VAL' } }),
    ).toBeNull();
    Reflect.deleteProperty(process.env, 'EMPTY_SB_VAL');

    process.env.SUPABASE_URL = 'https://env-sb.supabase.co';
    process.env.SUPABASE_KEY = 'test_key';
    expect(resolveSupabaseCredentials({ familles_ia: { gemini: 'test' } })).toEqual({
      url: 'https://env-sb.supabase.co',
      key: 'test_key',
    });
    ['SUPABASE_URL', 'SUPABASE_KEY'].forEach((k) => Reflect.deleteProperty(process.env, k));

    expect(isRedisConfigured(undefined)).toBe(false);
    ['redis://YOUR_HOST:6379', 'redis://VOTRE_HOTE:6379', '', '   ', 'DUMMY'].forEach((url) =>
      expect(isRedisConfigured({ redis: { url } })).toBe(false),
    );

    [
      'redis://localhost:6379',
      '"redis://localhost:6379"',
      "'rediss://localhost:6379'",
      'rediss://your_app:secret@redis.example.com:6379',
    ].forEach((url) => expect(isRedisConfigured({ redis: { url } })).toBe(true));

    process.env.EMPTY_REDIS_VAR = '';
    expect(isRedisConfigured({ redis: { url: 'EMPTY_REDIS_VAR' } })).toBe(false);
    Reflect.deleteProperty(process.env, 'EMPTY_REDIS_VAR');

    process.env.REDIS_URL = 'redis://env-redis-host:6379';
    expect(isRedisConfigured({ redis: { url: 'REDIS_VAR_NOT_FOUND' } })).toBe(true);
    Reflect.deleteProperty(process.env, 'REDIS_URL');
  });
});

describe('Config Consumers Migration - Adapters, Write Confinement & Resilience (#134)', () => {
  function testHf(credsObj: unknown, envToken?: string) {
    setTestConfig('HIVE_CONFIG_CREDENTIALS_JSON', `hf_${randomUUID()}.json`, credsObj);
    if (envToken) process.env.HF_TOKEN = envToken;
    return new HuggingFaceAdapter();
  }

  it('should initialize HuggingFace client when valid HF_TOKEN is in credentials', () => {
    const adapter = testHf({ familles_ia: { HF_TOKEN: 'mock-hf-test-valid-token-12345' } });
    expect(adapter.client).not.toBeNull();
    expect(adapter.name).toBe('huggingface');
  });

  it('should initialize HuggingFace client when credentials use template format "huggingface": "${HUGGINGFACE_KEY}"', () => {
    process.env.HUGGINGFACE_KEY = 'mock-hf-resolved-token-abc';
    expect(testHf({ familles_ia: { huggingface: '${HUGGINGFACE_KEY}' } }).client).not.toBeNull();
  });

  it('should leave HuggingFace client as null when HF_TOKEN is placeholder or missing', () => {
    expect(testHf({ familles_ia: { HF_TOKEN: 'VOTRE_CLE_HF' } }).client).toBeNull();
  });

  it('should prioritize valid huggingface key over placeholder HF_TOKEN', () => {
    const creds = { familles_ia: { HF_TOKEN: 'VOTRE_CLE_HF', huggingface: 'valid-hf-token' } };
    expect(testHf(creds).client).not.toBeNull();
  });

  it('should handle corrupted credentials.json gracefully and fallback to env in HuggingFace adapter', () => {
    expect(testHf('{ invalid json', 'mock-env-hf-token-fallback').client).not.toBeNull();
  });

  it('should read transcription mode and redirect write to user directory in Admin plugin', async () => {
    process.env.HIVE_HOME_DIR = join(env.tempDir, 'fake_home');
    const statusRes = await adminPlugin._setVoiceMode('status');
    expect(statusRes.success).toBe(true);
    expect(statusRes.message).toContain('Current transcription mode');

    const writeRes = await adminPlugin._setVoiceMode('full');
    expect(writeRes.success).toBe(true);
    const userCfg = join(process.env.HIVE_HOME_DIR, 'config', 'config.json');
    expect(safeExistsSync(userCfg)).toBe(true);
    expect(JSON.parse(safeReadFileSync(userCfg, 'utf-8')).voice_transcription?.mode).toBe('full');
  });

  it('should write directly to custom configPath when not a template in Admin plugin', async () => {
    const customConfigDir = join(env.tempDir, 'custom_cfg_dir');
    safeMkdirSync(customConfigDir, { recursive: true });
    const customPath = setTestConfig('HIVE_CONFIG_CONFIG_JSON', 'custom_cfg_dir/config.json', {
      voice_transcription: { mode: 'restricted' },
    });
    const res = await adminPlugin._setVoiceMode('full');
    expect(res.success).toBe(true);
    expect(JSON.parse(safeReadFileSync(customPath, 'utf-8')).voice_transcription?.mode).toBe(
      'full',
    );
  });

  it('should redirect writes away from defaults or legacy template to user config directory', () => {
    process.env.HIVE_HOME_DIR = join(env.tempDir, 'user_home');
    const configPath = resolveConfigPath('models_config.json');
    const isReadOnlyOrTemplate = isTemplateOrReadOnlyConfig(configPath);
    expect(isReadOnlyOrTemplate).toBe(true);
    const targetWritePath = isReadOnlyOrTemplate
      ? join(resolveUserConfigDir(), 'models_config.json')
      : configPath;
    expect(targetWritePath).toBe(join(process.env.HIVE_HOME_DIR, 'config', 'models_config.json'));
  });

  function verifyGraphMemoryFallback(): void {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(initGraphMemoryEmbeddings()).not.toBeNull();
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

  function setupGraphTest(creds?: string, geminiKey?: string) {
    process.env.HIVE_LEGACY_CONFIG_DIR = env.tempDir;
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = creds ?? join(env.tempDir, 'missing_creds.json');
    if (geminiKey) process.env.GEMINI_KEY = geminiKey;
  }

  it('should initialize embeddings from environment variables when credentials.json is missing in GraphMemory', () => {
    setupGraphTest(undefined, 'mock-gemini-key-12345');
    verifyGraphMemoryFallback();
  });

  it('should handle corrupted credentials.json gracefully and fallback to env in GraphMemory', () => {
    setupGraphTest(
      setTestConfig('HIVE_CONFIG_CREDENTIALS_JSON', 'corrupt_graph_creds.json', '{ corrupt json'),
      'mock-gemini-key-fallback',
    );
    verifyGraphMemoryFallback();
  });

  it('should return null without throwing when neither credentials nor env keys are present in GraphMemory', () => {
    setupGraphTest();
    ['GEMINI_KEY', 'OPENAI_KEY'].forEach((k) => Reflect.deleteProperty(process.env, k));
    expect(initGraphMemoryEmbeddings()).toBeNull();
  });
});

describe('Config Consumers Migration - Path Containment Helpers (#134)', () => {
  it('should correctly detect if a path is inside a parent directory with isPathInside', () => {
    const parent = join(resolveUserConfigDir(), 'parent_scope');
    [join(parent, 'sub', 'file.json'), join(parent, 'file.json')].forEach((p) =>
      expect(isPathInside(parent, p)).toBe(true),
    );
    [
      parent,
      `${parent}_sibling/file.json`,
      join(resolveUserConfigDir(), 'other', 'file.json'),
    ].forEach((p) => expect(isPathInside(parent, p)).toBe(false));
  });

  it('should accurately identify template/read-only configs with isTemplateOrReadOnlyConfig', () => {
    const isTmpl = isTemplateOrReadOnlyConfig;
    expect(isTmpl(join(resolveDefaultsConfigDir(), 'models_config.json'))).toBe(true);
    expect(isTmpl(join(resolveLegacyConfigDir(), 'models_config.json'))).toBe(true);
    expect(isTmpl(join(resolveUserConfigDir(), 'models_config.json'))).toBe(false);
    expect(isTmpl('/custom/unrelated/config.json')).toBe(false);
  });

  it('should accurately detect symlinks pointing to template or read-only configs', () => {
    const defaultsDir = resolveDefaultsConfigDir();
    const symlinkPath = join(env.tempDir, 'symlink_to_template.json');
    safeSymlinkSync(join(defaultsDir, 'models_config.json'), symlinkPath);
    expect(isPathInside(defaultsDir, symlinkPath)).toBe(true);
    expect(isTemplateOrReadOnlyConfig(symlinkPath)).toBe(true);
  });

  it('should protect embedded defaults in isTemplateOrReadOnlyConfig even when HIVE_DEFAULTS_CONFIG_DIR is overridden', () => {
    Reflect.deleteProperty(process.env, 'HIVE_DEFAULTS_CONFIG_DIR');
    const realDefaults = resolveDefaultsConfigDir();
    const customDir = join(env.tempDir, 'custom_defaults');
    safeMkdirSync(customDir, { recursive: true });
    process.env.HIVE_DEFAULTS_CONFIG_DIR = customDir;
    expect(isTemplateOrReadOnlyConfig(join(realDefaults, 'models_config.json'))).toBe(true);
    const customConfig = join(customDir, 'models_config.json');
    safeWriteFileSync(customConfig, '{}');
    expect(isTemplateOrReadOnlyConfig(customConfig)).toBe(true);
  });

  it('should handle filesystem resolution errors gracefully in isPathInside', () => {
    expect(isPathInside(env.tempDir, join(env.tempDir, '\0test.json'))).toBe(true);
    expect(isPathInside(null as unknown as string, env.tempDir)).toBe(false);
  });
});

describe('Supabase Client normalization & dynamic reinitialization', () => {
  it('should strip quotes and instantiate client with initSupabaseClient', () => {
    [
      '"https://test.supabase.co"',
      "'https://single.supabase.co'",
      'https://unquoted.supabase.co',
    ].forEach((u) => expect(initSupabaseClient(u, 'secret-key')).not.toBeNull());
  });

  it('should resolve environment variables with or without quotes in initSupabaseClient', () => {
    process.env.TEST_CUSTOM_SB_URL = '"https://env-quoted.supabase.co"';
    process.env.TEST_CUSTOM_SB_KEY = "'env-key-quoted'";
    expect(initSupabaseClient('TEST_CUSTOM_SB_URL', 'TEST_CUSTOM_SB_KEY')).not.toBeNull();
    ['TEST_CUSTOM_SB_URL', 'TEST_CUSTOM_SB_KEY'].forEach((k) =>
      Reflect.deleteProperty(process.env, k),
    );
  });

  it('should fallback to process.env.SUPABASE_URL and process.env.SUPABASE_SERVICE_ROLE_KEY', () => {
    process.env.SUPABASE_URL = '"https://fallback.supabase.co"';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '"fallback-role-key"';
    expect(initSupabaseClient()).not.toBeNull();
  });

  it('should return null when URL is placeholder, invalid or missing in initSupabaseClient', () => {
    ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_KEY'].forEach((k) =>
      Reflect.deleteProperty(process.env, k),
    );
    ['"https://VOTRE_PROJET.supabase.co"', 'not-a-valid-http-url', undefined].forEach((u) =>
      expect(initSupabaseClient(u, 'key')).toBeNull(),
    );
  });

  it('should reinitialize db.client dynamically via db.reinit', () => {
    const client = db.reinit('"https://reinit.supabase.co"', '"reinit-key"');
    expect(client).not.toBeNull();
    expect(db.client).toBe(client);
    ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_KEY'].forEach((k) =>
      Reflect.deleteProperty(process.env, k),
    );
    expect(db.reinit(undefined, undefined)).toBeNull();
    expect(db.client).toBeNull();
  });

  it('should reinitialize db in ServiceContainer.registerBaseServices when credentials.supabase.url is present', async () => {
    setTestConfig('HIVE_CONFIG_CREDENTIALS_JSON', 'quoted_sb_creds.json', {
      supabase: { url: '"https://container-quoted.supabase.co"', key: '"quoted-key"' },
      familles_ia: { gemini: 'VOTRE_CLE_GEMINI' },
    });
    await withMockedAdmin(async () => {
      const container = new ServiceContainer();
      await container.init({ mode: 'minimal' });
      expect(container.get<{ client: unknown }>('supabase').client).not.toBeNull();
    });
  });

  it('should not call db.reinit when credentials.supabase.url is absent in registerBaseServices', async () => {
    const reinitSpy = jest.spyOn(db, 'reinit');
    try {
      await withMockedAdmin(async () => {
        const container = new ServiceContainer();
        await (
          container as unknown as { registerBaseServices: (c?: unknown) => Promise<void> }
        ).registerBaseServices({});
        expect(reinitSpy).not.toHaveBeenCalled();
      });
    } finally {
      reinitSpy.mockRestore();
    }
  });
});

describe('Container Env & Model Resilience', () => {
  it('should initialize successfully in pure environment variable deployment without credentials.json', async () => {
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = join(env.tempDir, 'non_existent_credentials.json');
    process.env.SUPABASE_URL = 'https://pure-env.supabase.co';
    process.env.SUPABASE_KEY = 'pure-env-service-key-xyz';
    process.env.GEMINI_KEY = 'mock-pure-env-gemini-key';

    await withMockedAdmin(async () => {
      const container = new ServiceContainer();
      await container.init({ mode: 'minimal' });
      expect(container.has('supabase')).toBe(true);
      expect(container.get('db')).toBe(container.get('supabase'));
      expect(container.has('config')).toBe(true);
    });
  });

  it('should resolve placeholder keys like VOTRE_CLE_GEMINI to process.env.GEMINI_KEY in ServiceContainer', () => {
    setTestConfig('HIVE_CONFIG_CREDENTIALS_JSON', 'placeholder_creds.json', {
      supabase: { url: 'https://test-placeholder.supabase.co', key: 'service-key-valid-123' },
      familles_ia: { gemini: 'VOTRE_CLE_GEMINI' },
    });
    process.env.GEMINI_KEY = 'real-env-gemini-key-from-environment';

    const config = (
      new ServiceContainer() as unknown as {
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
    const mockModels = {
      reglages_generaux: {
        embeddings: { primary: { model: 'gemini-embedding-001', dimensions: 768 } },
      },
      voice_provider: {
        minimax_config: { voice_id: 'test' },
        stt_models: [{ model: 'whisper-large' }],
      },
    };

    const cAny = container as unknown as {
      registerEmbeddingService: (c: unknown, m: unknown) => void;
      registerMinimaxVoice: (c: unknown, m: unknown) => Promise<void>;
      registerGroqSTT: (c: unknown, m: unknown) => Promise<void>;
      loadConfig: (mode?: string) => unknown;
    };

    cAny.registerEmbeddingService({ familles_ia: { gemini: 'k', openai: 'k' } }, mockModels);
    cAny.registerEmbeddingService({ familles_ia: {} }, mockModels);
    expect(container.has('embeddings')).toBe(true);

    await cAny.registerMinimaxVoice({ familles_ia: { minimax: 'k' } }, mockModels);
    await cAny.registerMinimaxVoice({ familles_ia: {} }, mockModels);
    expect(container.has('voiceService')).toBe(true);

    await cAny.registerGroqSTT({ familles_ia: { groq: 'k' } }, mockModels);
    await cAny.registerGroqSTT({ familles_ia: {} }, mockModels);
    expect(container.has('transcriptionService')).toBe(true);

    process.env.HIVE_CONFIG_MODELS_CONFIG_JSON = join(env.tempDir, 'missing_models.json');
    process.env.HIVE_CONFIG_CREDENTIALS_JSON = join(env.tempDir, 'missing_creds.json');
    expect(() => cAny.loadConfig('minimal')).toThrow();
  });

  it('should verify fileExists helper branches in ServiceContainer and supabase', () => {
    const existing = join(env.tempDir, 'existing.txt');
    safeWriteFileSync(existing, 'hello');
    [containerFileExists, supabaseFileExists].forEach((fn) => {
      expect(fn(undefined)).toBe(false);
      expect(fn('')).toBe(false);
      expect(fn(join(env.tempDir, 'missing.txt'))).toBe(false);
      expect(fn(existing)).toBe(true);
    });
  });
});

describe('Supabase Validation & Group Resolution', () => {
  it('should strictly reject empty keys and placeholders in initSupabaseClient', () => {
    ['', '   ', 'VOTRE_CLE_SERVICE', 'YOUR_KEY_HERE'].forEach((key) =>
      expect(initSupabaseClient('https://test.supabase.co', key)).toBeNull(),
    );
    expect(initSupabaseClient('https://test.supabase.co', 'valid-secret-key-123')).not.toBeNull();
  });

  it('should validate all branches of isSupabaseUrlValid and isSupabaseKeyValid', () => {
    [
      undefined,
      '',
      'ftp://example.com',
      'https://VOTRE_PROJET.supabase.co',
      'https://YOUR_PROJECT.supabase.co',
      'DUMMY',
      'PLACEHOLDER',
    ].forEach((url) => expect(isSupabaseUrlValid(url)).toBe(false));
    expect(isSupabaseUrlValid('https://valid.supabase.co')).toBe(true);

    [
      undefined,
      '',
      '   ',
      'VOTRE_CLE_ICI',
      'YOUR_KEY_HERE',
      'key_with_VOTRE_CLE_inside',
      'key_with_YOUR_KEY_inside',
      'DUMMY',
      'PLACEHOLDER',
      'UNDEFINED',
      'NULL',
    ].forEach((key) => expect(isSupabaseKeyValid(key)).toBe(false));
    expect(isSupabaseKeyValid('valid_service_role_key_12345')).toBe(true);
  });

  it('should resolve environment variables and handle unquoted or missing values', () => {
    [undefined, ''].forEach((v) => expect(resolveEnvOrVal(v)).toBeUndefined());
    process.env.TEST_EXISTING_ENV = '"https://quoted-env.supabase.co"';
    process.env.TEST_EMPTY_ENV = '';
    expect(resolveEnvOrVal('TEST_EXISTING_ENV')).toBe('https://quoted-env.supabase.co');
    expect(resolveEnvOrVal('TEST_EMPTY_ENV')).toBe('TEST_EMPTY_ENV');
    expect(resolveEnvOrVal('NON_EXISTENT_VAR')).toBe('NON_EXISTENT_VAR');
    expect(resolveEnvOrVal('"literal-string"')).toBe('literal-string');
    ['TEST_EXISTING_ENV', 'TEST_EMPTY_ENV'].forEach((k) => Reflect.deleteProperty(process.env, k));
  });

  it('should correctly classify groups and users with determineIfGroup', () => {
    ['12345@g.us', '12345@G.US'].forEach((id) => expect(determineIfGroup(id, true)).toBe(true));
    expect(determineIfGroup('33612345678@s.whatsapp.net', true)).toBe(false);

    ['123e4567-e89b-12d3-a456-426614174000', 'user-12345', 'user_bob', 'simpleuser'].forEach((id) =>
      expect(determineIfGroup(id, false)).toBe(false),
    );
    ['chat_general', 'group_alpha', 'channel_dev', 'custom-channel-id'].forEach((id) =>
      expect(determineIfGroup(id, false)).toBe(true),
    );
  });

  it('should not classify UUIDs or usernames with hyphens as groups in resolveContextFromLegacyId', async () => {
    const uSpy = jest.spyOn(db, 'resolveUser').mockResolvedValue('user-uuid-123');
    const gSpy = jest.spyOn(db, 'resolveGroup').mockResolvedValue('group-uuid-456');
    try {
      expect((await db.resolveContextFromLegacyId('user-42'))?.type).toBe('user');
      expect(
        (await db.resolveContextFromLegacyId('123e4567-e89b-12d3-a456-426614174000'))?.type,
      ).toBe('user');
      expect(uSpy).toHaveBeenCalledTimes(2);
      expect((await db.resolveContextFromLegacyId('group_support'))?.type).toBe('group');
      expect(gSpy).toHaveBeenCalledWith('cli', 'group_support');
    } finally {
      uSpy.mockRestore();
      gSpy.mockRestore();
    }
  });
});

describe('Supabase User Identity, Concurrency & Group Resolution', () => {
  let orig: unknown;
  beforeEach(() => {
    orig = db.client;
  });
  afterEach(() => {
    db.reinit(orig as unknown as import('@supabase/supabase-js').SupabaseClient);
  });

  it('should return null when client is null', async () => {
    db.reinit(undefined, undefined);
    expect(await db.resolveUser('cli', 'u1')).toBeNull();
    expect(await db.resolveGroup('cli', 'g1')).toBeNull();
  });

  it('should resolve existing user identity from user_identities table', async () => {
    db.reinit(
      mockDbClient({
        user_identities: {
          maybeSingle: async () => ({ data: { user_id: 'existing-user-uuid' }, error: null }),
        },
      }) as unknown as import('@supabase/supabase-js').SupabaseClient,
    );
    expect(await db.resolveUser('discord', 'disc-123')).toBe('existing-user-uuid');
  });

  const makeDelSpy = () =>
    jest.fn().mockReturnValue({ eq: jest.fn().mockReturnValue(Promise.resolve({ error: null })) });

  it('should handle concurrent resolution and clean up losing user record', async () => {
    const deleteSpy = makeDelSpy();
    let count = 0;
    db.reinit(
      mockDbClient({
        user_identities: {
          maybeSingle: async () => ({
            data: ++count === 1 ? null : { user_id: 'winner-concurrent-user-uuid' },
            error: null,
          }),
        },
        users: {
          single: async () => ({ data: { id: 'loser-user-uuid' }, error: null }),
          delete: deleteSpy,
        },
      }) as unknown as import('@supabase/supabase-js').SupabaseClient,
    );
    expect(await db.resolveUser('discord', 'concurrent-user')).toBe('winner-concurrent-user-uuid');
    expect(deleteSpy).toHaveBeenCalled();
  });

  it('should create fresh user and link identity successfully when no concurrency conflict exists', async () => {
    let count = 0;
    db.reinit(
      mockDbClient({
        user_identities: {
          maybeSingle: async () => ({
            data: ++count === 1 ? null : { user_id: 'brand-new-user-uuid' },
            error: null,
          }),
        },
        users: { single: async () => ({ data: { id: 'brand-new-user-uuid' }, error: null }) },
      }) as unknown as import('@supabase/supabase-js').SupabaseClient,
    );
    expect(await db.resolveUser('cli', 'fresh-user')).toBe('brand-new-user-uuid');
  });

  it('should return null when user insertion fails', async () => {
    db.reinit(
      mockDbClient({
        user_identities: { maybeSingle: async () => ({ data: null, error: null }) },
        users: { single: async () => ({ data: null, error: new Error('DB insert failed') }) },
      }) as unknown as import('@supabase/supabase-js').SupabaseClient,
    );
    expect(await db.resolveUser('telegram', 'tg-456')).toBeNull();
  });

  it('should clean up created user and return null when identity upsert fails', async () => {
    const deleteSpy = makeDelSpy();
    db.reinit(
      mockDbClient({
        user_identities: {
          maybeSingle: async () => ({ data: null, error: null }),
          upsert: async () => ({ error: new Error('Upsert conflict') }),
        },
        users: {
          single: async () => ({ data: { id: 'new-user-to-delete' }, error: null }),
          delete: deleteSpy,
        },
      }) as unknown as import('@supabase/supabase-js').SupabaseClient,
    );
    expect(await db.resolveUser('cli', 'cli-fail')).toBeNull();
    expect(deleteSpy).toHaveBeenCalled();
  });

  it('should resolve existing group from groups table', async () => {
    db.reinit(
      mockDbClient({
        groups: {
          maybeSingle: async () => ({ data: { id: 'existing-group-uuid' }, error: null }),
        },
      }) as unknown as import('@supabase/supabase-js').SupabaseClient,
    );
    expect(await db.resolveGroup('discord', 'disc-grp')).toBe('existing-group-uuid');
  });

  it('should resolve group founder without PGRST116 for multi-identity users', async () => {
    db.reinit(
      mockDbClient({
        groups: {
          maybeSingle: async () => ({
            data: { id: 'group-uuid', founder_id: 'founder-uuid' },
            error: null,
          }),
        },
        user_identities: {
          maybeSingle: async () => ({ data: { platform_user_id: 'wa-founder' }, error: null }),
        },
      }) as unknown as import('@supabase/supabase-js').SupabaseClient,
    );
    expect(await db.getGroupFounder('12036302@g.us')).toBe('wa-founder');
    expect(await db.getGroupFounder('')).toBeNull();
  });
});
