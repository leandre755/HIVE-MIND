// core/index.js
// Orchestrateur principal du bot - Cerveau central

import { randomInt } from 'node:crypto';
import { readFileSync, promises as fsPromises } from 'fs';
import { dirname, join } from 'path';

import { fileURLToPath } from 'url';
import { orchestrator } from './orchestrator.js';
import { eventBus, BotEvents } from './events.js';
import { transportManager } from './transport/TransportManager.js';
import { pluginLoader } from '../plugins/loader.js';
import { providerRouter } from '../providers/index.js';
import { scheduler } from '../scheduler/index.js';
import { extractToolCallsFromText, parseToolArguments } from '../utils/toolCallExtractor.js';
import { isStorable } from '../utils/helpers.js';
import { detectResponseDefects, sanitizeResponse } from '../utils/responseSanitizer.js';
import { validateToolArgs, ToolDef } from '../utils/toolValidator.js';
export type ToolCallDef = { id?: string; function: { name: string; arguments?: string } };

// [PTC] Programmatic Tool Calling — Pilier D AION
import { ptcExecutor, buildToolFunctions } from '../services/ptc/index.js';
// [WAKE] WakeSystem — Push-based long-running agent tasks (OpenClaw Heartbeat pattern)
import { hiveWakeSystem } from '../services/ptc/WakeSystem.js';
import { mailboxWatcher } from '../services/events/MailboxWatcher.js';
import { startupDisplay } from '../utils/startup.js';

import { botIdentity } from '../utils/botIdentity.js';
import { extractNumericId, jidMatch } from '../utils/jidHelper.js';

// DTC Refactor: Inclusion du ServiceContainer
import { container } from './ServiceContainer.js';
import type { MessageData, BotEvent } from './types/BotTypes.js';

// Group Manager (filtrage hybride)
let filterProcessor: unknown = null;
try {
  const groupManager = await import('../plugins/whatsapp/group_manager/index.js');
  filterProcessor = groupManager.default.processor;
} catch (e: unknown) {
  console.warn('[Core] Group Manager non chargé:', e instanceof Error ? e.message : String(e));
}

// Refactoring: Import des handlers modulaires
import { SchedulerHandler, GroupHandler } from './handlers/index.js';
// [V3] Unified Context Engineering
import { tieredContextLoader } from './context/TieredContextLoader.js';
import type { ToolInfo } from '../services/agentic/Planner.js';
import { permissionManager } from './security/PermissionManager.js';
import { blueprintManager, AgentBlueprint } from './blueprint/AgentBlueprint.js';
import { fileStateCache } from '../utils/fileStateCache.js';
import { stripHashes } from '../services/anchor/lineHashing.js';

// DTC Phase 1: Les admins globaux sont maintenant dans Supabase via adminService
// Le chargement se fait de manière asynchrone dans init()

// ── Media Indexer (Gemini Embedding 2 — lazy init) ─────────────────────
let _mediaIndexer: import('../services/media/MediaIndexer.js').MediaIndexer | null = null;
let _mediaIndexerLoading = false;

async function getMediaIndexer(): Promise<
  import('../services/media/MediaIndexer.js').MediaIndexer | null
> {
  if (_mediaIndexer) return _mediaIndexer;
  if (_mediaIndexerLoading) return null;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  if (!geminiKey) return null;
  _mediaIndexerLoading = true;
  try {
    const { MultimodalEmbeddingService } =
      await import('../services/ai/MultimodalEmbeddingService.js');
    const { MediaIndexer } = await import('../services/media/MediaIndexer.js');
    const svc = new MultimodalEmbeddingService({ geminiKey });
    svc.init();
    _mediaIndexer = new MediaIndexer(svc);
    console.log('[Core] 📁 MediaIndexer initialisé');
    return _mediaIndexer;
  } catch (e: unknown) {
    console.warn('[Core] MediaIndexer non disponible:', e instanceof Error ? e.message : e);
    return null;
  } finally {
    _mediaIndexerLoading = false;
  }
}

// ── Media Search (Gemini Embedding 2 — lazy init) ─────────────────────
let _mediaSearch: import('../services/media/MediaSearch.js').MediaSearch | null = null;
let _mediaSearchLoading = false;

export async function getMediaSearch(): Promise<
  import('../services/media/MediaSearch.js').MediaSearch | null
> {
  if (_mediaSearch) return _mediaSearch;
  if (_mediaSearchLoading) return null;
  const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
  if (!geminiKey) return null;
  _mediaSearchLoading = true;
  try {
    const { MultimodalEmbeddingService } =
      await import('../services/ai/MultimodalEmbeddingService.js');
    const { MediaSearch } = await import('../services/media/MediaSearch.js');
    const svc = new MultimodalEmbeddingService({ geminiKey });
    svc.init();
    _mediaSearch = new MediaSearch(svc);
    console.log('[Core] 🔍 MediaSearch initialisé');
    return _mediaSearch;
  } catch (e: unknown) {
    console.warn('[Core] MediaSearch non disponible:', e instanceof Error ? e.message : e);
    return null;
  } finally {
    _mediaSearchLoading = false;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));

let persona: { name: string; traits?: string[]; interests?: string[]; role?: string };
try {
  persona = JSON.parse(readFileSync(join(__dirname, '..', 'persona', 'profile.json'), 'utf-8'));
} catch {
  persona = { name: 'Bot', traits: [], interests: [] };
}

// Charger le prompt système
let refusalPrompt: string;
try {
  readFileSync(join(__dirname, '..', 'persona', 'prompts', 'system.md'), 'utf-8');
  // Charger le template de refus s'il existe
  refusalPrompt = readFileSync(join(__dirname, '..', 'persona', 'prompts', 'refusal.md'), 'utf-8');
} catch {
  refusalPrompt = 'You are {{name}}. Politely refuse because: {{reason}}.';
}

/**
 * Noyau principal du bot
 */
export class BotCore {
  transport: typeof transportManager;
  isReady: boolean;
  FEEDBACK_TIMEOUT_MS: number;
  QUICK_ACKNOWLEDGMENTS: string[];
  schedulerHandler!: SchedulerHandler;
  groupHandler!: GroupHandler;
  currentBlueprint: AgentBlueprint;
  _cachedBotId?: string;
  _cachedBotLid?: string;

  constructor() {
    this.transport = transportManager;
    this.isReady = false;

    // Load blueprint with fallback
    try {
      this.currentBlueprint = blueprintManager.loadBlueprint('hive_main');
    } catch (e: unknown) {
      console.warn(
        '[Core] Failed loading hive_main blueprint, using safe fallback:',
        e instanceof Error ? e.message : String(e),
      );
      this.currentBlueprint = {
        metadata: { id: 'fallback', name: 'Safe Fallback', version: '0.1.0' },
        mindos: { drives: [] },
        action_space: { allowed_tools: ['send_message', 'read_file'] },
        constraints: { read_only_fs: false, max_budget_usd: 1.0, max_iterations: 10 },
      };
    }

    // [FEEDBACK FIRST] Constantes pour réponse rapide < 30s
    this.FEEDBACK_TIMEOUT_MS = 25000; // 25 secondes max avant accusé de réception
    this.QUICK_ACKNOWLEDGMENTS = [
      'Je réfléchis... 🤔',
      'Laisse-moi 2 secondes... 💭',
      'Je cherche ça... 🔍',
      'Hmm, intéressant... 🧐',
      'Un instant... ⏳',
    ];
  }

  // Getters pour accès facile aux services via container
  async getMediaSearch() {
    return getMediaSearch();
  }
  get db() {
    return container.get('supabase');
  }
  get workingMemory() {
    return container.get('workingMemory');
  }
  get consciousness() {
    return container.get('consciousness');
  }
  get userService() {
    return container.get('userService');
  }
  get groupService() {
    return container.get('groupService');
  }
  get adminService() {
    return container.get('adminService');
  }
  get agentMemory() {
    return container.get('agentMemory');
  }
  get actionMemory() {
    return container.get('actionMemory');
  }
  get factsMemory() {
    return container.get('facts');
  }
  get semanticMemory() {
    return container.get('memory');
  }
  get voiceProvider() {
    return container.get('voiceProvider');
  }
  get quotaManager() {
    return container.get('quotaManager');
  }
  get runtime() {
    return container.get('runtime');
  }

  async _fetchRagLiveTools(toolsByName: Map<string, ToolDef>): Promise<void> {
    try {
      const { supabase } = await import('../services/supabase.js');
      const embeddingsService = container.has('embeddings') ? container.get('embeddings') : null;
      if (!supabase || !embeddingsService) return;

      const queryVector = await (
        embeddingsService as { embed: (text: string) => Promise<unknown> }
      ).embed('conversation vocale recherche information');
      if (!queryVector) return;

      const { data } = await supabase.rpc('match_tools', {
        query_embedding: queryVector,
        match_count: 5,
      });

      if (!data || data.length === 0) return;

      let added = 0;
      for (const match of data) {
        const name = match.definition?.function?.name;
        if (name && !toolsByName.has(name) && added < 2) {
          toolsByName.set(name, match.definition);
          added++;
        }
      }
    } catch (e: unknown) {
      console.warn(
        '[GeminiLive] RAG fallback: direct query failed:',
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  async _getLiveAudioTools() {
    // Gemini Live API crashes (1011) when setup payload exceeds ~10KB.
    // getRelevantTools() injects 14 CORE_TOOLS — we bypass it entirely.
    // Strategy: 3 hardcoded essentials + 2 RAG-selected tools.

    const HARDCODED_TOOLS = ['send_message', 'google_ai_search', 'get_my_capabilities'];
    const allToolDefs = (pluginLoader as { toolDefinitions?: ToolDef[] }).toolDefinitions || [];

    // 1. Hardcoded essentials
    const toolsByName = new Map<string, ToolDef>();
    for (const tool of allToolDefs) {
      const name = tool?.function?.name;
      if (name && HARDCODED_TOOLS.includes(name)) {
        toolsByName.set(name, tool);
      }
    }

    // 2. Direct RAG query (bypass getRelevantTools to avoid CORE_TOOLS injection)
    await this._fetchRagLiveTools(toolsByName);

    const tools = Array.from(toolsByName.values());
    console.log(
      `[GeminiLive] 🔧 ${tools.length} tools for Live: ${tools.map((t: ToolDef) => t.function?.name).join(', ')}`,
    );
    return tools;
  }

  async _executeLiveTool(
    name: string,
    args: Record<string, unknown>,
    message: MessageData,
    availableTools: ToolDef[],
    authority: unknown,
  ) {
    // [GLOBAL RETRY AND DEFENSE SYSTEM] Pre-execution argument validation (Layer A)
    const validation = validateToolArgs(name, JSON.stringify(args || {}), availableTools);
    if (!validation.valid) {
      console.warn(`[GeminiLive] ⚠️ Validation failed for "${name}": ${validation.formattedError}`);
      return {
        success: false,
        error: 'TOOL_VALIDATION_ERROR',
        message:
          validation.formattedError +
          `\nYou MUST retry this tool call immediately with correct parameters. Expected schema: ${JSON.stringify(validation.schema, null, 0)}`,
        missing_params: validation.missing,
      };
    }

    if (name === 'code_execution') {
      console.log('[PTC] ⚡ Exécution programmatique déclenchée via Gemini Live');
      const code = args?.code;
      if (!code || typeof code !== 'string') {
        return { success: false, error: 'code_execution requires a string "code" argument.' };
      }

      const chatId = message.chatId;
      const toolFns = buildToolFunctions(
        availableTools as unknown as Parameters<typeof buildToolFunctions>[0],
        (toolName: string, toolArgs: Record<string, unknown>, ctx: unknown) =>
          pluginLoader.execute(
            toolName,
            toolArgs,
            ctx as unknown as Parameters<typeof pluginLoader.execute>[2],
          ),
        {
          transport: this.transport,
          message,
          chatId,
          sender: message.sender,
          sourceChannel: message.sourceChannel,
          onProgress: (status: string) => {
            eventBus.publish(BotEvents.TOOL_PROGRESS, { tool: 'code_execution', status, chatId });
          },
        },
      );

      try {
        const hiveBridge = hiveWakeSystem.buildHiveBridge(chatId);
        hiveWakeSystem.registerWakeCallback(chatId, async (wakeEvent) => {
          console.log(`[WakeSystem] ⏰ Réveil contextuel pour chatId=${chatId}`);
          await this._onMessage({
            chatId: wakeEvent.chatId,
            sender: 'system@wake',
            senderName: 'WAKE_SYSTEM',
            text: `[WAKE_EVENT] ${wakeEvent.prompt}`,
            isGroup: wakeEvent.chatId?.endsWith('@g.us') ?? false,
            isSystem: true,
            sourceChannel: 'internal',
          } as MessageData);
        });

        const ptcResult = await ptcExecutor.execute(code, toolFns, hiveBridge);
        if (ptcResult.metadata.sleepScheduled) {
          const sleep = ptcResult.metadata.sleepScheduled;
          return {
            success: true,
            type: 'SLEEP_SCHEDULED',
            message: sleep.message,
            wakeEventId: sleep.wakeEventId,
            wakeAtMs: sleep.wakeAtMs,
          };
        }
        return ptcResult;
      } catch (error: unknown) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    return this._safeExecuteTool(
      { id: `live_${Date.now()}`, function: { name, arguments: JSON.stringify(args || {}) } },
      {
        chatId: message.chatId,
        message,
        authority: authority as
          { isSuperUser?: boolean; isGlobalAdmin?: boolean; level?: number } | undefined,
      },
    );
  }

  async _syncPluginTools(supabase: unknown) {
    const supaClient = supabase as {
      from: (t: string) => {
        upsert: (
          data: Record<string, unknown>,
          opts: { onConflict: string },
        ) => Promise<{ error: unknown }>;
      };
    };
    try {
      const embeddings = container.get('embeddings');
      const tools = pluginLoader.getToolDefinitions();
      let indexed = 0;
      for (const tool of tools) {
        const toolName = tool.function?.name;
        if (!toolName) continue;
        const vector = await embeddings.embed(`${toolName}: ${tool.function?.description}`);
        if (!vector) continue;
        const { error } = await supaClient.from('bot_tools').upsert(
          {
            name: toolName,
            plugin_name: toolName.split('_')[0],
            description: tool.function?.description,
            definition: tool,
            embedding: vector,
          },
          { onConflict: 'name' },
        );
        if (!error) indexed++;
      }
      return indexed;
    } catch (syncErr: unknown) {
      console.warn(
        '[Core] Erreur auto-sync plugins:',
        syncErr instanceof Error ? syncErr.message : String(syncErr),
      );
      return 0;
    }
  }

  _resolveActiveTransports(): string[] {
    let activeTransports = process.env.ACTIVE_TRANSPORTS
      ? process.env.ACTIVE_TRANSPORTS.split(',')
      : ['whatsapp'];

    const appEnv = process.env.APP_ENV || 'local';
    const tuiExplicitlyRequested = activeTransports.includes('ink-cli');

    if (!tuiExplicitlyRequested && (appEnv === 'server' || !process.stdin.isTTY)) {
      console.log(
        `[Core] 🌐 Mode ${appEnv === 'server' ? 'SERVEUR' : 'NON-TTY'} (Headless). CLI désactivée.`,
      );
      activeTransports = activeTransports.filter((t) => t !== 'cli' && t !== 'ink-cli');
    } else if (!tuiExplicitlyRequested && appEnv === 'local') {
      console.log('[Core] 💻 Mode LOCAL. Activation de la CLI (Ink).');
      if (!activeTransports.includes('ink-cli')) {
        activeTransports.push('ink-cli');
      }
    } else if (tuiExplicitlyRequested) {
      console.log('[Core] 🎯 Transport TUI (ink-cli) explicitement demandé — bypass du check TTY.');
    }

    return activeTransports;
  }

  async _initServices(): Promise<void> {
    startupDisplay.loading('config');
    try {
      await container.init();
      this.transport.setContainer(container);
      container.register('transport', this.transport);
      tieredContextLoader.init();
      startupDisplay.success('config');
    } catch (e: unknown) {
      startupDisplay.error('config', e instanceof Error ? e.message : String(e));
    }

    startupDisplay.loading('redis');
    try {
      const redisMemory = container.get('workingMemory');
      const redisHealth = await redisMemory.checkHealth();
      if (redisHealth.status === 'connected' || redisHealth.status === 'healthy') {
        startupDisplay.success('redis', 'connected');
      } else {
        startupDisplay.error('redis', redisHealth.error || `Status: ${redisHealth.status}`);
      }
    } catch (e: unknown) {
      startupDisplay.error('redis', e instanceof Error ? e.message : String(e));
    }

    startupDisplay.loading('supabase');
    try {
      const supabaseService = container.get('supabase');
      const supaHealth = await supabaseService.checkHealth();
      if (supaHealth.status === 'connected') {
        startupDisplay.success('supabase', 'service_role');
      } else {
        startupDisplay.error('supabase', supaHealth.error || 'non connecté');
      }
    } catch (e: unknown) {
      startupDisplay.error('supabase', e instanceof Error ? e.message : String(e));
    }
  }

  async _initSchedulerAndReflection(): Promise<void> {
    const isLocalOrCli = process.env.APP_ENV === 'local' || process.env.ACTIVE_TRANSPORTS === 'cli';
    if (isLocalOrCli) {
      console.log(
        '[Core] 🛡️ Mode LOCAL/CLI détecté : désactivation du Scheduler, WakeSystem, MailboxWatcher et FeedbackService pour économiser le budget API.',
      );
      return;
    }

    startupDisplay.loading('scheduler');
    try {
      scheduler.init();
      startupDisplay.success('scheduler');
    } catch (e: unknown) {
      startupDisplay.error('scheduler', e instanceof Error ? e.message : String(e));
    }

    hiveWakeSystem.start();
    mailboxWatcher.start();
    hiveWakeSystem.on('wake', async (event: { chatId: string; prompt: string }) => {
      console.log(
        `[WakeSystem] ⏰ Réveil générique pour chatId=${event.chatId}, prompt="${event.prompt.slice(0, 60)}..."`,
      );
      await this._onMessage({
        chatId: event.chatId,
        sender: 'system@wake',
        senderName: 'WAKE_SYSTEM',
        text: `[WAKE_EVENT] ${event.prompt}`,
        isGroup: event.chatId?.endsWith('@g.us') ?? false,
        isSystem: true,
        sourceChannel: 'internal',
      } as MessageData);
    });

    startupDisplay.loading('reflection');
    try {
      const { feedbackService } = await import('../services/feedbackService.js');
      feedbackService.init();
      startupDisplay.success('reflection', 'feedback active');
    } catch (e: unknown) {
      startupDisplay.error('reflection', e instanceof Error ? e.message : String(e));
    }
  }

  async _loadAndSyncPlugins(): Promise<void> {
    startupDisplay.loading('plugins');
    try {
      const loadedPlugins = await pluginLoader.loadAll();

      const supabase = container.get('supabase');
      const syncStatus = await pluginLoader.checkSyncStatus(
        supabase.client as unknown as Parameters<typeof pluginLoader.checkSyncStatus>[0],
      );
      let syncDetails = `${loadedPlugins?.size || 0} loaded`;

      if (syncStatus.deleted > 0 || syncStatus.new > 0 || syncStatus.modified > 0) {
        const parts = [];
        if (syncStatus.new > 0) parts.push(`+${syncStatus.new} new`);
        if (syncStatus.modified > 0) parts.push(`~${syncStatus.modified} mod`);
        if (syncStatus.deleted > 0) parts.push(`-${syncStatus.deleted} del`);
        syncDetails += ` [${parts.join(', ')}]`;

        const skipSync = process.env.APP_ENV === 'local' || process.env.NODE_ENV === 'test';
        if (!skipSync && (syncStatus.new > 0 || syncStatus.modified > 0)) {
          const indexed = await this._syncPluginTools(supabase);
          syncDetails += ` (Synched: ${indexed})`;
        }
      }

      startupDisplay.success('plugins', syncDetails);
    } catch (e: unknown) {
      startupDisplay.error('plugins', e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * Initialise tous les composants
   */
  async init() {
    if (this.isReady) return;

    startupDisplay.setModules([
      { id: 'config', name: 'Configuration', icon: '⚙️' },
      { id: 'redis', name: 'Redis Cloud', icon: '🔴' },
      { id: 'supabase', name: 'Supabase DB', icon: '🗄️' },
      { id: 'plugins', name: 'Plugins', icon: '🔌' },
      { id: 'scheduler', name: 'Scheduler', icon: '⏰' },
      { id: 'reflection', name: 'Intelligence', icon: '🧠' },
      { id: 'transport', name: 'Connexion WhatsApp', icon: '📱' },
    ]);

    startupDisplay.showLogo();

    await this._initServices();
    await this._loadAndSyncPlugins();
    this._registerHandlers();
    await this._initSchedulerAndReflection();

    // 6. Connecter le transport
    startupDisplay.loading('transport');
    try {
      const activeTransports = this._resolveActiveTransports();
      await this.transport.initialize(activeTransports);
      startupDisplay.success('transport', `Connecté (${activeTransports.join(', ')})`);
    } catch (e: unknown) {
      startupDisplay.error('transport', e instanceof Error ? e.message : String(e));
    }

    // 6. Configurer les callbacks
    this.transport.onMessage((msg: MessageData) => this._onMessage(msg));
    this.transport.onGroupEvent((event: unknown) =>
      this._onGroupEvent(event as { groupId: string; [key: string]: unknown }),
    );

    // 7. Résilience: Vérifier les tâches interrompues
    await this._resumePendingActions();

    this.isReady = true;
    startupDisplay.complete(persona.name);
  }

  /**
   * Enregistre les handlers pour l'orchestrateur
   */
  _registerHandlers() {
    // Initialiser les handlers modulaires
    this.schedulerHandler = new SchedulerHandler(this.transport);
    this.schedulerHandler.setMessageHandler(this._handleMessage.bind(this));

    this.groupHandler = new GroupHandler(this.transport);
    this.groupHandler.setWelcomeHandler(this._handleGroupWelcome.bind(this));

    // Enregistrement des handlers dans l'orchestrateur
    orchestrator.registerHandler('message', async (event: unknown) => {
      await this._handleMessage(event as BotEvent);
    });

    orchestrator.registerHandler('scheduled', async (event: unknown) => {
      await this.schedulerHandler?.handleJob(
        event as unknown as import('./handlers/schedulerHandler.js').SchedulerJobEvent,
      );
    });

    orchestrator.registerHandler('proactive', async (event: unknown) => {
      await this._handleProactive(event as BotEvent);
    });

    orchestrator.registerHandler('group_event', async (event: unknown) => {
      await this.groupHandler?.handleEvent(
        event as unknown as import('./handlers/groupHandler.js').GroupEventEnvelope,
      );
    });
  }

  /**
   * Callback sur réception de message
   */
  async _onMessage(message: MessageData) {
    const { workingMemory } = this;
    if (!message.text?.trim()) return;

    // [GOAL SEEKING] Tracker l'activité du groupe
    if (message.isGroup) {
      workingMemory.trackGroupActivity(message.chatId).catch(() => {});
    }

    // VERIFICATION MUTE (Silence)
    // Si l'utilisateur est mute dans ce groupe, on ignore totalement
    if (message.isGroup) {
      const isMuted = await workingMemory.isMuted(message.chatId, message.sender);
      if (isMuted) {
        console.log(`[Core] Message ignoré (User Muted): ${message.sender} dans ${message.chatId}`);
        return;
      }
    }

    orchestrator.enqueue({
      type: 'message',
      chatId: message.chatId,
      data: message,
      priority: 1,
    } as unknown as Parameters<typeof orchestrator.enqueue>[0]);
  }

  _onGroupEvent(event: { groupId: string; [key: string]: unknown }) {
    orchestrator.enqueue({
      type: 'group_event',
      chatId: event.groupId,
      data: event,
      priority: 3,
    } as unknown as Parameters<typeof orchestrator.enqueue>[0]);
  }

  /**
   * (Module 3) Logique de Bienvenue & Roadmap
   */
  async _handleGroupWelcome(event: BotEvent) {
    const { db } = this;
    const { groupId, participants, action } = event.data as {
      groupId: string;
      participants: string[];
      action: string;
    };

    if (action !== 'add') return;

    // 1. Récupérer la config du groupe
    const config = await db.getGroupConfig(groupId);

    // 2. Message de bienvenue personnalisé ou défaut
    const welcomeTemplate = config?.welcome_message || 'Bienvenue @user !';

    for (const participant of participants) {
      const userJid = participant;
      const userName = userJid.split('@')[0];

      const message = welcomeTemplate.replace('@user', `@${userName}`);

      await this.transport.sendText(groupId, message, {
        mentions: [userJid],
      });
    }
  }

  _getEffectiveBotIdentifiers() {
    const rawBotId = this.transport.sock?.user?.id;
    const botLid = this.transport.sock?.user?.lid;

    if (rawBotId) this._cachedBotId = rawBotId;
    if (botLid) this._cachedBotLid = botLid;

    const effectiveBotId = rawBotId || this._cachedBotId;
    let resolvedBotLid = botLid || this._cachedBotLid;

    if (!resolvedBotLid && effectiveBotId) {
      try {
        const userSvc = this.userService;
        if (userSvc?.getLidForJid) {
          const lid = userSvc.getLidForJid(effectiveBotId);
          if (lid) {
            resolvedBotLid = lid;
            this._cachedBotLid = lid;
          }
        }
      } catch {
        // Non-critical
      }
    }

    if (!effectiveBotId && !resolvedBotLid) {
      console.warn(
        '[Core] ⚠️ Bot identity unavailable (socket reconnecting?), falling back to name detection only',
      );
    }

    return { effectiveBotId, resolvedBotLid };
  }

  /**
   * (Fix 1) Détermine si le bot est sollicité
   */
  _isBotMentioned(message: MessageData, text: string) {
    if (!message.isGroup) return true;

    const msg = message as MessageData & {
      mentionedJids?: string[];
      quotedMsg?: { sender?: string; text?: string; hasImage?: boolean; hasVideo?: boolean };
    };

    const { effectiveBotId, resolvedBotLid } = this._getEffectiveBotIdentifiers();

    const mentionedJids = msg.mentionedJids || [];
    for (const jid of mentionedJids) {
      if (jidMatch(jid, effectiveBotId) || jidMatch(jid, resolvedBotLid)) {
        console.log(`[DEBUG] ✓ Détecté via @mention (jid=${jid})`);
        return true;
      }
    }

    const botPhoneId = extractNumericId(effectiveBotId);
    const botLidId = extractNumericId(resolvedBotLid);

    if ((botPhoneId && text.includes(botPhoneId)) || (botLidId && text.includes(botLidId))) {
      return true;
    }

    if (msg.quotedMsg?.sender) {
      if (
        jidMatch(msg.quotedMsg.sender, effectiveBotId) ||
        jidMatch(msg.quotedMsg.sender, resolvedBotLid)
      ) {
        console.log('[DEBUG] ✓ Détecté via quotedMsg (jidMatch)');
        return true;
      }
    }

    if (botIdentity.isMentioned(text)) {
      console.log('[DEBUG] ✓ Détecté via nom (botIdentity)');
      return true;
    }

    console.log('[DEBUG] ✗ Bot NON mentionné');
    return false;
  }

  async _checkAutonomousEventTriggers(message: MessageData, senderName: string): Promise<void> {
    try {
      const { goalsService } = await import('../services/goalsService.js');
      const triggeredGoals = await goalsService.checkEventTriggers(message);

      if (triggeredGoals.length > 0) {
        console.log(
          `[EventTrigger] 🎯 ${triggeredGoals.length} objectif(s) déclenché(s) par ce message !`,
        );
        for (const goal of triggeredGoals) {
          await goalsService.markInProgress(goal.id);

          setTimeout(async () => {
            await this._onMessage({
              isGroup: goal.target_chat_id ? goal.target_chat_id.endsWith('@g.us') : false,
              chatId: goal.target_chat_id,
              text: `SYSTEM_GOAL_TRIGGER: L'objectif "${goal.title}" a été déclenché par un événement (Reçu message de ${senderName}).\nConsigne: ${goal.description}\nPriorité: ${goal.priority}`,
              senderName: 'SYSTEM_EVENT_LISTENER',
              sender: 'system@internal',
              isSystem: true,
            } as MessageData);
          }, 500);
        }
      }
    } catch (e: unknown) {
      console.error(
        '[EventTrigger] Erreur vérification:',
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  _performIdentityLinking(message: MessageData & { raw?: { key?: unknown } }): void {
    if (!message.sender || !message.raw) return;
    try {
      const userSvc = container.get('userService');
      if (!userSvc) return;

      const rawKey = (message.raw.key as Record<string, unknown>) || {};
      const candidate1 = message.sender;
      const candidate2 = rawKey.participant as string | undefined;

      if (!candidate1 || !candidate2 || candidate1 === candidate2) return;

      let jid: string | null = null;
      if (candidate1.endsWith('@s.whatsapp.net')) {
        jid = candidate1;
      } else if (candidate2.endsWith('@s.whatsapp.net')) {
        jid = candidate2;
      }

      let lid: string | null = null;
      if (candidate1.endsWith('@lid')) {
        lid = candidate1;
      } else if (candidate2.endsWith('@lid')) {
        lid = candidate2;
      }

      if (jid && lid) {
        console.log(`[Identity] 🔗 LINK DÉTECTÉ: ${jid} ↔ ${lid}`);
        userSvc.registerLid(jid, lid).catch(() => {});
      }
    } catch (e: unknown) {
      console.warn('[Identity] Erreur linking:', e instanceof Error ? e.message : String(e));
    }
  }

  async _handleGroupTaskCommand(
    text: string,
    message: MessageData,
    chatId: string,
    sender: string,
  ): Promise<boolean> {
    const groupManager = pluginLoader.get('group_manager');
    if (!groupManager) return false;

    const parsed = (
      groupManager as unknown as {
        parseTextCommand: (t: string) => { name: string; args: unknown } | null;
      }
    ).parseTextCommand(text);
    if (!parsed) return false;

    console.log(`[Core] Commande .task détectée: ${parsed.name}`);
    const result = await groupManager.execute(
      parsed.args as Record<string, unknown>,
      { transport: this.transport, message, chatId, sender },
      parsed.name,
    );
    await this.transport.sendText(chatId, result.message);
    return true;
  }

  async _handlePermissionOrTaskCommand(
    text: string,
    isGroup: boolean,
    message: MessageData,
    chatId: string,
    sender: string,
  ): Promise<boolean> {
    if (
      (text.startsWith('.approve') || text.startsWith('.reject')) &&
      permissionManager.handleAdminCommand(text)
    ) {
      console.log('[Core] 🏢 Commande Admin Hub consommée par le PermissionManager');
      return true;
    }

    if (permissionManager.handleUserResponse(text)) {
      console.log('[Core] 🛡️ Message consommé par le PermissionManager (In-Band)');
      return true;
    }

    if (
      text.toLowerCase().startsWith('.task') &&
      isGroup &&
      (await this._handleGroupTaskCommand(text, message, chatId, sender))
    ) {
      return true;
    }

    if (isGroup && filterProcessor) {
      try {
        const filterResult = await (
          filterProcessor as unknown as {
            process: (m: MessageData, t: unknown) => Promise<{ action?: string }>;
          }
        ).process(message, this.transport);
        if (filterResult?.action) {
          console.log(`[Filter] Action exécutée: ${filterResult.action}`);
          return true;
        }
      } catch (e: unknown) {
        console.error('[Filter] Erreur:', e instanceof Error ? e.message : String(e));
      }
    }

    return false;
  }

  async _handleTextCommandOrInterception(
    message: MessageData,
    text: string,
    chatId: string,
    sender: string,
    isGroup: boolean,
  ): Promise<boolean> {
    const textCommand = pluginLoader.findTextHandler(
      text,
      message as unknown as Record<string, unknown>,
    );
    if (textCommand) {
      console.log(`[Core] ⌨️ Commande textuelle détectée: ${textCommand.name}`);
      const result = await pluginLoader.execute(textCommand.name, textCommand.args, {
        transport: this.transport,
        message,
        chatId,
        sender,
        isGroup,
      });

      if (result && result.message) {
        await this.transport.sendText(chatId, result.message);
      }
      return true;
    }

    return this._handlePermissionOrTaskCommand(text, isGroup, message, chatId, sender);
  }

  /**
   * Traite un message
   */
  private async _shouldProcessMessage(
    message: MessageData & { quotedMsg?: { sender?: string } },
    text: string,
    chatId: string,
    sender: string,
    senderName: string,
    isGroup: boolean,
  ): Promise<{ process: boolean; mentionsBot: boolean; isContextualReply: boolean }> {
    const mentionsBot = this._isBotMentioned(message, text);
    const isPrivate = !isGroup;
    const hasImage = message.mediaType === 'image';
    const isImageForBot =
      hasImage &&
      (isPrivate || mentionsBot || message.quotedMsg?.sender === this.transport.sock?.user?.id);

    let isContextualReply = false;
    if (isGroup && !mentionsBot) {
      const lastInteraction = await this.workingMemory.getLastInteraction(chatId);
      const velocity = await this.workingMemory.getChatVelocity(chatId);
      if (
        lastInteraction &&
        lastInteraction.user === sender &&
        Date.now() - lastInteraction.timestamp < 120000 &&
        velocity.uniqueSenders <= 1
      ) {
        console.log(`[Core] 🗣️ Conversation Suivie détectée (User: ${senderName})`);
        isContextualReply = true;
      }
    }

    if (!mentionsBot && !isPrivate && !isContextualReply && !isImageForBot) {
      const interests = persona.interests || [];
      const hasInterest = interests.some((topic: string) =>
        text.toLowerCase().includes(topic.toLowerCase()),
      );
      if (!hasInterest) return { process: false, mentionsBot, isContextualReply };
    }

    return { process: true, mentionsBot, isContextualReply };
  }

  private async _recordUserMessageAndPresence(
    message: MessageData,
    text: string,
    chatId: string,
    sender: string,
    senderName: string,
    isGroup: boolean,
  ): Promise<void> {
    const { workingMemory, userService } = this;
    await userService.recordInteraction(sender, senderName, isGroup ? chatId : null);

    if (isGroup) {
      const groupService = container.get('groupService');
      groupService.trackActivity(chatId, sender).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Core] trackActivity failed for chatId=%s:', chatId, msg);
      });
      const speakerHash = await userService.getSpeakerHash(sender);
      await workingMemory.addMessage(chatId, 'user', text, speakerHash, senderName);
    } else {
      await workingMemory.addMessage(chatId, 'user', text);
    }

    if (isStorable(text, 'user')) {
      const memory = container.get('memory');
      memory.store(chatId, text, 'user').catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Core] memory.store (user) failed for chatId=%s:', chatId, msg);
      });
    }

    await this.transport.setPresence(chatId, 'composing', message.sourceChannel);
  }

  private async _handleNativeAudioFlow(
    message: MessageData & { audioBuffer?: Buffer },
    chatId: string,
  ): Promise<boolean> {
    if (!message.audioBuffer) {
      return false;
    }

    if (!container.has('geminiLiveProvider')) {
      console.warn('[Core] ⚠️ Flag useNativeAudio actif mais provider manquant. Fallback cascade.');
      return false;
    }

    const geminiLive = container.get('geminiLiveProvider');
    const hiveCfg = container.get('config');

    const context: {
      authority?: unknown;
      systemPrompt?: string;
      history?: Record<string, unknown>[];
    } = await tieredContextLoader.load(
      chatId,
      message as unknown as {
        sender: string;
        sourceChannel?: string;
        systemContext?: string;
        [key: string]: unknown;
      },
    );

    const relevantTools = await this._getLiveAudioTools();

    geminiLive.toolExecutor = async (
      name: string,
      args: Record<string, unknown>,
    ): Promise<Record<string, unknown>> => {
      console.log(`[Core] 🛠️ Exécution tool via Live: ${name}`);
      return (await this._executeLiveTool(
        name,
        args,
        message,
        relevantTools,
        context.authority,
      )) as Record<string, unknown>;
    };

    let response: {
      audioFile?: string | null;
      transcribedText?: string | null;
      toolCalls?: unknown[];
    } | null = null;
    try {
      response = await geminiLive.processAudioWithTools({
        audioBuffer: message.audioBuffer,
        systemPrompt: context.systemPrompt,
        tools: relevantTools as unknown as Parameters<
          typeof geminiLive.processAudioWithTools
        >[0]['tools'],
        voice: hiveCfg.models?.reglages_generaux?.audio_strategy?.native_voice || 'Aoede',
      });
    } catch (apiError: unknown) {
      const apiMsg = apiError instanceof Error ? apiError.message : String(apiError);
      console.error('[Core] ❌ Erreur API Gemini Live:', apiMsg);
      await this.transport.sendText(
        chatId,
        "⚠️ Une erreur technique s'est produite avec l'API vocale (timeout ou déconnexion). Peux-tu reformuler ?",
      );
      return true;
    }

    if (response?.audioFile) {
      try {
        const converter = await import('../services/audio/audioConverter.js');
        const fs = await import('fs');
        const outputOgg = response.audioFile.replace('.pcm', '.ogg');
        await converter.convertPcmToOgg(response.audioFile, outputOgg);
        await this.transport.sendVoiceNote(chatId, outputOgg);

        setTimeout(() => {
          try {
            fs.unlinkSync(response.audioFile!);
          } catch {
            /* ignore */
          }
          try {
            fs.unlinkSync(outputOgg);
          } catch {
            /* ignore */
          }
        }, 10000);
      } catch (e: unknown) {
        const eMsg = e instanceof Error ? e.message : String(e);
        console.error('[Core] ❌ Erreur envoi vocal natif:', eMsg);
      }
    } else if (response?.transcribedText) {
      await this.transport.sendText(chatId, response.transcribedText);
    } else if (response?.toolCalls && response.toolCalls.length > 0) {
      console.log(
        `[Core] 🛠️ Live: ${response.toolCalls.length} tool(s) exécuté(s), pas de réponse vocale (normal pour les actions).`,
      );
    }

    if (response?.transcribedText) {
      await this.workingMemory.addMessage(chatId, 'assistant', response.transcribedText);
    }

    return true;
  }

  private async _fetchDirectImageBlock(
    message: MessageData,
  ): Promise<{ type: string; image_url: { url: string } } | null> {
    if (message.mediaType !== 'image') return null;
    try {
      console.log('[Core] 📷 Téléchargement image directe...');
      const buffer = await this.transport.downloadMedia(message);
      if (buffer) {
        console.log('[Core] ✅ Image directe téléchargée');
        return {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${buffer.toString('base64')}` },
        };
      }
    } catch (e: unknown) {
      const eMsg = e instanceof Error ? e.message : String(e);
      console.error('[Core] ❌ Erreur téléchargement image directe:', eMsg);
    }
    return null;
  }

  private async _fetchQuotedImageBlock(
    message: MessageData & { quotedMsg?: { hasImage?: boolean } },
  ): Promise<{ type: string; image_url: { url: string } } | null> {
    if (!message.quotedMsg?.hasImage) return null;
    try {
      console.log('[Core] 📷 Téléchargement image du quoted message...');
      const quotedBuffer = await this.transport.downloadQuotedMedia(message);
      if (quotedBuffer) {
        console.log('[Core] ✅ Image quoted téléchargée');
        return {
          type: 'image_url',
          image_url: { url: `data:image/jpeg;base64,${quotedBuffer.toString('base64')}` },
        };
      }
    } catch (e: unknown) {
      const eMsg = e instanceof Error ? e.message : String(e);
      console.error('[Core] ❌ Erreur téléchargement image quoted:', eMsg);
    }
    return null;
  }

  private async _downloadMediaImages(
    message: MessageData & { quotedMsg?: { hasImage?: boolean } },
  ): Promise<Array<{ type: string; image_url: { url: string } }>> {
    const imageBlocks: Array<{ type: string; image_url: { url: string } }> = [];
    const direct = await this._fetchDirectImageBlock(message);
    if (direct) imageBlocks.push(direct);
    const quoted = await this._fetchQuotedImageBlock(message);
    if (quoted) imageBlocks.push(quoted);
    return imageBlocks;
  }

  private async _downloadMediaDocumentNotice(
    message: MessageData & { raw?: unknown },
    senderName: string,
    chatId: string,
  ): Promise<string | null> {
    if (
      message.mediaType !== 'document' &&
      message.mediaType !== 'video' &&
      message.mediaType !== 'audio'
    ) {
      return null;
    }
    try {
      console.log(`[Core] 📁 Téléchargement fichier temporaire (${message.mediaType})...`);
      const buffer = await this.transport.downloadMedia(message);
      if (!buffer) return null;

      let originalFileName = '';
      const rawMsg =
        ((message.raw as Record<string, unknown>)?.message as Record<string, unknown>) ||
        (message.raw as Record<string, unknown>);

      const docMsg = rawMsg?.documentMessage as Record<string, unknown> | undefined;
      const docWithCaption = rawMsg?.documentWithCaptionMessage as
        Record<string, unknown> | undefined;
      const nestedDocMsg = (docWithCaption?.message as Record<string, unknown>)?.documentMessage as
        Record<string, unknown> | undefined;

      if (docMsg?.fileName) {
        originalFileName = docMsg.fileName as string;
      } else if (docMsg?.title) {
        originalFileName = docMsg.title as string;
      } else if (nestedDocMsg?.fileName) {
        originalFileName = nestedDocMsg.fileName as string;
      } else if (message.mediaType === 'audio') {
        originalFileName = `vocal_${Date.now()}.ogg`;
      } else if (message.mediaType === 'video') {
        originalFileName = `video_${Date.now()}.mp4`;
      } else {
        originalFileName = `fichier_${Date.now()}`;
      }

      const fs = await import('fs');
      const path = await import('path');

      const downloadDir = path.join(process.cwd(), 'hm_storage', 'tmp_download');
      await fs.promises.mkdir(downloadDir, { recursive: true });

      const safeFileName = path.basename(originalFileName).replace(/[^a-zA-Z0-9.\-_ ()]/g, '_');
      const filePath = path.join(downloadDir, safeFileName);

      await fs.promises.writeFile(filePath, buffer);
      console.log(`[Core] ✅ Fichier téléchargé: ${filePath}`);

      getMediaIndexer()
        .then((indexer) => {
          if (indexer) {
            indexer.indexFile(chatId, filePath).catch((err: unknown) => {
              console.warn('[Core] MediaIndexer error:', err instanceof Error ? err.message : err);
            });
          }
        })
        .catch(() => {});

      setTimeout(
        () => {
          fs.unlink(filePath, (err) => {
            if (err && err.code !== 'ENOENT') {
              console.error(
                '[Cleanup] Erreur lors de la suppression de %s:',
                filePath,
                err.message,
              );
            } else if (!err) {
              console.log(`[Cleanup] 🧹 Fichier temporaire supprimé: ${filePath}`);
            }
          });
        },
        10 * 60 * 1000,
      );

      const timeString = new Date().toLocaleString('fr-FR');
      return `\n\n[SYSTÈME ALERTE FICHIER : \n- Expéditeur : @${senderName}\n- Date : ${timeString}\n- Fichier reçu : "${originalFileName}"\n- Type : ${message.mediaType}\n- Emplacement temporaire : ${filePath}\n\nATTENTION : Ce fichier est stocké dans un répertoire temporaire et SERA SUPPRIMÉ AUTOMATIQUEMENT dans 10 minutes. Si ce fichier est important et que vous devez le conserver, vous DEVEZ utiliser vos outils pour le copier ou le déplacer vers un stockage permanent avant de faire autre chose. Vous pouvez lire son contenu avec read_file si nécessaire.]`;
    } catch (e: unknown) {
      const eMsg = e instanceof Error ? e.message : String(e);
      console.error('[Core] ❌ Erreur téléchargement fichier:', eMsg);
      return null;
    }
  }

  private _buildQuotedMessageNotice(quotedMsg?: {
    sender?: string;
    text?: string;
    hasImage?: boolean;
    hasVideo?: boolean;
  }): string {
    if (!quotedMsg) return '';
    const participant = quotedMsg.sender?.split('@')[0] || 'Inconnu';
    if (quotedMsg.hasImage && !quotedMsg.text) {
      return `\n\n[Contexte - En réponse à une IMAGE envoyée par @${participant}]`;
    }
    if (quotedMsg.hasImage && quotedMsg.text) {
      return `\n\n[Contexte - En réponse à une IMAGE avec légende de @${participant} : "${quotedMsg.text}"]`;
    }
    if (quotedMsg.hasVideo) {
      const suffix = quotedMsg.text ? ` : "${quotedMsg.text}"` : '';
      return `\n\n[Contexte - En réponse à une VIDÉO de @${participant}${suffix}]`;
    }
    if (quotedMsg.text) {
      return `\n\n[Contexte - En réponse à un message de @${participant} : "${quotedMsg.text}"]`;
    }
    return '';
  }

  private _appendNoticeToUserContent(
    userContent: string | Record<string, unknown>[],
    notice: string,
  ): string | Record<string, unknown>[] {
    if (!notice) return userContent;
    if (Array.isArray(userContent)) {
      const textBlock = userContent.find(
        (b: { type?: string; text?: string }) => b.type === 'text',
      );
      if (textBlock && typeof textBlock.text === 'string') textBlock.text += notice;
      return userContent;
    }
    return userContent + notice;
  }

  private async _prepareUserContentAndContext(
    message: MessageData & {
      quotedMsg?: { sender?: string; text?: string; hasImage?: boolean; hasVideo?: boolean };
      raw?: unknown;
    },
    text: string,
    senderName: string,
    chatId: string,
  ): Promise<string | Record<string, unknown>[]> {
    let userContent: string | Record<string, unknown>[] = text;
    const imageBlocks = await this._downloadMediaImages(message);

    if (imageBlocks.length > 0) {
      userContent = [
        { type: 'text', text: text || 'Que vois-tu sur cette image ?' },
        ...imageBlocks,
      ];
    }

    const fileNotice = await this._downloadMediaDocumentNotice(message, senderName, chatId);
    if (fileNotice) {
      userContent = this._appendNoticeToUserContent(userContent, fileNotice);
    }

    return userContent;
  }

  private async _generatePlannerApology(
    activePlan: { goal?: string },
    successCount: number,
    totalSteps: number,
    successRate: number,
    failCount: number,
    stepStatuses: string,
    history: Record<string, unknown>[],
    isUserAdmin: boolean,
  ): Promise<string> {
    console.warn(
      `[Planner] ⚠️ Low success rate (${successRate}%). Generating conversational apology.`,
    );
    try {
      const failurePrompt = `<plan_execution_report>
Objective: ${activePlan.goal}
Result: ${successCount}/${totalSteps} steps completed (${successRate}% success rate) - FAILED.
${failCount > 0 ? `⚠️ ${failCount} steps FAILED.` : ''}
</plan_execution_report>

<instructions>
The task could not be completed successfully.
Generate a polite, professional, and friendly apology message for the user, suitable for a business's customer service on WhatsApp.
RULES:
- Acknowledge that we encountered a technical issue or were unable to complete their request at this time.
- Keep the tone warm, helpful, and professional.
- Do NOT mention code-level details, tool names, or internal execution steps (e.g. "steps", "Planner", "database schemas", etc.) to the user.
- Invite the user to try again in a few moments or contact support.
- STRICTLY DO NOT claim success under any circumstances.
</instructions>`;
      const summaryResponse = await providerRouter.chat(
        [...history, { role: 'user', content: failurePrompt }],
        { category: 'AGENTIC' },
      );
      let resp =
        summaryResponse.content || "Désolé, je n'ai pas pu finaliser votre demande pour le moment.";
      if (isUserAdmin) {
        resp += `\n\n⚙️ *[Détails techniques (Administrateur)]* :\n${stepStatuses}`;
      }
      return resp;
    } catch (summaryErr: unknown) {
      const sMsg = summaryErr instanceof Error ? summaryErr.message : String(summaryErr);
      console.error('[Planner] ❌ Échec génération excuses:', sMsg);
      let resp =
        "Désolé, je n'ai pas pu finaliser votre demande pour le moment en raison d'un problème technique. N'hésitez pas à réessayer dans quelques instants ou à contacter notre support. Merci de votre patience ! 🙏";
      if (isUserAdmin) {
        resp += `\n\n⚙️ *[Détails techniques (Administrateur)]* :\n${stepStatuses}`;
      }
      return resp;
    }
  }

  private async _generatePlannerSummary(
    activePlan: { goal?: string },
    successCount: number,
    totalSteps: number,
    successRate: number,
    failCount: number,
    stepStatuses: string,
    history: Record<string, unknown>[],
    isUserAdmin: boolean,
  ): Promise<string> {
    try {
      const summaryPrompt = `<plan_execution_report>
Objective: ${activePlan.goal}
Result: ${successCount}/${totalSteps} steps completed (${successRate}% success rate)
${failCount > 0 ? `⚠️ ${failCount} steps FAILED.` : ''}

Step-by-step status:
${stepStatuses}
</plan_execution_report>

<instructions>
Generate an HONEST, polite, and professional conversational summary of what happened, suitable for a business's customer service on WhatsApp.
RULES:
- Keep the tone warm, helpful, and professional.
- If steps failed, you MUST mention the failures explicitly, but explain them in simple, user-friendly terms without using programmer jargon.
- NEVER claim a file was created if the step that creates it failed or was skipped.
- NEVER claim success if the success rate is below 80%.
- If the overall result is a failure, say so clearly, apologize politely, and explain what went wrong in a friendly way.
- Do NOT invent outcomes that are not in the report above.
</instructions>`;
      const summaryResponse = await providerRouter.chat(
        [...history, { role: 'user', content: summaryPrompt }],
        { category: 'AGENTIC' },
      );
      return (
        summaryResponse.content ||
        "Désolé, je n'ai pas pu mener à bien l'intégralité de votre demande."
      );
    } catch (summaryErr: unknown) {
      const sMsg = summaryErr instanceof Error ? summaryErr.message : String(summaryErr);
      console.error('[Planner] ❌ Échec génération résumé:', sMsg);
      let resp =
        "Désolé, je n'ai pas pu mener à bien l'intégralité de votre demande. N'hésitez pas à réessayer dans quelques instants.";
      if (isUserAdmin) {
        resp += `\n\n⚙️ *[Détails techniques (Administrateur)]* :\n${stepStatuses}`;
      }
      return resp;
    }
  }

  private async _generatePlannerApologyOrSummary(
    activePlan: { goal?: string },
    successCount: number,
    totalSteps: number,
    successRate: number,
    failCount: number,
    stepStatuses: string,
    history: Record<string, unknown>[],
    isUserAdmin: boolean,
  ): Promise<string> {
    if (successRate < 50) {
      return await this._generatePlannerApology(
        activePlan,
        successCount,
        totalSteps,
        successRate,
        failCount,
        stepStatuses,
        history,
        isUserAdmin,
      );
    }
    return await this._generatePlannerSummary(
      activePlan,
      successCount,
      totalSteps,
      successRate,
      failCount,
      stepStatuses,
      history,
      isUserAdmin,
    );
  }

  private async _runPlannerSubflow(
    userContent: string | Record<string, unknown>[],
    text: string,
    chatId: string,
    message: MessageData,
    relevantTools: ToolDef[],
    fullContext: { authority?: { isSuperUser?: boolean; isGlobalAdmin?: boolean; level?: number } },
    activeBlueprint: string,
    history: Record<string, unknown>[],
  ): Promise<{ planned: boolean; response: string | null }> {
    const { planner } = await import('../services/agentic/Planner.js');
    const needsPlanning = await planner.needsPlanning(
      typeof userContent === 'string' ? userContent : text,
      relevantTools as unknown as ToolInfo[],
    );

    if (!needsPlanning) return { planned: false, response: null };

    console.log("[Planner] 📋 Tâche complexe détectée, création d'un plan...");
    const plan = await planner.plan(typeof userContent === 'string' ? userContent : text, {
      tools: relevantTools as unknown as ToolInfo[],
      chatId,
    });

    if (!plan) return { planned: false, response: null };

    const executionLog = await planner.execute(plan, {
      executeToolFn: async (
        toolCall: { id: string; function: { name: string; arguments: string } },
        msg: unknown,
      ) => {
        return (await this._safeExecuteTool(toolCall, {
          chatId,
          message: msg as MessageData,
          authority: fullContext.authority as
            { isSuperUser?: boolean; isGlobalAdmin?: boolean; level?: number } | undefined,
          blueprint: activeBlueprint,
        })) as unknown as { success: boolean; result?: unknown; error?: boolean; message?: string };
      },
      tools: relevantTools as unknown as ToolInfo[],
      chatId,
      message,
    });
    const analysis = await planner.review(executionLog);

    const activePlan =
      (
        executionLog as {
          plan?: { steps?: Array<{ id: string | number; action: string }>; goal?: string };
        }
      ).plan || plan;
    const completedList = (
      (executionLog as { completed?: Array<string | number> }).completed || []
    ).map(String);
    const failedList = ((executionLog as { failed?: Array<string | number> }).failed || []).map(
      String,
    );
    const execResults =
      (executionLog as { results?: Record<string, { error?: boolean; message?: string }> })
        .results || {};
    const successCount = completedList.length;
    const failCount = failedList.length;
    const stepsList = activePlan.steps || [];
    const totalSteps = stepsList.length || 1;
    const successRate = Math.round((successCount / totalSteps) * 100);

    const stepStatuses = stepsList
      .map((s) => {
        const succeeded = completedList.includes(String(s.id));
        const failed = failedList.includes(String(s.id));
        let status = '⏭️ skipped';
        if (succeeded) status = '✅';
        else if (failed) status = '❌';

        const result = execResults[String(s.id)];
        let resultSummary = 'not executed';
        if (result) {
          resultSummary = result.error ? `❌ ${result.message}` : `✅ ${result.message || 'OK'}`;
        }
        return `  • Step ${s.id} (${s.action}): ${status} — ${resultSummary}`;
      })
      .join('\n');

    const authObj = fullContext.authority;
    const isUserAdmin =
      authObj?.isSuperUser ||
      authObj?.isGlobalAdmin ||
      (authObj?.level && authObj.level >= 2) ||
      false;

    const finalResponse = await this._generatePlannerApologyOrSummary(
      activePlan,
      successCount,
      totalSteps,
      successRate,
      failCount,
      stepStatuses,
      history,
      isUserAdmin,
    );

    await this.actionMemory.completeAction(chatId, {
      success: (analysis as { success?: boolean }).success,
    });
    return { planned: true, response: finalResponse };
  }

  private _checkToolValidation(
    toolName: string,
    toolCallId: string,
    rawArgs: string,
    relevantTools: ToolDef[],
    toolRetryCount: Map<string, number>,
    MAX_TOOL_RETRIES: number,
  ): { invalid: boolean; errorResponse?: string } {
    const validation = validateToolArgs(toolName, rawArgs || '{}', relevantTools);
    if (validation.valid) return { invalid: false };

    const retryKey = `${toolName}:${toolCallId}`;
    const currentRetries = toolRetryCount.get(retryKey) || 0;
    if (currentRetries < MAX_TOOL_RETRIES) {
      toolRetryCount.set(retryKey, currentRetries + 1);
      console.warn(
        `[ToolValidator] ⚠️ Validation failed for "${toolName}": ${validation.formattedError} (retry ${currentRetries + 1}/${MAX_TOOL_RETRIES})`,
      );
      return { invalid: true, errorResponse: validation.formattedError };
    }

    console.error(
      `[ToolValidator] ❌ Max retries (${MAX_TOOL_RETRIES}) exceeded for "${toolName}". Proceeding with invalid args.`,
    );
    return { invalid: false };
  }

  private async _validateAndExecuteSingleTool(
    toolCall: { id: string; function: { name: string; arguments?: string } },
    relevantTools: ToolDef[],
    toolRetryCount: Map<string, number>,
    MAX_TOOL_RETRIES: number,
    chatId: string,
    message: MessageData,
    fullContext: { authority?: unknown },
    activeBlueprint: string,
    history: Record<string, unknown>[],
    toolsUsedThisTurn: Array<{ name: string; args_summary: string; result_summary: string }>,
  ): Promise<{ role: 'tool'; tool_call_id: string; name: string; content: string }> {
    const toolName = toolCall.function.name;
    try {
      const valCheck = this._checkToolValidation(
        toolName,
        toolCall.id,
        toolCall.function.arguments || '{}',
        relevantTools,
        toolRetryCount,
        MAX_TOOL_RETRIES,
      );
      if (valCheck.invalid) {
        return {
          role: 'tool' as const,
          tool_call_id: toolCall.id,
          name: toolName,
          content: valCheck.errorResponse || 'Validation failed',
        };
      }

      const toolResult = (await this._safeExecuteTool(toolCall, {
        chatId,
        message,
        authority: fullContext.authority as
          { isSuperUser?: boolean; isGlobalAdmin?: boolean; level?: number } | undefined,
        blueprint: activeBlueprint,
        history,
      })) as { userOutput?: unknown; llmOutput?: unknown };

      if (toolResult && toolResult.userOutput && message.sourceChannel === 'cli') {
        const userMsg =
          typeof toolResult.userOutput === 'string'
            ? toolResult.userOutput
            : JSON.stringify(toolResult.userOutput);

        await this.transport.sendUniversalResponse(
          chatId,
          { markdown: userMsg },
          {},
          message.sourceChannel,
        );
      }

      let llmContent: string;
      if (toolResult && toolResult.llmOutput !== undefined) {
        llmContent =
          typeof toolResult.llmOutput === 'string'
            ? toolResult.llmOutput
            : JSON.stringify(toolResult.llmOutput);
      } else {
        llmContent = JSON.stringify(toolResult);
      }

      toolsUsedThisTurn.push({
        name: toolName,
        args_summary: (toolCall.function.arguments || '').substring(0, 80),
        result_summary: (typeof llmContent === 'string' ? llmContent : '').substring(0, 100),
      });

      return {
        role: 'tool' as const,
        tool_call_id: toolCall.id,
        name: toolName,
        content: llmContent,
      };
    } catch (unexpectedErr: unknown) {
      const uMsg = unexpectedErr instanceof Error ? unexpectedErr.message : String(unexpectedErr);
      console.error('[Agent] ❌ Erreur fatale boucle ReAct:', uMsg);
      return {
        role: 'tool' as const,
        tool_call_id: toolCall.id,
        name: toolName,
        content: JSON.stringify({
          success: false,
          error: true,
          message: `Fatal Loop Error: ${uMsg}`,
        }),
      };
    }
  }

  /**
   * Traite un message
   */
  async _handleMessage(event: BotEvent): Promise<void> {
    const { workingMemory } = this;
    const message = event.data as MessageData & {
      quotedMsg?: { sender?: string; text?: string; hasImage?: boolean; hasVideo?: boolean };
      raw?: {
        key?: unknown;
        message?: { documentMessage?: { fileName?: string; title?: string } };
      };
      isTranscribed?: boolean;
      useNativeAudio?: boolean;
      audioBuffer?: Buffer;
    };
    const { chatId, sender, senderName, text, isGroup } = message;

    if (chatId === 'status@broadcast' || chatId?.endsWith('@broadcast')) {
      return;
    }

    console.log(
      `[${isGroup ? 'G' : 'P'}] ${senderName || 'Anonymous'}: ${text.substring(0, 50)}...`,
    );

    await this._checkAutonomousEventTriggers(message, senderName || '');

    if (isGroup) {
      workingMemory.trackMessage(chatId, sender).catch(() => {});
    }

    this._performIdentityLinking(message);

    const handled = await this._handleTextCommandOrInterception(
      message,
      text,
      chatId,
      sender,
      isGroup,
    );
    if (handled) return;

    const check = await this._shouldProcessMessage(
      message,
      text,
      chatId,
      sender,
      senderName || '',
      isGroup,
    );
    if (!check.process) return;

    await this._recordUserMessageAndPresence(
      message,
      text,
      chatId,
      sender,
      senderName || '',
      isGroup,
    );

    try {
      if (message.useNativeAudio && (await this._handleNativeAudioFlow(message, chatId))) {
        return;
      }
      await this._executeReActLoopAndResponse(message, check.mentionsBot, check.isContextualReply);
    } catch (e: unknown) {
      const eMsg = e instanceof Error ? e.message : String(e);
      console.error('[Core] ❌ Erreur _handleMessage:', eMsg);
    }
  }

  private _formatDefectRetryInstruction(defects: {
    hasNoThoughts?: boolean;
    hasLeakedToolCalls?: boolean;
    hasRawCodeDominance?: boolean;
    hasJsonToolObject?: boolean;
  }): string {
    if (defects.hasNoThoughts) {
      return 'You did not include the required <thought> block in your response. You must always think step-by-step before answering.';
    }
    if (defects.hasLeakedToolCalls) {
      return "You wrote a tool call name directly in your text response. Tool calls must be invoked strictly through the system's tool-calling mechanism, never written as plain text.";
    }
    if (defects.hasRawCodeDominance) {
      return 'Your response contains raw code without executing it. If you want to execute code, use the `code_execution` tool. If you want to show code to the user, wrap it in standard markdown blocks and explain it.';
    }
    if (defects.hasJsonToolObject) {
      return 'You wrote a raw JSON tool call object in your text response. You must call tools using the structured tool-calling API, not by outputting JSON text.';
    }
    return '';
  }

  private async _handleReActStepDefectsAndRalph(
    contentStr: string,
    history: Record<string, unknown>[],
    userContent: string | Record<string, unknown>[],
    responseDefectRetries: number,
    MAX_DEFECT_RETRIES: number,
    iterations: number,
    MAX_ITERATIONS: number,
  ): Promise<{ shouldContinue: boolean; newDefectRetries: number }> {
    const defects = detectResponseDefects(contentStr);

    if (
      defects.defectCount > 0 &&
      responseDefectRetries < MAX_DEFECT_RETRIES &&
      iterations < MAX_ITERATIONS
    ) {
      console.warn(
        `[Agent] ⚠️ Response defect detected (retry ${responseDefectRetries + 1}/${MAX_DEFECT_RETRIES}): ${defects.details.join(', ')}`,
      );

      history.push({ role: 'assistant', content: contentStr });

      const retryInstruction = this._formatDefectRetryInstruction(defects);

      history.push({
        role: 'user',
        content: `[SYSTEM REJECTION] : ACTION REJECTED by internal format validator.\nReason: ${retryInstruction}\n\nSYSTEM DIRECTIVE: This is an automatic system interception, not a user message. You must restart your action and correct this error. DO NOT APOLOGIZE, do not acknowledge (no "Sorry", no "Thank you"). Just generate the corrected response or tool call.`,
      });
      return { shouldContinue: true, newDefectRetries: responseDefectRetries + 1 };
    }

    if (iterations > 1 && contentStr && iterations < MAX_ITERATIONS) {
      const runtime = container.get('runtime');
      const initialGoal =
        typeof userContent === 'string' ? userContent : JSON.stringify(userContent);

      const ralphEval = await runtime.ralph.verifyCompletion(initialGoal, contentStr);

      if (!ralphEval.is_complete && ralphEval.laziness_detected) {
        console.warn('[Runtime:RALPH] 🥾 Agent paresseux détecté. Injection du kickback prompt.');
        history.push({ role: 'assistant', content: contentStr });
        history.push({
          role: 'user',
          content: `[SYSTEM SUPERVISOR: RALPH] ${ralphEval.kickback_message}`,
        });
        return { shouldContinue: true, newDefectRetries: responseDefectRetries };
      }
    }

    const thoughtOnlyCheck = contentStr
      .replace(/<(think|thought|thinking)>([\s\S]*?)<\/\1>/gi, '')
      .replace(/^([\s\S]*?)<\/(think|thought|thinking)>/gi, '')
      .replace(/<(think|thought|thinking)>([\s\S]*?)$/gi, '')
      .replace(/<\/?(think|thought|thinking)>/gi, '')
      .trim();

    if (!thoughtOnlyCheck && contentStr.length > 0 && iterations < MAX_ITERATIONS) {
      console.log(
        '[CoT] ⚠️ Réponse contenant uniquement des pensées. Relance pour obtenir une réponse utilisateur.',
      );
      history.push({ role: 'assistant', content: contentStr });
      history.push({
        role: 'user',
        content:
          '[SYSTEM REJECTION] : ACTION REJECTED by internal validator.\nReason: You thought inside your <thought> tags, but produced no final response for the user and called no tools.\n\nSYSTEM DIRECTIVE: This is an automatic interception. Immediately generate a direct user response without apologizing or justifying this omission. Do not reply to this system message.',
      });
      return { shouldContinue: true, newDefectRetries: responseDefectRetries };
    }

    return { shouldContinue: false, newDefectRetries: responseDefectRetries };
  }

  private async _optimizeReActHistory(
    history: Record<string, unknown>[],
    chatId: string,
  ): Promise<void> {
    try {
      const compacted = await this._compactHistory(history, chatId);
      if (compacted !== history) {
        history.length = 0;
        history.push(...compacted);
      } else {
        const optimized = this._optimizeHistory(history);
        if (optimized !== history) {
          history.length = 0;
          history.push(...optimized);
        }
      }
    } catch (ctxErr: unknown) {
      console.error('[ContextManager] ❌ Échec optimisation:', ctxErr);
    }
  }

  private async _handleBudgetExceededFallback(
    history: Record<string, unknown>[],
    relevantTools: ToolDef[],
    currentFamily: string | null,
  ): Promise<{
    response: {
      content?: string | null;
      toolCalls?: Array<{ id: string; function: { name: string; arguments?: string } }>;
      usedFamily?: string;
      usedModel?: string;
      reasoningContent?: string;
    } | null;
    budgetExhausted: boolean;
  }> {
    if (!currentFamily) return { response: null, budgetExhausted: true };
    console.warn(`[FinOps] ⚠️ Budget dépassé pour la famille ${currentFamily}. Fallback AGENTIC.`);
    try {
      const response = (await providerRouter.chat(history, {
        tools: relevantTools as unknown as ToolInfo[],
        category: 'AGENTIC',
      })) as {
        content?: string | null;
        toolCalls?: Array<{ id: string; function: { name: string; arguments?: string } }>;
        usedFamily?: string;
        usedModel?: string;
        reasoningContent?: string;
      };
      return { response, budgetExhausted: false };
    } catch (fallbackErr: unknown) {
      const fbMsg = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
      if (fbMsg.includes('BUDGET_EXCEEDED')) {
        return { response: null, budgetExhausted: true };
      }
      throw fallbackErr;
    }
  }

  private async _chatWithProviderRouter(
    history: Record<string, unknown>[],
    relevantTools: ToolDef[],
    usedFamily: string | null,
  ): Promise<{
    response: {
      content?: string | null;
      toolCalls?: Array<{ id: string; function: { name: string; arguments?: string } }>;
      usedFamily?: string;
      usedModel?: string;
      reasoningContent?: string;
    } | null;
    newFamily: string | null;
    budgetExhausted: boolean;
  }> {
    let response: {
      content?: string | null;
      toolCalls?: Array<{ id: string; function: { name: string; arguments?: string } }>;
      usedFamily?: string;
      usedModel?: string;
      reasoningContent?: string;
    } | null = null;
    let currentFamily = usedFamily;

    try {
      response = (await providerRouter.chat(history, {
        tools: relevantTools as unknown as ToolInfo[],
        ...(currentFamily ? { family: currentFamily } : { category: 'AGENTIC' }),
      })) as {
        content?: string | null;
        toolCalls?: Array<{ id: string; function: { name: string; arguments?: string } }>;
        usedFamily?: string;
        usedModel?: string;
        reasoningContent?: string;
      };
    } catch (chatErr: unknown) {
      const chatMsg = chatErr instanceof Error ? chatErr.message : String(chatErr);
      if (!chatMsg.includes('BUDGET_EXCEEDED')) throw chatErr;

      const fbRes = await this._handleBudgetExceededFallback(history, relevantTools, currentFamily);
      if (fbRes.budgetExhausted || !fbRes.response) {
        return { response: null, newFamily: currentFamily, budgetExhausted: true };
      }
      response = fbRes.response;
      currentFamily = null;
    }

    if (!currentFamily && response?.usedFamily) currentFamily = response.usedFamily;

    return { response, newFamily: currentFamily, budgetExhausted: false };
  }

  private _extractTextToolCalls(
    responseContent: string,
  ):
    Array<{ id: string; type: string; function: { name: string; arguments: string } }> | undefined {
    const extractedCalls = extractToolCallsFromText(responseContent, true);
    if (extractedCalls.length === 0) return undefined;

    console.log(`[Core] 🛠️ ${extractedCalls.length} tool calls extraits du texte`);
    return extractedCalls.map((call: { name: string; arguments: unknown }) => ({
      id: randomInt(100000000, 999999999).toString(36),
      type: 'function',
      function: {
        name: call.name,
        arguments: JSON.stringify(
          parseToolArguments(call.arguments as string | null | undefined) || {},
        ),
      },
    }));
  }

  private async _dispatchToolCallsBatch(
    toolCalls: Array<{ id: string; function: { name: string; arguments?: string } }>,
    reasoningContent: string | undefined,
    history: Record<string, unknown>[],
    relevantTools: ToolDef[],
    toolRetryCount: Map<string, number>,
    MAX_TOOL_RETRIES: number,
    chatId: string,
    message: MessageData,
    fullContext: { authority?: unknown },
    activeBlueprint: string,
    toolsUsedThisTurn: Array<{ name: string; args_summary: string; result_summary: string }>,
    iterations: number,
  ): Promise<void> {
    const historyEntry: Record<string, unknown> = {
      role: 'assistant',
      content: null,
      tool_calls: toolCalls,
    };
    if (reasoningContent) historyEntry.reasoning_content = reasoningContent;
    history.push(historyEntry);

    const READ_ONLY_TOOLS = new Set([
      'read_file',
      'list_directory',
      'grep_search',
      'get_file_skeleton',
      'get_function',
      'find_symbol_references',
      'spawn_sub_agent',
    ]);

    const parallelBatch: typeof toolCalls = [];
    const sequentialQueue: typeof toolCalls = [];

    for (const tc of toolCalls) {
      if (READ_ONLY_TOOLS.has(tc.function.name)) {
        parallelBatch.push(tc);
      } else {
        sequentialQueue.push(tc);
      }
    }

    const executeAndRecord = (tc: { id: string; function: { name: string; arguments?: string } }) =>
      this._validateAndExecuteSingleTool(
        tc,
        relevantTools,
        toolRetryCount,
        MAX_TOOL_RETRIES,
        chatId,
        message,
        fullContext,
        activeBlueprint,
        history,
        toolsUsedThisTurn,
      );

    if (parallelBatch.length > 0) {
      console.log(`[Agent] ⚡ Exécution parallèle de ${parallelBatch.length} outil(s) read-only`);
      const parallelResults = await Promise.all(parallelBatch.map(executeAndRecord));
      for (const result of parallelResults) {
        history.push(result);
        console.log(`[Agent] ✅ Résultat ${result.name} traité (parallel)`);
      }
    }

    for (const toolCall of sequentialQueue) {
      const result = await executeAndRecord(toolCall);
      history.push(result);
      console.log(`[Agent] ✅ Résultat ${result.name} traité (sequential, Dual Render: checked)`);

      if (iterations > 1) {
        await this.transport.setPresence(chatId, 'composing', message.sourceChannel);
      }
    }
  }

  private async _processResponseToolsOrDefects(
    response: {
      content?: string | null;
      toolCalls?: Array<{ id: string; function: { name: string; arguments?: string } }>;
      usedFamily?: string;
      usedModel?: string;
      reasoningContent?: string;
    },
    history: Record<string, unknown>[],
    userContent: string | Record<string, unknown>[],
    relevantTools: ToolDef[],
    toolRetryCount: Map<string, number>,
    MAX_TOOL_RETRIES: number,
    chatId: string,
    message: MessageData,
    fullContext: { authority?: unknown; blueprint?: string },
    activeBlueprint: string,
    toolsUsedThisTurn: Array<{ name: string; args_summary: string; result_summary: string }>,
    iterations: number,
    responseDefectRetries: number,
    MAX_DEFECT_RETRIES: number,
    MAX_ITERATIONS: number,
  ): Promise<{
    shouldContinue: boolean;
    newDefectRetries: number;
    finalResponse: string | null;
    keepThinking: boolean;
  }> {
    const toolCalls =
      response.toolCalls ||
      (response.content ? this._extractTextToolCalls(response.content) : undefined);

    if (toolCalls && toolCalls.length > 0) {
      console.log(`[Agent] 🛠️ Étape ${iterations}: L'IA appelle ${toolCalls.length} outil(s)`);
      await this._dispatchToolCallsBatch(
        toolCalls,
        response.reasoningContent,
        history,
        relevantTools,
        toolRetryCount,
        MAX_TOOL_RETRIES,
        chatId,
        message,
        fullContext,
        activeBlueprint,
        toolsUsedThisTurn,
        iterations,
      );
      return {
        shouldContinue: false,
        newDefectRetries: responseDefectRetries,
        finalResponse: null,
        keepThinking: true,
      };
    }

    console.log(`[Agent] 🏁 Fin de réflexion à l'étape ${iterations}.`);
    const defectCheck = await this._handleReActStepDefectsAndRalph(
      response.content || '',
      history,
      userContent,
      responseDefectRetries,
      MAX_DEFECT_RETRIES,
      iterations,
      MAX_ITERATIONS,
    );

    return {
      shouldContinue: defectCheck.shouldContinue,
      newDefectRetries: defectCheck.newDefectRetries,
      finalResponse: defectCheck.shouldContinue ? null : response.content || null,
      keepThinking: defectCheck.shouldContinue,
    };
  }

  private _updateContextWindowStats(
    usedModel: string | undefined,
    chatId: string,
    history: Record<string, unknown>[],
  ): void {
    if (!usedModel) return;
    try {
      const contextWindow = container.get('contextWindow');
      contextWindow.setActiveModel(usedModel);
      const currentUsage = contextWindow.getUsage(chatId, history);
      eventBus.publish(BotEvents.CUSTOM, {
        name: 'context_usage_update',
        message: JSON.stringify(currentUsage),
        timestamp: Date.now(),
      });
    } catch (e: unknown) {
      const eMsg = e instanceof Error ? e.message : String(e);
      console.error('[ContextWindow] Error updating context window stats:', eMsg);
    }
  }

  private async _runReActLoop(
    userContent: string | Record<string, unknown>[],
    text: string,
    chatId: string,
    message: MessageData,
    history: Record<string, unknown>[],
    relevantTools: ToolDef[],
    fullContext: { authority?: unknown; blueprint?: string },
    activeBlueprint: string,
  ): Promise<{
    finalResponse: string | null;
    iterations: number;
    toolsUsedThisTurn: Array<{ name: string; args_summary: string; result_summary: string }>;
  }> {
    const toolsUsedThisTurn: Array<{
      name: string;
      args_summary: string;
      result_summary: string;
    }> = [];

    const toolRetryCount = new Map<string, number>();
    const MAX_TOOL_RETRIES = 2;

    let responseDefectRetries = 0;
    const MAX_DEFECT_RETRIES = 2;

    let finalResponse: string | null = null;
    let keepThinking = true;
    let iterations = 0;
    const MAX_ITERATIONS = 10;
    let usedFamily: string | null = null;

    console.log(`[ReAct] 🚀 Démarrage de la boucle ReAct (max ${MAX_ITERATIONS} itérations)`);

    if (keepThinking) {
      const planRes = await this._runPlannerSubflow(
        userContent,
        text,
        chatId,
        message,
        relevantTools as unknown as ToolDef[],
        fullContext as {
          authority?: { isSuperUser?: boolean; isGlobalAdmin?: boolean; level?: number };
        },
        activeBlueprint,
        history,
      );
      if (planRes.planned) {
        finalResponse = planRes.response;
        keepThinking = false;
      }
    }

    while (keepThinking && iterations < MAX_ITERATIONS) {
      iterations++;

      await this._optimizeReActHistory(history, chatId);

      const chatRes = await this._chatWithProviderRouter(history, relevantTools, usedFamily);
      usedFamily = chatRes.newFamily;

      if (chatRes.budgetExhausted || !chatRes.response) {
        console.error('[FinOps] 🚨 Budget global épuisé, arrêt de la boucle ReAct.');
        finalResponse = "⚠️ Le budget global de cette session est épuisé. Je m'arrête ici.";
        break;
      }

      const response = chatRes.response;

      this._updateContextWindowStats(response.usedModel, chatId, history);

      const stepRes = await this._processResponseToolsOrDefects(
        response,
        history,
        userContent,
        relevantTools,
        toolRetryCount,
        MAX_TOOL_RETRIES,
        chatId,
        message,
        fullContext,
        activeBlueprint,
        toolsUsedThisTurn,
        iterations,
        responseDefectRetries,
        MAX_DEFECT_RETRIES,
        MAX_ITERATIONS,
      );

      if (stepRes.shouldContinue) {
        responseDefectRetries = stepRes.newDefectRetries;
        continue;
      }

      if (!stepRes.keepThinking) {
        finalResponse = stepRes.finalResponse;
        keepThinking = false;
      }
    }

    if (!finalResponse && iterations >= MAX_ITERATIONS) {
      finalResponse =
        "J'ai trop réfléchi et je me suis perdu en chemin... (Boucle infinie détectée)";
      console.warn('[Agent] ⚠️ MAX_ITERATIONS reached');
    }

    if (!finalResponse && iterations > 0) {
      finalResponse = '__HIVE_SILENT_7f3a__';
      console.log(
        "[Agent] 🏁 Réponse vide après exécution d'outils, conversion en action silencieuse.",
      );
    }

    return { finalResponse, iterations, toolsUsedThisTurn };
  }

  private _extractThoughtsAndStripTags(text: string): { cleaned: string; thoughts: string[] } {
    let resp = text;
    const thoughts: string[] = [];

    const extractAndReplace = (regex: RegExp) => {
      resp = resp.replace(regex, (_, p1: string, p2?: string) => {
        const body = p2 || p1;
        if (body) thoughts.push(body.trim());
        return '';
      });
    };

    extractAndReplace(/<(think|thought|thinking)>([\s\S]*?)<\/\1>/gi);
    extractAndReplace(/^([\s\S]*?)<\/(think|thought|thinking)>/gi);
    extractAndReplace(/<(think|thought|thinking)>([\s\S]*?)$/gi);

    resp = resp.replace(/<\/?(think|thought|thinking)>/gi, '').trim();
    return { cleaned: resp, thoughts };
  }

  private _logAgentThoughts(thoughts: string[]): void {
    if (thoughts.length === 0) return;
    console.log(`[CoT] 🧠 Pensée de l'agent (${thoughts.length} bloc(s)) :`);
    for (const [i, t] of thoughts.entries()) {
      console.log(`  [${i + 1}] ${t.substring(0, 200)}${t.length > 200 ? '...' : ''}`);
    }
  }

  private _unwrapSendMessageFormat(text: string): string {
    const smMatch = text.match(/<send_message>([\s\S]*?)<\/send_message>/);
    if (!smMatch) return text;
    try {
      const jsonContent = JSON.parse(smMatch[1]);
      return jsonContent.text || text;
    } catch {
      return text.replace(/<\/?send_message>/g, '');
    }
  }

  private _cleanThoughtsAndSanitize(
    finalResponse: string,
    iterations: number,
  ): { cleaned: string | null; thoughtsCount: number } {
    const { cleaned: rawResp, thoughts } = this._extractThoughtsAndStripTags(finalResponse);
    let resp = rawResp;

    this._logAgentThoughts(thoughts);

    if (!resp) {
      return {
        cleaned: iterations > 0 ? '*(Réflexion terminée sans réponse textuelle)*' : null,
        thoughtsCount: thoughts.length,
      };
    }

    const sanitized = sanitizeResponse(resp);
    if (sanitized.wasModified) {
      console.warn(
        `[Sanitizer] 🛡️ Stripped ${sanitized.strippedItems.length} leaked item(s): ${sanitized.strippedItems.join(', ')}`,
      );
      resp = sanitized.cleaned;
    }

    resp = this._unwrapSendMessageFormat(resp);

    return { cleaned: resp, thoughtsCount: thoughts.length };
  }

  private async _buildHistoryAndToolsForReAct(
    message: MessageData,
    text: string,
    senderName: string,
    chatId: string,
    isGroup: boolean,
    mentionsBot: boolean,
    isContextualReply: boolean,
  ): Promise<{
    userContent: string | Record<string, unknown>[];
    replyOptions: Record<string, unknown>;
    fullContext: {
      authority?: unknown;
      blueprint?: string;
      systemPrompt?: string;
      history?: Record<string, unknown>[];
    };
    activeBlueprint: string;
    history: Record<string, unknown>[];
    relevantTools: ToolDef[];
  }> {
    const { workingMemory } = this;
    const userContent = await this._prepareUserContentAndContext(
      message as unknown as MessageData & {
        quotedMsg?: { sender?: string; text?: string; hasImage?: boolean; hasVideo?: boolean };
        raw?: unknown;
      },
      text,
      senderName || '',
      chatId,
    );

    const replyOptions: Record<string, unknown> = {};
    if (isGroup) {
      const strategy = await workingMemory.getReplyStrategy(
        chatId,
        message as unknown as Parameters<typeof workingMemory.getReplyStrategy>[1],
      );
      const isBotDirectlyAddressed = mentionsBot || isContextualReply;

      if (strategy.useQuote || isBotDirectlyAddressed) {
        if (message.raw) replyOptions.reply = message.raw;
      }
    }

    const fullContextRes = await tieredContextLoader.load(
      chatId,
      message as unknown as {
        sender: string;
        sourceChannel?: string;
        systemContext?: string;
        [key: string]: unknown;
      },
    );
    const rawBP = fullContextRes.blueprint || this.currentBlueprint;
    const activeBlueprint = typeof rawBP === 'string' ? rawBP : JSON.stringify(rawBP);
    const systemPrompt = fullContextRes.systemPrompt || '';
    const fullContext = {
      authority: fullContextRes.authority,
      blueprint: activeBlueprint,
      systemPrompt,
      history: fullContextRes.history,
    };

    const history: Record<string, unknown>[] = [];
    history.push({ role: 'system', content: systemPrompt });
    if (fullContext.history) history.push(...fullContext.history);
    history.push({ role: 'user', content: userContent });

    let relevantTools = await pluginLoader.getRelevantTools(text, 5, 10);

    if (this.runtime?.sentinel) {
      const bpForSentinel = (typeof rawBP === 'object' && rawBP !== null ? rawBP : undefined) as
        AgentBlueprint | undefined;
      relevantTools = this.runtime.sentinel.projectActionSpace(
        relevantTools as unknown as Parameters<typeof this.runtime.sentinel.projectActionSpace>[0],
        bpForSentinel,
      ) as unknown as Awaited<ReturnType<typeof pluginLoader.getRelevantTools>>;
    }

    const ptcEnabled = process.env.PTC_ENABLED !== 'false';
    if (ptcEnabled) {
      const codeExecToolDef = ptcExecutor.buildCodeExecutionToolDef(relevantTools);
      relevantTools.push(codeExecToolDef);
    }

    return {
      userContent,
      replyOptions,
      fullContext,
      activeBlueprint,
      history,
      relevantTools: relevantTools as unknown as ToolDef[],
    };
  }

  private async _tryTextCommandFallback(
    finalResponse: string,
    message: MessageData,
    chatId: string,
    sender: string,
  ): Promise<string> {
    const parsedCommand = pluginLoader.findTextHandler(finalResponse, {
      ...message,
      botJid: this.transport.sock?.user?.id,
    });
    if (!parsedCommand) return finalResponse;

    console.log(`[Core] Commande textuelle détectée dans réponse IA: ${parsedCommand.name}`);
    try {
      const toolResult = (await pluginLoader.execute(parsedCommand.name, parsedCommand.args, {
        transport: this.transport,
        message,
        chatId,
        sender,
      })) as { success?: boolean; message?: string };
      if (toolResult.success && toolResult.message) {
        return toolResult.message;
      }
    } catch (cmdErr: unknown) {
      const cMsg = cmdErr instanceof Error ? cmdErr.message : String(cmdErr);
      console.error('[Core] ⚠️ Text Command Fallback Error:', cMsg);
    }
    return finalResponse;
  }

  private async _handleVoiceResponseOrFallback(
    finalResponse: string,
    message: MessageData & { isTranscribed?: boolean },
    chatId: string,
    text: string,
  ): Promise<boolean> {
    const { workingMemory } = this;
    if (!message.isTranscribed && !text.toLowerCase().includes('réponds par vocal')) {
      return false;
    }

    try {
      const voiceProvider = container.get('voiceProvider');
      if (voiceProvider) {
        console.log('[Core] 🗣️ Génération réponse vocale...');
        const ttsResult = await voiceProvider.textToSpeech(finalResponse);

        if (ttsResult && ttsResult.filePath) {
          await this.transport.setPresence(chatId, 'recording', message.sourceChannel);
          await this.transport.sendVoiceNote(chatId, ttsResult.filePath, {
            duration: Math.min(finalResponse.length * 40, 3000),
          });
          console.log(`[Core] ✓ Réponse vocale envoyée (${ttsResult.provider})`);
          await this.transport.setPresence(chatId, 'available', message.sourceChannel);

          await workingMemory.addMessage(chatId, 'assistant', finalResponse);
          if (isStorable(finalResponse, 'assistant')) {
            const memory = container.get('memory');
            memory.store(chatId, finalResponse, 'assistant').catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              console.error(
                '[Core] memory.store (assistant/voice) failed for chatId=%s:',
                chatId,
                msg,
              );
            });
          }
          return true;
        }
      }
    } catch (voiceError: unknown) {
      const vMsg = voiceError instanceof Error ? voiceError.message : String(voiceError);
      console.error('[Core] ❌ Echec réponse vocale, fallback texte:', vMsg);
    }
    return false;
  }

  private async _executeReActLoopAndResponse(
    message: MessageData & {
      quotedMsg?: { sender?: string; text?: string; hasImage?: boolean; hasVideo?: boolean };
      raw?: {
        key?: unknown;
        message?: { documentMessage?: { fileName?: string; title?: string } };
      };
      isTranscribed?: boolean;
      useNativeAudio?: unknown;
    },
    mentionsBot: boolean,
    isContextualReply: boolean,
  ): Promise<void> {
    const { chatId, sender, senderName, text, isGroup } = message;

    try {
      const prep = await this._buildHistoryAndToolsForReAct(
        message,
        text,
        senderName ?? '',
        chatId,
        isGroup,
        mentionsBot,
        isContextualReply,
      );

      const loopResult = await this._runReActLoop(
        prep.userContent,
        text,
        chatId,
        message,
        prep.history,
        prep.relevantTools,
        prep.fullContext,
        prep.activeBlueprint,
      );

      let finalResponse = loopResult.finalResponse;
      if (finalResponse) {
        finalResponse = await this._tryTextCommandFallback(finalResponse, message, chatId, sender);
      }

      await this._naturalDelay();

      if (finalResponse) {
        const sentVoice = await this._handleVoiceResponseOrFallback(
          finalResponse,
          message,
          chatId,
          text,
        );
        if (sentVoice) return;
      }

      if (!finalResponse || typeof finalResponse !== 'string' || finalResponse.trim() === '') {
        console.warn('[Core] ⚠️ Réponse vide ou invalide (non-string), annulation envoi');
        return;
      }

      const cleanRes = this._cleanThoughtsAndSanitize(finalResponse, loopResult.iterations);
      if (!cleanRes.cleaned) return;

      await this._sendFinalResponseAndRecord(
        cleanRes.cleaned,
        message,
        chatId,
        sender,
        isGroup,
        prep.replyOptions,
        loopResult.toolsUsedThisTurn,
      );
    } catch (error: unknown) {
      console.error('[Core] Erreur traitement:', error);
      const errObj = error as { message?: string };
      const errMsg = errObj.message?.includes('BUDGET_EXCEEDED')
        ? '⚠️ **Budget de session épuisé.** Pour protéger ton portefeuille, je me mets en pause. Relance-moi pour une nouvelle session.'
        : "Oups, j'ai bugué 😅 Réessaie !";

      await this.transport.sendUniversalResponse(
        chatId,
        { markdown: errMsg },
        {},
        message.sourceChannel,
      );
      await this.transport.setPresence(chatId, 'paused', message.sourceChannel);
    }
  }

  private async _sendFinalResponseAndRecord(
    finalResponse: string,
    message: MessageData,
    chatId: string,
    sender: string,
    isGroup: boolean,
    replyOptions: Record<string, unknown>,
    toolsUsedThisTurn: Array<{ name: string; args_summary: string; result_summary: string }>,
  ): Promise<void> {
    const { workingMemory } = this;
    const SILENT_TOKEN = '__HIVE_SILENT_7f3a__';
    const trimmed = finalResponse.trim();
    if (trimmed === SILENT_TOKEN || trimmed.includes(SILENT_TOKEN)) {
      console.log("[Core] 🤫 SILENT token intercepté — aucun message envoyé à l'utilisateur.");
      await workingMemory.addMessage(chatId, 'assistant', '[ACTION_SILENCIEUSE]');
      return;
    }

    const { splitMessage } = await import('../utils/messageSplitter.js');
    const messageParts = splitMessage(finalResponse, 1500);

    for (const [i, part] of messageParts.entries()) {
      await this.transport.sendUniversalResponse(
        chatId,
        { markdown: part },
        i === 0 ? replyOptions : {},
        message.sourceChannel,
      );

      if (i < messageParts.length - 1) {
        await this._naturalDelay(400);
      }
    }

    if (messageParts.length > 1) {
      console.log(`[Core] 📨 Message découpé en ${messageParts.length} parties`);
    }

    await this.transport.setPresence(chatId, 'paused', message.sourceChannel);

    if (isGroup) {
      await workingMemory.setLastInteraction(chatId, sender);
    }

    await workingMemory.addMessage(chatId, 'assistant', finalResponse);

    await workingMemory.addActionTrace(chatId, {
      turn: 1,
      user_query: (typeof message.text === 'string' ? message.text : '(multimodal)').substring(
        0,
        100,
      ),
      tools_used: toolsUsedThisTurn,
      response_preview: finalResponse.substring(0, 100),
    });

    if (isStorable(finalResponse, 'assistant')) {
      const memory = container.get('memory');
      memory.store(chatId, finalResponse, 'assistant').catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Core] memory.store (assistant) failed for chatId=%s:', chatId, msg);
      });
    }

    this._extractFacts(message.text, sender).catch((err: unknown) => {
      const eMsg = err instanceof Error ? err.message : String(err);
      console.error('[Core] Erreur extraction faits:', eMsg);
    });
  }

  /**
   * Évalue les règles Sentinel
   */
  private async _evaluateSentinelRules(
    toolCall: ToolCallDef,
    context: { chatId?: string; message?: MessageData; blueprint?: string },
    authorityLevel: string,
    chatId: string | undefined,
  ): Promise<{ success: boolean; error: boolean; message: string } | null> {
    const runtime = container.get('runtime');
    if (!runtime) return null;

    const recentActions = chatId ? await this.agentMemory.getRecentActions(chatId, 5) : [];
    const activeBlueprint = context.blueprint || this.currentBlueprint;
    const bpForSentinelEval = (
      typeof activeBlueprint === 'object' && activeBlueprint !== null ? activeBlueprint : undefined
    ) as AgentBlueprint | undefined;

    const evalResult = await runtime.sentinel.evaluate(
      toolCall,
      {
        senderName: context.message?.senderName || 'Anonymous',
        authorityLevel,
        isGroup: context.message?.isGroup || false,
        chatId: chatId || 'unknown',
      },
      recentActions.map((a) => ({ ...a, error_message: a.error_message ?? undefined })),
      bpForSentinelEval,
    );

    if (!evalResult.allowed) {
      console.warn(
        `[Runtime:VIGIL] 🛑 Action blocked by Sentinel: ${evalResult.reason} (risk: ${evalResult.risk_level})`,
      );
      return {
        success: false,
        error: true,
        message:
          'TOOL_BLOCKED_BY_RUNTIME_SENTINEL:\n' +
          `Tool: ${toolCall.function.name}\n` +
          `Risk Level: ${evalResult.risk_level}\n` +
          `Reason: ${evalResult.reason}\n` +
          `Action Required: ${evalResult.intervention_prompt || 'Inform the user of this limitation, or try an alternative approach.'}`,
      };
    }
    return null;
  }

  /**
   * Exécute un outil de manière sécurisée (Sentinel)
   * Utiliser cette méthode au lieu de _executeTool direct pour le Planner
   */
  async _safeExecuteTool(
    toolCall: ToolCallDef,
    context: {
      chatId?: string;
      message?: MessageData;
      authority?: { isSuperUser?: boolean; isGlobalAdmin?: boolean; level?: number };
      blueprint?: string;
      isSuperUser?: boolean;
      isGlobalAdmin?: boolean;
      level?: number;
      history?: Record<string, unknown>[];
    },
  ): Promise<unknown> {
    const { db } = this;
    const toolName = toolCall.function.name;
    const { chatId, message, authority } = context;

    const isSuperUser = authority?.isSuperUser || context.isSuperUser || false;
    const isGlobalAdmin = authority?.isGlobalAdmin || context.isGlobalAdmin || false;
    const level = authority?.level || context.level || 0;
    let authorityLevel = `USER (Lvl ${level})`;
    if (isSuperUser) {
      authorityLevel = 'SUPERUSER';
    } else if (isGlobalAdmin) {
      authorityLevel = 'GLOBAL_ADMIN';
    }

    console.log(
      `[SafeExecute] 🛡️ Exécution sécurisée demandée: ${toolName} (Level: ${authorityLevel})`,
    );
    console.log(`[SafeExecute] 📦 Arguments: ${toolCall.function.arguments}`);

    if (chatId) {
      await this.actionMemory.pulseAction(chatId);
    }

    let parsedParams: Record<string, unknown> = {};
    try {
      const blockedResult = await this._evaluateSentinelRules(
        toolCall,
        context,
        authorityLevel,
        chatId,
      );
      if (blockedResult) return blockedResult;

      if (toolName === 'code_execution') {
        console.log('[PTC] ⚡ Exécution programmatique via Planner path (_safeExecuteTool)');
        const relevantToolDefs = pluginLoader.getToolDefinitions();
        return await this._executePtcCode(
          toolCall,
          message ?? ({} as MessageData),
          chatId || '',
          relevantToolDefs as unknown as ToolDef[],
          {
            transport: this.transport,
            message,
            chatId,
            sender: message?.sender,
            isGroup: message?.isGroup,
            authorityLevel: authorityLevel || 'MEMBRE (Standard)',
            isSuperUser,
            isGlobalAdmin,
            sourceChannel: message?.sourceChannel,
          },
        );
      }

      const toolResult = await this._executeTool(
        toolCall as unknown as ToolDef,
        (message || {}) as MessageData,
      );

      try {
        parsedParams = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        // Malformed JSON
      }

      const actionLog = (await db.logAction(
        chatId || '',
        toolName,
        parsedParams,
        toolResult,
        true,
      )) as unknown as { id?: string } | null;

      if (actionLog?.id) {
        const { actionEvaluator } = await import('../services/agentic/ActionEvaluator.js');
        actionEvaluator
          .evaluate({
            id: actionLog.id,
            tool: toolName,
            params: parsedParams,
            result: toolResult,
            error: null,
            duration_ms: 0,
            chatId: chatId || '',
            timestamp: Date.now().toString(),
          })
          .catch((e: unknown) => {
            const eMsg = e instanceof Error ? e.message : String(e);
            console.error('[Eval] Error:', eMsg);
          });
      }

      return toolResult;
    } catch (execErr: unknown) {
      const eMsg = execErr instanceof Error ? execErr.message : String(execErr);
      console.error('[SafeExecute] ❌ Erreur exécution outil %s:', toolName, execErr);

      db.logAction(chatId || '', toolName, parsedParams, {}, false, eMsg);

      return {
        success: false,
        error: true,
        message: `Tool Execution Failed: ${eMsg}. Please analyze the error, self-correct your parameters or strategy, and try again.`,
      };
    }
  }

  async _handlePtcSingleToolFallback(
    code: string,
    toolCall: { id?: string; function?: { name: string; arguments?: string } },
    message: MessageData,
    chatId: string,
    relevantTools: ToolDef[],
    contextParams: Record<string, unknown>,
  ) {
    console.log('[PTC] ⏭️ Fallback tool calling natif (1 seul outil détecté)');
    const openParen = code.indexOf('(');
    const closeParen = code.lastIndexOf(')');
    if (openParen === -1 || closeParen === -1 || closeParen <= openParen) {
      return null;
    }

    const extractedTool = code
      .slice(0, openParen)
      .replace(/^await\s+/, '')
      .trim();
    const extractedArgs = code.slice(openParen + 1, closeParen).trim();
    if (!/^\w+$/.test(extractedTool)) {
      return null;
    }

    const validation = validateToolArgs(extractedTool, extractedArgs, relevantTools);
    if (!validation.valid) {
      console.warn(
        `[PTC→Native] ⚠️ Validation failed for "${extractedTool}": ${validation.formattedError}`,
      );
      return {
        success: false,
        error: 'TOOL_VALIDATION_ERROR',
        message: `[SYSTEM REJECTION] : ${validation.formattedError}\nDIRECTIVE: This is a system correction. You MUST retry this tool call immediately with correct parameters. DO NOT apologize, do not acknowledge this message. Just output the corrected tool call. Expected schema: ${JSON.stringify(validation.schema, null, 0)}`,
        missing_params: validation.missing,
      };
    }

    try {
      const fallbackToolCall = {
        id: toolCall.id || `ptc_fallback_${Date.now()}`,
        function: {
          name: extractedTool,
          arguments: extractedArgs,
        },
      };
      console.log(`[PTC→Native] 🛡️ Routing ${extractedTool} through _safeExecuteTool`);
      return await this._safeExecuteTool(fallbackToolCall, {
        chatId,
        message,
        authority: {
          isSuperUser: contextParams.isSuperUser as boolean | undefined,
          isGlobalAdmin: contextParams.isGlobalAdmin as boolean | undefined,
          level: contextParams.authorityLevel as number | undefined,
        },
      });
    } catch {
      return {
        success: false,
        error: `PTC fallback: impossible d'extraire les arguments pour ${extractedTool}`,
      };
    }
  }

  /**
   * Executes the 'code_execution' meta-tool via the PTC sandbox.
   * Centralized defensive execution path used by both ReAct and Planner.
   */
  async _executePtcCode(
    toolCall: { function: { name: string; arguments?: string } },
    message: MessageData,
    chatId: string,
    relevantTools: ToolDef[],
    contextParams: Record<string, unknown>,
  ): Promise<unknown> {
    let codeArgs: { code?: string };
    try {
      codeArgs = JSON.parse(toolCall.function.arguments || '{}');
    } catch (parseErr: unknown) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      return {
        success: false,
        error: 'MALFORMED_JSON_ARGUMENTS',
        message:
          `[SYSTEM REJECTION] : Your tool call arguments are malformed JSON: "${msg}". ` +
          'DIRECTIVE: This is a system correction. Please retry with valid JSON containing a "code" string parameter. ' +
          'DO NOT apologize, do not acknowledge this error. Just output the corrected tool call.',
      };
    }

    if (!codeArgs.code || typeof codeArgs.code !== 'string') {
      return {
        success: false,
        error: true,
        message: 'code_execution requires a string "code" argument.',
      };
    }

    const toolFns = buildToolFunctions(
      relevantTools as unknown as readonly import('../services/ptc/types.js').OpenAIToolDefinition[],
      (name: string, args: Record<string, unknown>, ctx: unknown) =>
        pluginLoader.execute(
          name,
          args,
          ctx as unknown as Parameters<typeof pluginLoader.execute>[2],
        ),
      {
        ...contextParams,
        onProgress: (status: string) => {
          eventBus.publish(BotEvents.TOOL_PROGRESS, { tool: 'code_execution', status, chatId });
        },
      } as unknown as Parameters<typeof buildToolFunctions>[2],
    );

    try {
      const hiveBridge = hiveWakeSystem.buildHiveBridge(chatId);

      hiveWakeSystem.registerWakeCallback(chatId, async (wakeEvent) => {
        console.log(`[WakeSystem] ⏰ Réveil contextuel pour chatId=${chatId}`);
        await this._onMessage({
          chatId: wakeEvent.chatId,
          sender: 'system@wake',
          senderName: 'WAKE_SYSTEM',
          text: `[WAKE_EVENT] ${wakeEvent.prompt}`,
          isGroup: wakeEvent.chatId?.endsWith('@g.us') ?? false,
          isSystem: true,
          sourceChannel: 'internal',
        } as MessageData);
      });

      const ptcResult = await ptcExecutor.execute(codeArgs.code, toolFns, hiveBridge);

      if (ptcResult.metadata?.sleepScheduled) {
        const sleep = ptcResult.metadata.sleepScheduled;
        console.log(
          `[PTC] 💤 SLEEP_SCHEDULED — id=${sleep.wakeEventId}, réveil dans ${Math.round((sleep.wakeAtMs - Date.now()) / 1000)}s`,
        );
        return {
          success: true,
          type: 'SLEEP_SCHEDULED',
          message: sleep.message,
          wakeEventId: sleep.wakeEventId,
          wakeAtMs: sleep.wakeAtMs,
        };
      }

      console.log(
        `[PTC] 📊 ${ptcResult.metadata?.toolCallCount || 0} tools exécutés, ~${ptcResult.metadata?.totalTokensSaved || 0} tokens économisés`,
      );
      return ptcResult;
    } catch (ptcErr: unknown) {
      if (ptcErr instanceof Error && ptcErr.message?.startsWith('PTC_SINGLE_TOOL')) {
        const fallbackResult = await this._handlePtcSingleToolFallback(
          codeArgs.code,
          toolCall,
          message,
          chatId,
          relevantTools,
          contextParams,
        );
        if (fallbackResult) return fallbackResult;
        return { success: false, error: ptcErr.message };
      }
      console.error('[PTC] ❌ Erreur sandbox:', ptcErr);
      return {
        success: false,
        error: true,
        message: ptcErr instanceof Error ? ptcErr.message : 'PTC execution failed',
      };
    }
  }

  _processToolCallForCache(
    call: Record<string, unknown>,
    toolCallArgsMap: Map<string, string>,
  ): void {
    const fn = call.function as { name?: string; arguments?: unknown } | undefined;
    if (!fn || (fn.name !== 'read_file' && fn.name !== 'edit_file')) {
      return;
    }
    try {
      const args = typeof fn.arguments === 'string' ? JSON.parse(fn.arguments) : fn.arguments;
      const filePath =
        (args as Record<string, unknown>)?.file_path ||
        ((args as Record<string, unknown>)?.files as Array<{ path?: string }>)?.[0]?.path;
      if (filePath && typeof filePath === 'string' && call.id) {
        toolCallArgsMap.set(call.id as string, filePath);
      }
    } catch {
      // Ignore JSON parse errors
    }
  }

  _recordToolFileState(msg: Record<string, unknown>, toolCallArgsMap: Map<string, string>): void {
    if (msg.role !== 'tool' || msg.name !== 'read_file' || typeof msg.tool_call_id !== 'string') {
      return;
    }
    const filePath = toolCallArgsMap.get(msg.tool_call_id);
    if (!filePath) return;
    const rawContent = (msg.content as string) || '';
    const contentWithoutHashes = stripHashes(rawContent);
    fileStateCache.recordFile(filePath, contentWithoutHashes);
  }

  _populateFileStateCache(messages: Record<string, unknown>[]): void {
    const toolCallArgsMap = new Map<string, string>();
    for (const msg of messages) {
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls as Array<Record<string, unknown>>) {
          this._processToolCallForCache(tc, toolCallArgsMap);
        }
      }
      this._recordToolFileState(msg, toolCallArgsMap);
    }
  }

  /**
   * Compresse l'historique via un LLM rapide quand la fenêtre de contexte sature.
   */
  async _compactHistory(
    history: Record<string, unknown>[],
    chatId: string,
  ): Promise<Record<string, unknown>[]> {
    let isThresholdReached = false;
    let usagePercent = 0;
    let consumedTokens = 0;
    let tokenLimitVal = 128000;

    try {
      const contextWindow = container.get('contextWindow');
      const usage = contextWindow.getUsage(chatId, history);
      isThresholdReached = usage.percentage >= 0.8;
      usagePercent = Math.round(usage.percentage * 100);
      consumedTokens = usage.consumed;
      tokenLimitVal = usage.limit;
    } catch {
      const TOTAL_CHAR_LIMIT = 25000;
      const currentSize = JSON.stringify(history).length;
      isThresholdReached = currentSize >= TOTAL_CHAR_LIMIT;
      usagePercent = Math.round((currentSize / TOTAL_CHAR_LIMIT) * 100);
    }

    if (!isThresholdReached) return history;

    console.log(
      `[ContextManager] ⚠️ Saturation (${usagePercent}%, ${consumedTokens}/${tokenLimitVal} tokens). Déclenchement du Garbage Collector IA...`,
    );

    const systemPrompt = history[0];
    const lastInteraction = history.slice(-2);

    const messagesToCompress = history.slice(1, -2);
    if (messagesToCompress.length === 0) return history;

    this._populateFileStateCache(messagesToCompress);

    const textToCompress = JSON.stringify(messagesToCompress);

    const summaryPrompt = [
      {
        role: 'user',
        content: `You are the memory manager of HIVE-MIND.
Here is the history of a long working session of an AI agent.
Make a VERY DENSE and TECHNICAL summary of what happened.
Focus ONLY on:
1. The user's initial objective.
2. The modified or read files, and executed commands.
3. Les erreurs rencontrées et les solutions trouvées.
4. L'état actuel exact (ce qu'il reste à faire).

Historique à compresser :
${textToCompress}`,
      },
    ];

    try {
      const response = await providerRouter.chat(summaryPrompt, {
        family: 'groq',
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1,
      });

      const summary = response.content;
      console.log(`[ContextManager] ✅ Historique compressé (${consumedTokens} tokens → résumé)`);

      const enrichedSystemPrompt = {
        ...systemPrompt,
        content: `${systemPrompt.content}\n\n<session_memory_summary>\nRésumé condensé de la session en cours (contexte compressé automatiquement) :\n${summary}\n</session_memory_summary>`,
      };

      return [enrichedSystemPrompt, ...lastInteraction];
    } catch (e: unknown) {
      console.error(
        '[ContextManager] ❌ Échec compression IA, fallback troncature:',
        e instanceof Error ? e.message : String(e),
      );
      return this._optimizeHistory(history);
    }
  }

  /**
   * Gère intelligemment la fenêtre de contexte pour éviter l'explosion (Amnésie Progressive)
   */
  _optimizeHistory(history: Record<string, unknown>[]) {
    const TOTAL_CHAR_LIMIT = 25000;
    const TOOL_OUTPUT_LIMIT = 2000;

    let currentSize = JSON.stringify(history).length;

    if (currentSize < TOTAL_CHAR_LIMIT) {
      return history;
    }

    console.log(
      `[ContextManager] ⚠️ Surcharge contexte détectée (${currentSize} chars). Troncature mécanique...`,
    );

    const optimizedHistory = [...history];
    const safeZoneStart = 2;
    const safeZoneEnd = optimizedHistory.length - 3;
    let trimmedCount = 0;

    for (let i = safeZoneStart; i < safeZoneEnd; i++) {
      const msg = Reflect.get(optimizedHistory, i) as
        { role?: string; content?: string } | undefined;

      if (msg && msg.role === 'tool' && msg.content && msg.content.length > TOOL_OUTPUT_LIMIT) {
        const originalLen = msg.content.length;
        msg.content =
          msg.content.substring(0, TOOL_OUTPUT_LIMIT) +
          `\n... [TRONQUÉ: ${originalLen - TOOL_OUTPUT_LIMIT} chars masqués]`;
        trimmedCount++;

        currentSize = JSON.stringify(optimizedHistory).length;

        if (currentSize < TOTAL_CHAR_LIMIT) break;
      }
    }

    console.log(
      `[ContextManager] ✅ Troncature terminée. ${trimmedCount} outils tronqués. Taille: ${currentSize} chars.`,
    );
    return optimizedHistory;
  }

  /**
   * [PHASE 3] Résilience: Vérifie s'il y a des actions interrompues (Crash Recovery)
   * Si oui, propose de les reprendre
   */
  async _resumePendingActions() {
    const { actionMemory } = this;
    console.log('[Core] ♻️ Vérification des tâches interrompues...');
    try {
      const pendingActions = await actionMemory.getResumableActions(5);

      if (pendingActions.length > 0) {
        console.log(
          `[Core] ⚠️ ${pendingActions.length} action(s) interrompue(s) trouvée(s). Tentative de reprise...`,
        );

        for (const action of pendingActions) {
          const age = Date.now() - action.createdAt;
          if (age > 24 * 3600 * 1000) {
            console.log(`[Core] Action ${action.id} trop vieille, ignorée.`);
            continue;
          }

          const msg = `♻️ *Reprise d'activité*\nJ'ai détecté une tâche interrompue : "${action.params.goal}".\nJe reprends là où je m'étais arrêté (Étape ${action.steps.length}).\n_(Dites 'stop' pour annuler)_`;
          await this.transport.sendText(action.chatId, msg);

          await actionMemory.rehydrateAction(action.chatId, action.id);

          this._handleMessage({
            type: 'message',
            chatId: action.chatId,
            priority: 1,
            data: {
              chatId: action.chatId,
              sender: 'system_recovery',
              senderName: 'SYSTEM',
              isGroup: action.chatId.endsWith('@g.us'),
              text: `[SYSTEM_RESUME] Tâche interrompue restaurée. Objectif initial: "${action.params?.goal || (action as unknown as { goal?: string }).goal || ''}". Reprends l'exécution de ce plan là où il s'est arrêté. Ne demande pas de permission, exécute la prochaine étape.`,
              sourceChannel: 'system',
            },
          } as unknown as BotEvent).catch((e: unknown) =>
            console.error('[Core] ❌ Erreur reprise automatique ReAct:', e),
          );
        }
      } else {
        console.log('[Core] ✅ Aucune tâche interrompue.');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[Core] ❌ Erreur lors de la vérification de reprise:', msg);
    }
  }

  /**
   * (Module 3) Vérification de la Roadmap au premier message
   */
  async _checkRoadmap(chatId: string, isGroup: boolean) {
    if (!isGroup) return;
    const { db } = this;
    const config = await db.getGroupConfig(chatId);

    if (!config || !config.description) {
      await this.transport.sendText(
        chatId,
        "⚠️ *Configuration Requise*\nJe n'ai pas de feuille de route pour ce groupe. Quel est notre objectif ici ? (Répondez pour définir la mission)",
      );

      await db.upsertGroupConfig(chatId, { description: 'EN_ATTENTE' });
    }
  }

  /**
   * Exécute un outil avec Graceful Degradation et Mémoire Épisodique
   * Les erreurs sont capturées et retournées à l'IA au lieu de faire crasher le flow
   * Toutes les actions sont loguées pour apprentissage (Episodic Memory)
   */
  async _executeTool(toolCall: ToolDef, message: MessageData) {
    const { agentMemory } = this;
    const fn = (toolCall as unknown as { function: { name: string; arguments: string } }).function;
    const { name, arguments: argsJson } = fn;

    let args: Record<string, unknown>;
    try {
      args = JSON.parse(argsJson);
    } catch (parseErr: unknown) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      console.error('[Core] ❌ Erreur parsing arguments pour %s:', name, msg);

      // Log l'échec de parsing
      await agentMemory.logAction(
        message.chatId,
        name,
        { raw: argsJson },
        {},
        'error',
        `Parse error: ${msg}`,
      );

      return {
        success: false,
        message: `ERREUR_OUTIL: Impossible de parser les arguments pour "${name}". Arguments invalides.`,
        error: msg,
        gracefulDegradation: true,
      };
    }

    const context = {
      transport: this.transport,
      container, // Injection du container pour accès aux services (Audit M3)
      message,
      chatId: message.chatId,
      sender: message.sender,
      conversationHistory: (message as MessageData & { conversationHistory?: unknown })
        .conversationHistory, // Cloned history for sub-agents / forks
      // sourceChannel is used by PermissionManager.askPermission to route
      // the sandbox permission prompt to the correct transport adapter.
      sourceChannel:
        message.sourceChannel ?? (message.chatId?.endsWith('@g.us') ? 'group' : 'private'),
      // [ASYNC RENDERING] Callback de progression pour feedback temps réel
      onProgress: (statusMessage: string) => {
        eventBus.publish(BotEvents.TOOL_PROGRESS, {
          tool: name,
          status: statusMessage,
          chatId: message.chatId,
        });
        console.log(`[Tool Progress] ⏳ ${name}: ${statusMessage}`);
      },
    };

    // [AGENTIC] Vérifier si cet outil a récemment échoué (éviter répétition)
    const recentFailure = await agentMemory.hasRecentFailure(message.chatId, name, 15);
    if (recentFailure.hasFailure) {
      console.warn(`[Core] ⚠️ Outil "${name}" a échoué récemment: ${recentFailure.errorMessage}`);
      // On continue quand même mais on log l'avertissement
    }

    try {
      const result = await pluginLoader.execute(name, args, context);

      // [AGENTIC] Log succès dans la mémoire épisodique
      await agentMemory.logAction(
        message.chatId,
        name,
        args,
        typeof result === 'object' ? result : { response: result },
        'success',
        null,
      );

      return result;
    } catch (execErr: unknown) {
      const errMessage = execErr instanceof Error ? execErr.message : String(execErr);
      console.error('[Core] ⚠️ Graceful Degradation - Outil "%s" a échoué:', name, errMessage);

      let errorType = 'ERREUR_INTERNE';
      let userFriendlyMsg = errMessage;

      if (errMessage.includes('timeout') || errMessage.includes('Timeout')) {
        errorType = 'TIMEOUT';
        userFriendlyMsg = 'Le service a mis trop de temps à répondre';
      } else if (errMessage.includes('network') || errMessage.includes('fetch')) {
        errorType = 'ERREUR_RESEAU';
        userFriendlyMsg = 'Impossible de joindre le service externe';
      } else if (errMessage.includes('401') || errMessage.includes('403')) {
        errorType = 'ERREUR_AUTH';
        userFriendlyMsg = "Problème d'authentification avec le service";
      } else if (errMessage.includes('404')) {
        errorType = 'NON_TROUVE';
        userFriendlyMsg = "La ressource demandée n'existe pas";
      } else if (errMessage.includes('rate') || errMessage.includes('limit')) {
        errorType = 'RATE_LIMIT';
        userFriendlyMsg = 'Trop de requêtes, réessayer plus tard';
      }

      await agentMemory.logAction(
        message.chatId,
        name,
        args,
        {},
        'error',
        `[${errorType}] ${errMessage}`,
      );

      return {
        success: false,
        message: `ERREUR_OUTIL [${errorType}]: L'outil "${name}" a échoué - ${userFriendlyMsg}. Tu peux expliquer à l'utilisateur que cette fonctionnalité est temporairement indisponible et continuer avec les autres demandes.`,
        error: errMessage,
        gracefulDegradation: true,
      };
    }
  }

  /**
   * Génère un refus humanisé
   */
  async _generateRefusal(originalMessage: string, reason: string) {
    // Construction du prompt via le template chargé
    const prompt = refusalPrompt
      .replace('{{name}}', persona.name)
      .replace('{{reason}}', reason)
      .replace('{{role}}', persona.role || 'Assistant');

    const response = await providerRouter.chat(
      [
        {
          role: 'system',
          content: prompt,
        },
        { role: 'user', content: originalMessage },
      ],
      { temperature: 0.9, family: 'google' },
    ); // Optimisation : on force Google pour les tâches simples (rapide/gratuit)

    return response.content;
  }

  /**
   * Reformule le résultat d'un outil
   */
  async _reformulateResult(originalMessage: string, result: string, family: string | null = null) {
    const response = await providerRouter.chat(
      [
        {
          role: 'system',
          content: `You are ${persona.name}. Formulate a natural response based on this result: ${result}. Be concise.`,
        },
        { role: 'user', content: originalMessage },
      ],
      {
        temperature: 0.7,
        // Forcer le même provider pour la cohérence du contexte
        ...(family && { family }),
      },
    );

    return response.content;
  }

  /**
   * Délai naturel pour simuler la frappe
   */
  async _naturalDelay(ms: number = 1500) {
    const jitter = Math.floor(ms * 0.3);
    const delay = ms + (randomInt(0, Math.max(1, jitter * 2)) - jitter);
    await new Promise((r) => setTimeout(r, Math.max(100, delay)));
  }

  async _trackGroupMemberEvent(
    groupId: string,
    participant: string,
    action: string,
  ): Promise<void> {
    const { db, groupService } = this;
    try {
      await db.recordMemberEvent(groupId, participant, action);

      if (action === 'add') {
        const hasLeftBefore = await db.hasLeftBefore(groupId, participant);
        if (hasLeftBefore) {
          const username = participant.split('@')[0];
          console.log(`[GroupEvent] 🔄 Utilisateur ${username} a rejoint à nouveau`);

          await this.transport.sendText(groupId, `👀 @${username} est de retour dans le groupe!`, {
            mentions: [participant],
          });
        }
      }
    } catch (error: unknown) {
      const errObj = error as { code?: string; message?: string };
      if (errObj?.code === '23503' || errObj?.message?.includes('foreign key constraint')) {
        console.log("[GroupEvent] 🔄 Groupe inconnu en DB, synchronisation d'urgence...");
        try {
          const metadata = await this.transport.getGroupMetadata(groupId);
          await groupService.updateGroup(groupId, metadata);

          await db.recordMemberEvent(groupId, participant, action);
          console.log('[GroupEvent] ✓ Synchronisation et tracking réussis');
        } catch (syncError: unknown) {
          console.error('[GroupEvent] Échec récupération sync:', syncError);
        }
      } else {
        console.error('[GroupEvent] Erreur tracking:', error);
      }
    }
  }

  /**
   * Gère les événements de groupe (Module 3 & 2)
   */
  async _handleGroupEvent(event: { groupId: string; [key: string]: unknown }) {
    const { db, groupService } = this;
    const { groupId, participants, action } = event as unknown as {
      groupId: string;
      participants: string[];
      action: string;
    };

    if (['promote', 'demote', 'remove'].includes(action)) {
      await groupService.invalidateCache(groupId);
    }

    for (const participant of participants) {
      await this._trackGroupMemberEvent(groupId, participant, action);
    }

    if (action === 'add') {
      await this._handleGroupWelcome(event as unknown as BotEvent);

      try {
        const founder = await db.getGroupFounder(groupId);
        if (!founder) {
          const metadata = await this.transport.getGroupMetadata(groupId);
          const creatorJid = metadata.owner || metadata.subjectOwner;

          if (creatorJid) {
            await db.setGroupFounder(groupId, creatorJid);
            console.log(`[GroupEvent] ✓ Fondateur défini: ${creatorJid}`);
          }
        }
      } catch (error: unknown) {
        console.error('[GroupEvent] Erreur définition fondateur:', error);
      }
    }

    const messages = new Map<string, string>([
      ['remove', `👋 Au revoir @${participants[0]?.split('@')[0]}...`],
      ['promote', `🎉 Félicitations @${participants[0]?.split('@')[0]} est maintenant admin !`],
      ['demote', `📉 @${participants[0]?.split('@')[0]} n'est plus admin.`],
    ]);

    const msgText = messages.get(action);
    if (msgText) {
      await this.transport.sendText(groupId, msgText, {
        mentions: participants,
      });
    }
  }

  async _wakeInactiveGroups(): Promise<void> {
    const hour = new Date().getHours();
    if (hour < 9 || hour >= 22) return;

    const inactiveGroups = await this.workingMemory.getInactiveGroups(180);
    for (const groupId of inactiveGroups) {
      console.log(`[GoalSeeking] 💀 Groupe inactif détecté : ${groupId}`);
      if (randomInt(1, 100) > 30) continue;

      const fakeContext = {
        isGroup: true,
        chatId: groupId,
        text: 'SYSTEM_WAKEUP_PROTOCOL: The group is inactive. Generate a thought to wake it up politely or with a controversial topic about tech/AI.',
        senderName: 'SYSTEM',
        sender: 'system@internal',
      };

      await this._handleMessage({ data: fakeContext } as BotEvent);
    }
  }

  async _handleSpontaneousReflectionJob(): Promise<void> {
    console.log('[Scheduler] 🤔 Réflexion Spontanée (Goal Seeking)...');
    await this._wakeInactiveGroups();

    console.log('[Agent] 🧘 Réflexion spontanée déclenchée...');
    try {
      const pendingReminders = await this.db.getPendingReminders();
      if (pendingReminders && pendingReminders.length > 0) {
        console.log(
          `[Agent] 🧘 Scan tâches en attente : ${pendingReminders.length} rappel(s) actif(s).`,
        );
      } else {
        console.log('[Agent] 🧘 Scan tâches en attente : Aucune tâche différée pendante.');
      }
    } catch (err: unknown) {
      console.warn(
        '[Agent] ⚠️ Erreur lors du scan des tâches en attente:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  async _processSingleReminder(reminder: {
    id: string;
    chat_id: string;
    message: string;
  }): Promise<void> {
    if (reminder.message.startsWith('COMMAND:BAN_USER:')) {
      try {
        const payload = reminder.message.replace('COMMAND:BAN_USER:', '');
        const [targetJid, reason] = payload.split('|');

        console.log(`[Scheduler] 🚀 Exécution BAN planifié pour ${targetJid}`);

        await (
          this.transport as unknown as { banUser: (c: string, u: string) => Promise<void> }
        ).banUser(reminder.chat_id, targetJid);

        await this.transport.sendText(
          reminder.chat_id,
          `🚫 **Ban planifié exécuté**\nUtilisateur: @${targetJid.split('@')[0]}\nRaison: ${reason || 'Aucune'}`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[Scheduler] ❌ Erreur exécution BAN planifié: ${msg}`);
        await this.transport.sendText(
          reminder.chat_id,
          `⚠️ Échec du ban planifié pour @${reminder.message.split(':')[2]?.split('|')[0] || '?'} : ${msg}`,
        );
      }
    } else {
      await this.transport.sendText(reminder.chat_id, `⏰ Rappel: ${reminder.message}`);
    }

    await this.db.markReminderSent(reminder.id);
  }

  async _handleReminderCheckJob(): Promise<void> {
    const reminders = await this.db.getPendingReminders();
    for (const reminder of reminders) {
      await this._processSingleReminder(reminder);
    }
  }

  async _handleMemoryConsolidationJob(): Promise<void> {
    console.log('[Scheduler] 🧶 Consolidation de la mémoire et Tissage du savoir...');
    try {
      const { redis } = await import('../services/redisClient.js');
      const keys = await redis.keys('chat:*:context');
      const chatIds = keys.map((k: string) => k.split(':')[1]);

      if (chatIds.length === 0) {
        console.log('[Scheduler] Aucun chat actif à consolider.');
        return;
      }

      console.log(`[Scheduler] Consolidation de ${chatIds.length} chats...`);
      const consolidationService = container.get('consolidationService');

      for (const chatId of chatIds) {
        consolidationService
          .consolidate(chatId)
          .catch((err: unknown) =>
            console.error(
              '[Scheduler] Erreur consolidation %s:',
              chatId,
              err instanceof Error ? err.message : String(err),
            ),
          );
      }
    } catch (e: unknown) {
      console.error(
        '[Scheduler] Erreur globale consolidation:',
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  async _handleCognitiveDreamJob(): Promise<void> {
    console.log('[Scheduler] 💤 Le bot entre en phase de rêve (Auto-Reflection)...');
    try {
      const dreamService = container.get('dream');
      if (dreamService) {
        await dreamService.dream();
      }
    } catch (e: unknown) {
      console.error(
        '[Scheduler] Erreur pendant le rêve:',
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  async _handleMemoryCleanupJob(): Promise<void> {
    console.log('[Scheduler] 🧹 Nettoyage mémoire sémantique...');
    try {
      const { supabase } = await import('../services/supabase.js');
      const { data: heavyChats } = supabase
        ? await supabase.from('semantic_memory').select('chat_id').limit(100)
        : { data: [] };

      if (heavyChats && heavyChats.length > 0) {
        const uniqueChatIds = [...new Set(heavyChats.map((m: { chat_id: string }) => m.chat_id))];
        console.log(`[Scheduler] ${uniqueChatIds.length} chat(s) à nettoyer`);

        for (const chatId of uniqueChatIds) {
          const memory = container.get('memory');
          await memory.cleanup(chatId, 100);
        }
      }
      console.log('[Scheduler] ✅ Nettoyage mémoire terminé');
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('[Scheduler] Erreur memoryCleanup:', msg);
    }
  }

  async _handleTempCleanupJob(): Promise<void> {
    console.log('[Scheduler] 🧹 Nettoyage fichiers temporaires...');
    try {
      const { CleanupService } = await import('../services/cleanup.js');
      const cleanup = new CleanupService();
      await cleanup.run();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[Scheduler] Erreur tempCleanup:', msg);
    }
  }

  /**
   * Gère une tâche planifiée
   */
  async _handleScheduledJob(event: { job: string; [key: string]: unknown }) {
    console.log(`[Scheduler] Exécution job: ${event.job}`);

    switch (event.job) {
      case 'dailyGreeting':
        break;

      case 'spontaneousReflection':
        await this._handleSpontaneousReflectionJob();
        break;

      case 'reminderCheck':
        await this._handleReminderCheckJob();
        break;

      case 'memoryConsolidation':
        await this._handleMemoryConsolidationJob();
        break;

      case 'cognitiveDream':
        await this._handleCognitiveDreamJob();
        break;

      case 'memoryCleanup':
        await this._handleMemoryCleanupJob();
        break;

      case 'tempCleanup':
        await this._handleTempCleanupJob();
        break;
    }

    eventBus.publish(BotEvents.JOB_COMPLETED, { job: event.job });
  }

  /**
   * Gère les déclencheurs proactifs
   */
  /**
   * Gère la réponse proactive
   */
  async _handleProactive(event: BotEvent): Promise<void> {
    // ... (code existant)
    // Réponse proactive sur keyword détecté
    const { chatId, text } = event.data as { chatId: string; text: string };

    const response = await providerRouter.chat([
      {
        role: 'system',
        content: `You are ${persona.name}. Intervene naturally on this topic that interests you. Be brief and bring value.`,
      },
      { role: 'user', content: text },
    ]);

    await this._naturalDelay();
    // Un `content` nul (refus provider ou réponse tool-only) ne justifie aucune
    // intervention proactive : on sort sans émettre de message vide.
    if (!response.content) return;
    await this.transport.sendUniversalResponse(
      chatId,
      { markdown: response.content },
      {},
      (event.data as Record<string, string>).sourceChannel,
    );
  }

  /**
   * Gère l'arrêt d'urgence du bot (.shutdown)
   * Format: .shutdown [duration] (ex: .shutdown 2h)
   */
  async _handleShutdown(message: MessageData): Promise<void> {
    const { adminService } = this;
    const { sender, chatId, text } = message;

    if (!adminService.isGlobalAdmin(sender)) {
      console.log(`[Security] Tentative de shutdown non autorisée par ${sender}`);
      return;
    }

    console.log(`[Security] Shutdown demandé par ${sender}`);

    const args = text.split(' ');
    const durationStr = args[1];
    let shutdownUntil: number | null = null;

    if (durationStr) {
      const match = durationStr.match(/^(\d+)([hm])$/);
      if (match) {
        const amount = parseInt(match[1]);
        const unit = match[2];
        const ms = amount * (unit === 'h' ? 3600000 : 60000);
        shutdownUntil = Date.now() + ms;
      }
    }

    const goodbye = shutdownUntil
      ? `😴 Je fais une sieste de ${durationStr}. À tout à l'heure !`
      : '👋 Arrêt du système demandé. Au revoir !';

    await this.transport.sendText(chatId, goodbye);

    if (shutdownUntil) {
      await fsPromises.writeFile(join(__dirname, '..', '.shutdown_lock'), shutdownUntil.toString());
    }

    setTimeout(() => {
      hiveWakeSystem.stop();
      mailboxWatcher.stop();
      console.log('🛑 Arrêt du processus.');
      process.exit(0);
    }, 2000);
  }

  private _matchFactPattern(
    text: string,
    regex: RegExp,
    key: string,
  ): { key: string; value: string } | null {
    const match = text.match(regex);
    if (!match || !match[1]) return null;
    const value = match[1].trim();
    if (value.length < 2 || ['un', 'une', 'le', 'la'].includes(value.toLowerCase())) return null;
    return { key, value };
  }

  /**
   * Extrait automatiquement les faits importants d'un message
   * Fonctionne en arrière-plan sans bloquer la réponse
   * @param {string} text - Texte du message utilisateur
   * @param {string} userJid - JID de l'utilisateur
   */
  async _extractFacts(text: string, userJid: string): Promise<void> {
    const { factsMemory } = this;

    if (!text || text.length < 10 || text.startsWith('.') || text.startsWith('/')) {
      return;
    }

    const patterns = [
      {
        regex: /(?:je (?:m'appelle|suis|me nomme))\s+([a-zà-ÿ\s]{2,30})/i,
        key: 'nom',
      },
      {
        regex: /(?:j'habite|je vis|je suis)\s+(?:à|en|au)\s+([a-zà-ÿ\s]{2,30})/i,
        key: 'ville',
      },
      { regex: /(?:je suis|je travaille comme)\s+([a-zà-ÿ\s]{2,30})/i, key: 'métier' },
      { regex: /(?:j'ai|j ai)\s+(\d{1,3})\s*ans/i, key: 'age' },
      {
        regex: /(?:mon anniversaire|je suis né|née)\s+le\s+(\d{1,2}\s+[a-zà-ÿ]{3,12})/i,
        key: 'anniversaire',
      },
      {
        regex:
          /(?:ma couleur préférée|j'aime le|j'adore le)\s+(bleu|rouge|vert|jaune|noir|blanc|rose|violet|orange)/i,
        key: 'couleur_préférée',
      },
    ];

    const extractedFacts: Array<{ key: string; value: string }> = [];

    for (const { regex, key } of patterns) {
      const fact = this._matchFactPattern(text, regex, key);
      if (fact) extractedFacts.push(fact);
    }

    if (extractedFacts.length === 0) return;

    console.log(`[Core] Faits extraits automatiquement: ${extractedFacts.length}`);

    for (const { key, value } of extractedFacts) {
      try {
        await factsMemory.remember(userJid, key, value);
        console.log(`  ✓ ${key}: ${value}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('  ✗ Erreur stockage %s:', key, msg);
      }
    }
  }
}

export const botCore = new BotCore();
export default botCore;
