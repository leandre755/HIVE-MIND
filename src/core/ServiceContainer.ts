import { safeReadFileSync } from '../utils/safeFs.js';
import { resolveConfigPath } from '../config/ConfigPathResolver.js';
import { resolveApiKey } from '../config/keyResolver.js';
import { EmbeddingsService, EmbeddingConfig } from '../services/ai/EmbeddingsService.js';
import { SemanticMemory, SemanticMemoryDependencies } from '../services/memory/SemanticMemory.js';
import { logger } from '../utils/logger.js';
import { db } from '../services/supabase.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CredentialsSchema, Credentials } from '../config/credentials.schema.js';
import { ModelsConfigSchema, ModelsConfig } from '../config/config.schema.js';
import { config as appConfig } from '../config/index.js';

interface ServiceEntry {
  factory: () => unknown;
  singleton: boolean;
  instance: unknown;
}

export interface ContainerInitOptions {
  mode: 'full' | 'minimal';
}

interface ServiceStats {
  total: number;
  singletons: number;
  instances: number;
  services: Record<string, { singleton: boolean; created: boolean }>;
}

export interface ServiceRegistry {
  logger: typeof logger;
  supabase: typeof db;
  config: typeof appConfig;
  redis: typeof import('../services/redisClient.js').redis;
  adminService: typeof import('../services/adminService.js').adminService;
  userService: typeof import('../services/userService.js').userService;
  agentMemory: typeof import('../services/agentMemory.js').agentMemory;
  actionMemory: typeof import('../services/memory/ActionMemory.js').actionMemory;
  groupService: typeof import('../services/groupService.js').groupService;
  workingMemory: typeof import('../services/workingMemory.js').workingMemory;
  consciousness: typeof import('../services/consciousnessService.js').consciousness;
  moderation: typeof import('../services/moderationService.js').moderationService;
  embeddings: EmbeddingsService;
  quotaManager: typeof import('../services/quotaManager.js').quotaManager;
  voiceProvider: InstanceType<typeof import('../services/voice/voiceProvider.js').VoiceProvider>;
  voiceService: InstanceType<typeof import('../services/voice/minimax.js').MinimaxVoiceService>;
  transcriptionService: InstanceType<
    typeof import('../services/transcription/groqSTT.js').GroqTranscriptionService
  >;
  memory: SemanticMemory;
  graphMemory: typeof import('../services/graphMemory.js').graphMemory;
  knowledgeWeaver: typeof import('../services/knowledgeWeaver.js').knowledgeWeaver;
  consolidationService: typeof import('../services/consolidationService.js').consolidationService;
  geminiLiveProvider: InstanceType<
    typeof import('../services/audio/geminiLiveProvider.js').GeminiLiveProvider
  >;
  dream: typeof import('../services/dreamService.js').dreamService;
  runtime: InstanceType<
    typeof import('../services/runtime/RuntimeInfrastructure.js').AIRuntimeInfrastructure
  >;
  contextWindow: InstanceType<
    typeof import('../services/runtime/ContextWindowService.js').ContextWindowService
  >;
  facts: typeof import('../services/memory.js').factsMemory;
  workspace: typeof import('../services/memory.js').workspaceMemory;
  browser: typeof import('../services/browser/BrowserService.js').browserService;
  providerRouter: typeof import('../providers/index.js').providerRouter;
  db: typeof db;
}

const DEFAULT_CONTAINER_OPTIONS: ContainerInitOptions = Object.freeze({ mode: 'full' });

function isValidCredentialString(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (!trimmed) return false;
  if (
    trimmed.startsWith('VOTRE_') ||
    trimmed.includes('SUPABASE_PROJECT_ID') ||
    trimmed.startsWith('${')
  ) {
    return false;
  }
  return true;
}

export function resolveSupabaseCredentials(rawCredentials?: Partial<Credentials>): {
  url: string;
  key: string;
} | null {
  let url = rawCredentials?.supabase?.url;
  let key = rawCredentials?.supabase?.service_role_key || rawCredentials?.supabase?.key;

  if (url && Object.hasOwn(process.env, url)) {
    const envUrl = Reflect.get(process.env, url);
    if (typeof envUrl === 'string' && envUrl) url = envUrl;
  }
  if (key && Object.hasOwn(process.env, key)) {
    const envKey = Reflect.get(process.env, key);
    if (typeof envKey === 'string' && envKey) key = envKey;
  }

  if (!url || !isValidCredentialString(url)) {
    url = process.env.SUPABASE_URL;
  }
  if (!key || !isValidCredentialString(key)) {
    key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  }

  if (isValidCredentialString(url) && isValidCredentialString(key) && url.startsWith('http')) {
    return { url: url.trim(), key: key.trim() };
  }
  return null;
}

function resolveKeyForProvider(provider: string, rawVal?: string): string | null {
  const provLower = provider.toLowerCase();
  let resolved: string | null = null;
  if (typeof rawVal === 'string' && rawVal.trim()) {
    resolved = resolveApiKey(rawVal, provLower);
  }
  if (!isValidCredentialString(resolved)) {
    resolved = resolveApiKey('', provLower);
  }
  if (!isValidCredentialString(resolved) && provLower === 'huggingface') {
    const hfEnv = process.env.HF_TOKEN || process.env.HUGGINGFACE_KEY;
    if (isValidCredentialString(hfEnv)) {
      resolved = hfEnv;
    }
  }
  return isValidCredentialString(resolved) ? resolved : null;
}

export function countConfiguredAiKeys(famillesIa?: Record<string, string>): number {
  const knownProviders = new Set<string>([
    'gemini',
    'openai',
    'anthropic',
    'mistral',
    'groq',
    'huggingface',
    'minimax',
    'codex',
    'cohere',
    'deepseek',
    'openrouter',
  ]);

  if (famillesIa && typeof famillesIa === 'object') {
    for (const key of Object.keys(famillesIa)) {
      knownProviders.add(key.toLowerCase());
    }
  }

  let count = 0;
  for (const provider of knownProviders) {
    const rawVal = famillesIa ? Reflect.get(famillesIa, provider) : undefined;
    if (resolveKeyForProvider(provider, typeof rawVal === 'string' ? rawVal : undefined)) {
      count++;
    }
  }

  return count;
}

export function isRedisConfigured(rawCredentials?: Partial<Credentials>): boolean {
  let url = rawCredentials?.redis?.url;
  if (url && Object.hasOwn(process.env, url)) {
    const envUrl = Reflect.get(process.env, url);
    if (typeof envUrl === 'string' && envUrl) url = envUrl;
  }
  if (!url || !isValidCredentialString(url)) {
    url = process.env.REDIS_URL;
  }
  return (
    isValidCredentialString(url) && (url.startsWith('redis://') || url.startsWith('rediss://'))
  );
}

/**
 * Conteneur d'Injection de Dépendances
 * Gère le cycle de vie et l'accès aux services de l'application
 */
export class ServiceContainer {
  private services: Map<string, ServiceEntry> = new Map();
  private initialized: boolean = false;
  private mode: 'full' | 'minimal' = 'full';
  private initPromise: Promise<void> | null = null;

  public init(options: ContainerInitOptions = DEFAULT_CONTAINER_OPTIONS): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit(options).catch((err) => {
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  private async _doInit(options: ContainerInitOptions): Promise<void> {
    if (this.initialized) return;
    this.mode = options.mode;

    const { credentials, modelsConfig } = this.loadConfig();

    await this.registerBaseServices(credentials);
    await this.registerCoreMemoriesAndConsciousness();

    this.registerEmbeddingService(credentials, modelsConfig);

    await this.registerVoiceServices(credentials, modelsConfig);
    await this.registerMemoryServices();

    const geminiKey = resolveApiKey(credentials.familles_ia?.gemini || '', 'gemini');
    await this.registerLiveAndDreamServices(geminiKey);
    await this.registerBrowserAndProviderRouter();

    this.initialized = true;
  }

  private loadConfig(): { credentials: Credentials; modelsConfig: ModelsConfig } {
    const credentialsPath = resolveConfigPath('credentials.json');
    const modelsPath = resolveConfigPath('models_config.json');

    try {
      const rawCredentials = JSON.parse(safeReadFileSync(credentialsPath, 'utf-8'));
      const rawModelsConfig = JSON.parse(safeReadFileSync(modelsPath, 'utf-8'));

      const parsedCredentials = CredentialsSchema.parse(rawCredentials);
      const parsedModelsConfig = ModelsConfigSchema.parse(rawModelsConfig);

      // Validation stricte du chargement (0 valeur par défaut)
      // 1. Supabase requis : url + clé valides (credentials.json ou variables SUPABASE_URL / SUPABASE_KEY)
      const sbConfig = resolveSupabaseCredentials(parsedCredentials);
      if (!sbConfig) {
        throw new Error(
          '❌ [ServiceContainer] Échec du chargement : Configuration Supabase manquante ou incomplète (supabase.url et supabase.key requis dans credentials.json ou via SUPABASE_URL / SUPABASE_KEY). Démarrage interrompu.',
        );
      }
      parsedCredentials.supabase = sbConfig;

      // 2. Clés IA requises : au moins 1 clé valide (credentials.json sous familles_ia ou variables d\'environnement)
      const validKeyCount = countConfiguredAiKeys(parsedCredentials.familles_ia);
      if (validKeyCount === 0) {
        throw new Error(
          "❌ [ServiceContainer] Échec du chargement : Aucune clé API d'IA configurée (au moins 1 clé requise dans credentials.json sous familles_ia ou via les variables d'environnement). Démarrage interrompu.",
        );
      }

      // 3. Redis : optionnel / non-bloquant
      if (!isRedisConfigured(parsedCredentials)) {
        console.log(
          'ℹ️ [ServiceContainer] Redis non configuré : poursuite du démarrage en mode mémoire local (in-memory mock).',
        );
      }

      return {
        credentials: parsedCredentials,
        modelsConfig: parsedModelsConfig,
      };
    } catch (e) {
      console.error(
        '[ServiceContainer] Erreur lecture config:',
        e instanceof Error ? e.message : String(e),
      );
      throw e;
    }
  }

  private async registerBaseServices(credentials?: Partial<Credentials>) {
    this.register('logger', logger);
    this.register('supabase', db);
    this.register('config', appConfig);

    const { redis, switchToMock } = await import('../services/redisClient.js');
    if (!isRedisConfigured(credentials)) {
      switchToMock(redis);
    }
    this.register('redis', redis);

    const { adminService } = await import('../services/adminService.js');
    await adminService.init();
    this.register('adminService', adminService);

    const { userService } = await import('../services/userService.js');
    this.register('userService', userService);

    const { agentMemory } = await import('../services/agentMemory.js');
    this.register('agentMemory', agentMemory);
  }

  private async registerCoreMemoriesAndConsciousness() {
    const { actionMemory } = await import('../services/memory/ActionMemory.js');
    this.register('actionMemory', actionMemory);

    const { groupService } = await import('../services/groupService.js');
    this.register('groupService', groupService);

    const { workingMemory } = await import('../services/workingMemory.js');
    this.register('workingMemory', workingMemory);

    const { consciousness } = await import('../services/consciousnessService.js');
    this.register('consciousness', consciousness);

    const { moderationService } = await import('../services/moderationService.js');
    this.register('moderation', moderationService);
  }

  private registerEmbeddingService(credentials: Credentials, modelsConfig: ModelsConfig) {
    const keyGemini = credentials.familles_ia?.gemini ?? '';
    const keyOpenai = credentials.familles_ia?.openai ?? '';
    const cfg = modelsConfig.reglages_generaux.embeddings.primary;

    const embeddingConfig: EmbeddingConfig = {
      geminiKey: resolveApiKey(keyGemini, 'gemini') ?? undefined,
      openaiKey: resolveApiKey(keyOpenai, 'openai') ?? undefined,
      model: cfg.model,
      dimensions: cfg.dimensions,
    };

    this.register('embeddings', () => new EmbeddingsService(embeddingConfig), { singleton: true });
  }

  private async registerVoiceServices(credentials: Credentials, modelsConfig: ModelsConfig) {
    const { quotaManager } = await import('../services/quotaManager.js');
    await quotaManager.init();
    this.register('quotaManager', quotaManager);

    const { VoiceProvider } = await import('../services/voice/voiceProvider.js');
    const voiceProviderConfig = modelsConfig.voice_provider || {};
    const voiceProvider = new VoiceProvider(
      voiceProviderConfig,
      quotaManager as unknown as ConstructorParameters<typeof VoiceProvider>[1],
    );
    this.register('voiceProvider', voiceProvider);

    await this.registerMinimaxVoice(credentials, modelsConfig);
    await this.registerGroqSTT(credentials, modelsConfig);
  }

  private async registerMinimaxVoice(credentials: Credentials, modelsConfig: ModelsConfig) {
    const { MinimaxVoiceService } = await import('../services/voice/minimax.js');
    const rawKey = credentials.familles_ia?.minimax ?? '';
    const minimaxKey = resolveApiKey(rawKey, 'minimax') ?? '';
    const voiceConfig = modelsConfig.voice_provider?.minimax_config ?? {};
    this.register('voiceService', new MinimaxVoiceService(minimaxKey, voiceConfig));
  }

  private async registerGroqSTT(credentials: Credentials, modelsConfig: ModelsConfig) {
    const { GroqTranscriptionService } = await import('../services/transcription/groqSTT.js');
    const rawKey = credentials.familles_ia?.groq ?? '';
    const groqKey = resolveApiKey(rawKey, 'groq') ?? '';
    const sttConfig = modelsConfig.voice_provider?.stt_models?.[0] ?? {};
    this.register('transcriptionService', new GroqTranscriptionService(groqKey, sttConfig));
  }

  private async registerMemoryServices() {
    const dbService = this.get('supabase');
    const memoryDeps: SemanticMemoryDependencies = {
      supabase: dbService.client as SupabaseClient,
      embeddings: this.get('embeddings'),
      logger: this.get('logger'),
    };
    const memory = new SemanticMemory(memoryDeps);
    this.register('memory', memory);

    const { graphMemory } = await import('../services/graphMemory.js');
    this.register('graphMemory', graphMemory);

    const { knowledgeWeaver } = await import('../services/knowledgeWeaver.js');
    this.register('knowledgeWeaver', knowledgeWeaver);

    const { consolidationService } = await import('../services/consolidationService.js');
    this.register('consolidationService', consolidationService);
  }

  private async registerLiveAndDreamServices(geminiKey: string | null) {
    const { GeminiLiveProvider } = await import('../services/audio/geminiLiveProvider.js');
    this.register('geminiLiveProvider', new GeminiLiveProvider({ apiKey: geminiKey || '' }));

    const [dreamModule, runtimeModule, contextWindowModule] = await Promise.all([
      import('../services/dreamService.js'),
      import('../services/runtime/RuntimeInfrastructure.js'),
      import('../services/runtime/ContextWindowService.js'),
    ]);
    this.register('dream', dreamModule.dreamService);
    this.register('runtime', () => new runtimeModule.AIRuntimeInfrastructure(), {
      singleton: true,
    });
    this.register('contextWindow', () => new contextWindowModule.ContextWindowService(), {
      singleton: true,
    });

    const { factsMemory, workspaceMemory } = await import('../services/memory.js');
    this.register('facts', factsMemory);
    this.register('workspace', workspaceMemory);
  }

  private async registerBrowserAndProviderRouter() {
    const { browserService } = await import('../services/browser/BrowserService.js');
    this.register('browser', browserService);

    const providerModule = await import('../providers/index.js');
    if (typeof providerModule.loadAdapters === 'function') {
      await providerModule.loadAdapters();
    }
    this.register('providerRouter', providerModule.providerRouter);
  }

  /**
   * Enregistre un service
   */
  public register(name: string, factory: unknown, options: { singleton?: boolean } = {}): this {
    const { singleton = false } = options;
    if (!factory) {
      console.error(`[ServiceContainer] ❌ Tentative d'enregistrement de service NULL: ${name}`);
      return this;
    }
    if (this.services.has(name)) {
      console.warn(`[ServiceContainer] Service ${name} déjà enregistré - remplacement`);
    }
    const factoryFn = typeof factory === 'function' ? (factory as () => unknown) : () => factory;
    this.services.set(name, { factory: factoryFn, singleton, instance: null });
    const factoryObj = factory as { setContainer?: (container: ServiceContainer) => void };
    if (!singleton && typeof factoryObj.setContainer === 'function') {
      factoryObj.setContainer(this);
    }
    return this;
  }

  /**
   * Récupère un service
   */
  public get<K extends keyof ServiceRegistry>(name: K): ServiceRegistry[K];
  public get<T = unknown>(name: string): T;
  public get(name: string): unknown {
    const service = this.services.get(name);
    if (!service) {
      throw new Error(`[ServiceContainer] Service non trouvé: ${name}`);
    }
    if (service.singleton) {
      return this.getSingleton(name, service);
    }
    const instance = service.factory();
    const instObj = instance as { setContainer?: (container: ServiceContainer) => void } | null;
    if (instObj && typeof instObj.setContainer === 'function') {
      instObj.setContainer(this);
    }
    return instance;
  }

  private getSingleton(name: string, service: ServiceEntry): unknown {
    if (!service.instance) {
      console.log(`[ServiceContainer] 🔄 Création singleton: ${name}`);
      service.instance = service.factory();
      const instObj = service.instance as {
        setContainer?: (container: ServiceContainer) => void;
      } | null;
      if (instObj && typeof instObj.setContainer === 'function') {
        instObj.setContainer(this);
      }
    }
    return service.instance;
  }

  public has(name: string): boolean {
    return this.services.has(name);
  }

  public getStats(): ServiceStats {
    const stats: ServiceStats = {
      total: this.services.size,
      singletons: 0,
      instances: 0,
      services: {},
    };

    for (const [name, service] of this.services.entries()) {
      Reflect.set(stats.services, name, {
        singleton: service.singleton,
        created: !!service.instance,
      });
      if (service.singleton) stats.singletons++;
      if (service.instance) stats.instances++;
    }

    return stats;
  }
}

export const container = new ServiceContainer();
Object.assign(globalThis, { container });
export default container;
