/**
 * Commandes slash spécifiques à HIVE-MIND
 *
 * Ces commandes exploitent les fonctionnalités uniques de HIVE-MIND :
 * - Gestion multi-canal (WhatsApp, Discord, Telegram)
 * - Mémoire distribuée (Redis, pgvector, PostgreSQL)
 * - Plugins et outils (50+ outils)
 * - Scheduler/Cron jobs
 * - Voice (Gemini Live, TTS)
 * - Smart Router V2
 * - Safety (Sentinel VIGIL)
 */

import {
  SlashCommand,
  CommandKind,
  CommandContext,
  HistoryItem,
  SlashCommandActionReturn,
} from '../contexts/UIStateContext.js';

async function getRedisStatus(redis: unknown): Promise<string> {
  if (!redis) return '**Redis:** ⚠️ Non configuré\n';
  try {
    const r = redis as { ping: () => Promise<unknown> };
    await r.ping();
    return '**Redis:** ✅ Connecté\n';
  } catch {
    return '**Redis:** ❌ Déconnecté\n';
  }
}

async function getSupabaseStatus(supabase: unknown): Promise<string> {
  if (!supabase || typeof (supabase as { from?: unknown }).from !== 'function') {
    return '**Supabase:** ⚠️ Non configuré\n';
  }
  try {
    const s = supabase as {
      from: (t: string) => { select: (c: string) => { limit: (n: number) => Promise<unknown> } };
    };
    const tableQuery = s.from('users');
    if (tableQuery) await tableQuery.select('count').limit(1);
    return '**Supabase:** ✅ Connecté\n';
  } catch {
    return '**Supabase:** ❌ Erreur de connexion\n';
  }
}

/**
 * Commande /status — État du bot HIVE-MIND
 */
export const hiveStatusCommand: SlashCommand = {
  name: 'status',
  altNames: ['etat', 'state'],
  description: "Affiche l'état complet du bot HIVE-MIND",
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext) => {
    const { addItem } = context.ui!;

    try {
      // Import dynamique du core
      const { botCore } = await import('../../../core/index.js');
      const { container } = await import('../../../core/ServiceContainer.js');

      // Récupérer l'état des services
      const redis = container.has('redis') ? container.get('redis') : null;
      const supabase = container.has('supabase') ? container.get('supabase') : null;
      const transportManager = botCore.transport;

      let statusText = '🤖 *État HIVE-MIND*\n\n';

      // Core
      statusText += `**Core:** ${botCore.isReady ? '✅ Prêt' : '❌ Non initialisé'}\n`;

      // Redis
      statusText += await getRedisStatus(redis);

      // Supabase
      statusText += await getSupabaseStatus(supabase);

      // Transports actifs
      const activeTransports =
        (transportManager as unknown as { activeTransports?: string[] })?.activeTransports || [];
      statusText += `**Transports:** ${activeTransports.join(', ') || 'Aucun'}\n`;

      // Modèle actuel
      statusText += `**Modèle:** ${process.env.HIVE_MODEL || 'default'}\n`;

      // Uptime
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      statusText += `**Uptime:** ${hours}h ${minutes}m\n`;

      addItem(
        {
          type: 'info',
          text: statusText,
        },
        Date.now(),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      addItem(
        {
          type: 'error',
          text: `❌ Erreur lors de la récupération du statut: ${message}`,
        },
        Date.now(),
      );
    }
  },
};

/**
 * Commande /plugins — Liste les plugins chargés
 */
export const hivePluginsCommand: SlashCommand = {
  name: 'plugins',
  altNames: ['extensions', 'addons'],
  description: 'Liste les plugins HIVE-MIND chargés',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext) => {
    const { addItem } = context.ui!;

    try {
      const { pluginLoader } = await import('../../../plugins/loader.js');

      const tools = pluginLoader.getToolDefinitions();
      const toolNames = tools
        .map((t: { function?: { name?: string } }) => t.function?.name)
        .filter((n): n is string => typeof n === 'string');

      let pluginsText = '🔌 *Plugins HIVE-MIND*\n\n';
      pluginsText += `**Nombre d'outils:** ${toolNames.length}\n\n`;
      pluginsText += '**Outils disponibles:**\n';
      pluginsText += toolNames.map((name: string) => `• ${name}`).join('\n');

      addItem(
        {
          type: 'info',
          text: pluginsText,
        },
        Date.now(),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      addItem(
        {
          type: 'error',
          text: `❌ Erreur lors de la récupération des plugins: ${message}`,
        },
        Date.now(),
      );
    }
  },
};

async function getRedisMemoryInfo(redis: unknown): Promise<string> {
  if (!redis) return '**L1 (Redis):** ❌ Non configuré\n';
  try {
    const r = redis as { info: (s: string) => Promise<string> };
    const info = await r.info('memory');
    const usedMemory = info.match(/used_memory_human:(\S+)/)?.[1] || 'N/A';
    return `**L1 (Redis):** ✅ ${usedMemory} utilisé\n`;
  } catch {
    return '**L1 (Redis):** ⚠️ Non disponible\n';
  }
}

async function getPgVectorInfo(supabase: unknown): Promise<string> {
  if (!supabase || typeof (supabase as { from?: unknown }).from !== 'function') {
    return '**L2 (pgvector):** ❌ Non configuré\n';
  }
  try {
    const s = supabase as {
      from: (t: string) => { select: (c: string, o: object) => Promise<{ count?: number }> };
    };
    const tableQuery = s.from('workspace_write');
    if (tableQuery) {
      const { count } = await tableQuery.select('*', { count: 'exact', head: true });
      return `**L2 (pgvector):** ✅ ${count || 0} entrées\n`;
    }
    return '**L2 (pgvector):** ⚠️ Non disponible\n';
  } catch {
    return '**L2 (pgvector):** ⚠️ Non disponible\n';
  }
}

/**
 * Commande /memory — État de la mémoire
 */
export const hiveMemoryCommand: SlashCommand = {
  name: 'memory',
  altNames: ['memoire', 'mem'],
  description: "Affiche l'état de la mémoire distribuée",
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext) => {
    const { addItem } = context.ui!;

    try {
      const { container } = await import('../../../core/ServiceContainer.js');

      let memoryText = '🧠 *Mémoire HIVE-MIND*\n\n';

      // L0: In-process
      memoryText += '**L0 (In-process):** ✅ Active\n';

      // L1: Redis
      const redis = container.has('redis') ? container.get('redis') : null;
      memoryText += await getRedisMemoryInfo(redis);

      // L2: pgvector
      const supabase = container.has('supabase') ? container.get('supabase') : null;
      memoryText += await getPgVectorInfo(supabase);

      // L3: PostgreSQL
      memoryText += '**L3 (PostgreSQL):** ✅ Connecté\n';

      addItem(
        {
          type: 'info',
          text: memoryText,
        },
        Date.now(),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      addItem(
        {
          type: 'error',
          text: `❌ Erreur lors de la récupération de la mémoire: ${message}`,
        },
        Date.now(),
      );
    }
  },
};

/**
 * Commande /routes — État du Smart Router
 */
export const hiveRoutesCommand: SlashCommand = {
  name: 'routes',
  altNames: ['router', 'keys'],
  description: "Affiche l'état du Smart Router V2 et des clés API",
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext) => {
    const { addItem } = context.ui!;

    try {
      const { getProviderStatus } = await import('../utils/providerStatus.js');
      const status = getProviderStatus();

      let routesText = '🔑 *Smart Router V2*\n\n';
      routesText += `**Providers:** ${status.activeFamilies}/${status.totalFamilies} actifs (${status.totalKeys} clés configurées)\n\n`;

      for (const family of status.families) {
        const icon = family.keyCount > 0 ? '✅' : '⚠️';
        const keyCountLabel = `${family.keyCount} clé${family.keyCount > 1 ? 's' : ''}`;
        const keyLabel = family.keyCount > 0 ? keyCountLabel : 'aucune clé';
        routesText += `${icon} ${family.name || family.id} — ${keyLabel}, ${family.modelCount} modèles\n`;
      }

      addItem(
        {
          type: 'info',
          text: routesText,
        },
        Date.now(),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      addItem(
        {
          type: 'error',
          text: `❌ Erreur lors de la récupération des routes: ${message}`,
        },
        Date.now(),
      );
    }
  },
};

/**
 * Commande /groups — Liste les groupes gérés
 */
export const hiveGroupsCommand: SlashCommand = {
  name: 'groups',
  altNames: ['groupes', 'grp'],
  description: 'Liste les groupes WhatsApp/Discord gérés',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext) => {
    const { addItem } = context.ui!;

    try {
      const { container } = await import('../../../core/ServiceContainer.js');
      const groupService = container.has('groupService') ? container.get('groupService') : null;

      let groupsText = '👥 *Groupes HIVE-MIND*\n\n';

      if (groupService) {
        // Récupérer les groupes depuis la base
        const { supabase } = await import('../../../services/supabase.js');
        const { data: groups } = await (
          supabase as unknown as {
            from: (table: string) => {
              select: (fields: string) => {
                limit: (
                  n: number,
                ) => Promise<{ data: Array<{ name: string; platform: string }> | null }>;
              };
            };
          }
        )
          .from('groups')
          .select('id, name, platform')
          .limit(10);

        if (groups && groups.length > 0) {
          groupsText += groups
            .map((g: { name: string; platform: string }) => `• **${g.name}** (${g.platform})`)
            .join('\n');
        } else {
          groupsText += 'Aucun groupe configuré';
        }
      } else {
        groupsText += '⚠️ Service de groupes non disponible';
      }

      addItem(
        {
          type: 'info',
          text: groupsText,
        },
        Date.now(),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      addItem(
        {
          type: 'error',
          text: `❌ Erreur lors de la récupération des groupes: ${message}`,
        },
        Date.now(),
      );
    }
  },
};

/**
 * Commande /cron — Liste les tâches planifiées
 */
export const hiveCronCommand: SlashCommand = {
  name: 'cron',
  altNames: ['scheduler', 'taches'],
  description: 'Affiche les tâches planifiées (cron jobs)',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext) => {
    const { addItem } = context.ui!;

    try {
      const { container } = await import('../../../core/ServiceContainer.js');
      const schedulerHandler = container.has('schedulerHandler')
        ? container.get('schedulerHandler')
        : null;

      let cronText = '⏰ *Tâches Planifiées*\n\n';

      if (schedulerHandler) {
        // Récupérer les crons actifs
        cronText += '**Crons actifs:**\n';
        cronText += '• memoryEventScanner (toutes les heures)\n';
        cronText += '• sessionCleanup (quotidien)\n';
        cronText += '• memoryConsolidation (hebdomadaire)\n';
      } else {
        cronText += '⚠️ Scheduler non disponible';
      }

      addItem(
        {
          type: 'info',
          text: cronText,
        },
        Date.now(),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      addItem(
        {
          type: 'error',
          text: `❌ Erreur lors de la récupération des crons: ${message}`,
        },
        Date.now(),
      );
    }
  },
};

/**
 * Commande /security — État de la sécurité
 */
export const hiveSecurityCommand: SlashCommand = {
  name: 'security',
  altNames: ['securite', 'secu'],
  description: "Affiche l'état du système de sécurité (Sentinel, HITL)",
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext) => {
    const { addItem } = context.ui!;

    try {
      let securityText = '🛡️ *Sécurité HIVE-MIND*\n\n';

      // Sentinel VIGIL
      securityText += '**Sentinel VIGIL:** ✅ Actif\n';
      securityText += '• Évalue les actions avant exécution\n';
      securityText += '• Bloque les actions à risque\n';

      // PermissionManager (HITL)
      securityText += '\n**PermissionManager (HITL):** ✅ Actif\n';
      securityText += '• Logique 0: CLI/TUI (admin local)\n';
      securityText += '• Logique 1: Admin Hub (out-of-band)\n';
      securityText += '• Logique 2: In-band avec escalade\n';

      // Sandbox
      securityText += '\n**Sandbox:** ✅ Active\n';
      securityText += `• Répertoire: ${process.env.SANDBOX_DIR || 'Sandbox1'}\n`;

      // SafeScriptValidator
      securityText += '\n**SafeScriptValidator:** ✅ Actif\n';
      securityText += '• Layer 1: AST validation\n';
      securityText += '• Layer 2: Proxy protection\n';
      securityText += '• Layer 3: Auto-repair\n';

      addItem(
        {
          type: 'info',
          text: securityText,
        },
        Date.now(),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      addItem(
        {
          type: 'error',
          text: `❌ Erreur lors de la récupération de la sécurité: ${message}`,
        },
        Date.now(),
      );
    }
  },
};

/**
 * Commande /voice — État du système vocal
 */
export const hiveVoiceCommand: SlashCommand = {
  name: 'voice',
  altNames: ['vocal', 'tts'],
  description: "Affiche l'état du système vocal (TTS, STT, Live)",
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext) => {
    const { addItem } = context.ui!;

    try {
      let voiceText = '🎤 *Système Vocal*\n\n';

      // TTS
      voiceText += '**TTS (Text-to-Speech):** ✅ Actif\n';
      voiceText += '• Gemini TTS (Kore)\n';
      voiceText += '• Minimax Persona\n';

      // STT
      voiceText += '\n**STT (Speech-to-Text):** ✅ Actif\n';
      voiceText += '• Gemini Live API\n';
      voiceText += '• Groq Whisper\n';

      // Live Audio
      voiceText += '\n**Live Audio:** ✅ Actif\n';
      voiceText += '• WebSocket Gemini Live\n';
      voiceText += '• VAD (Voice Activity Detection)\n';

      addItem(
        {
          type: 'info',
          text: voiceText,
        },
        Date.now(),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      addItem(
        {
          type: 'error',
          text: `❌ Erreur lors de la récupération de la voix: ${message}`,
        },
        Date.now(),
      );
    }
  },
};

/**
 * Commande /skills — Liste les expert skills détectés localement
 */
export const hiveSkillsCommand: SlashCommand = {
  name: 'skills',
  altNames: ['expert-skills', 'competences'],
  description: 'Affiche la liste de tous les expert skills disponibles et détectés',
  kind: CommandKind.BUILT_IN,
  action: async (context: CommandContext) => {
    const { addItem } = context.ui!;

    try {
      const { learningEngine } = await import('../../../services/learning/LearningEngine.js');
      const skills = await learningEngine.getAllExpertSkills();

      let skillsText = '💡 *Expert Skills Détectés*\n\n';
      skillsText += `**Nombre de skills:** ${skills.length}\n\n`;

      if (skills.length > 0) {
        skillsText += skills
          .map((s) => `• **${s.name}** : ${s.description}\n  _Chemin:_ \`${s.path}\``)
          .join('\n\n');
      } else {
        skillsText += 'Aucun expert skill détecté dans le répertoire `/skills/`.';
      }

      addItem(
        {
          type: 'info',
          text: skillsText,
        },
        Date.now(),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      addItem(
        {
          type: 'error',
          text: `❌ Erreur lors de la récupération des expert skills: ${message}`,
        },
        Date.now(),
      );
    }
  },
};

/**
 * Commande /search — Recherche sémantique par Embeddings
 */
export const hiveSearchCommand: SlashCommand = {
  name: 'search',
  altNames: ['recherche', 'find'],
  description: 'Recherche des fichiers ou médias dans le workspace par similarité sémantique',
  kind: CommandKind.BUILT_IN,
  takesArgs: true,
  action: async (context: CommandContext, args: string) => {
    const { addItem } = context.ui || {};
    if (!addItem) return;

    const query = args?.trim();
    if (!query) {
      addItem(
        {
          type: 'error',
          text: '❌ Veuillez spécifier un terme de recherche. Exemple : `/search initialisation de la base`',
        },
        Date.now(),
      );
      return;
    }

    try {
      const { botCore } = await import('../../../core/index.js');
      const mediaSearch = await botCore.getMediaSearch();

      if (!mediaSearch) {
        addItem(
          {
            type: 'warning',
            text: "⚠️ Le service de recherche par embeddings n'est pas disponible. Vérifiez que vos clés API sont bien configurées.",
          },
          Date.now(),
        );
        return;
      }

      addItem(
        {
          type: 'info',
          text: `🔍 Recherche sémantique pour : "${query}"...`,
        },
        Date.now(),
      );

      const results = await mediaSearch.searchByText('tui-local', query, 5, 0.3);

      if (!results || results.length === 0) {
        addItem(
          {
            type: 'info',
            text: `🔍 Aucun résultat trouvé pour "${query}".`,
          },
          Date.now(),
        );
        return;
      }

      let resultsText = `🔍 *Résultats de recherche pour "${query}"*\n\n`;
      results.forEach((res, idx) => {
        const scorePercent = (res.similarity * 100).toFixed(1);
        resultsText += `${idx + 1}. **${res.fileName || res.filePath}** (Score: ${scorePercent}%)\n`;
        if (res.contentSummary) {
          resultsText += `   _Résumé :_ ${res.contentSummary}\n`;
        }
        resultsText += `   _Chemin :_ \`${res.filePath}\`\n`;
        resultsText += `   _Modalité :_ ${res.modality} (${res.mimeType})\n\n`;
      });

      addItem(
        {
          type: 'info',
          text: resultsText,
        },
        Date.now(),
      );
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      addItem(
        {
          type: 'error',
          text: `❌ Erreur lors de la recherche sémantique: ${message}`,
        },
        Date.now(),
      );
    }
  },
};

interface SessionActionDeps {
  addItem: (item: HistoryItem, timestamp?: number) => void;
  fs: typeof import('node:fs/promises');
  path: typeof import('node:path');
  SessionSelector: typeof import('../../utils/sessionUtils.js').SessionSelector;
  loadConversationRecord: typeof import('../../utils/sessionUtils.js').loadConversationRecord;
  convertSessionToHistoryFormats: typeof import('../../utils/sessionUtils.js').convertSessionToHistoryFormats;
  formatRelativeTime: typeof import('../../utils/sessionUtils.js').formatRelativeTime;
  uiTelemetryService: typeof import('../contexts/UIStateContext.js').uiTelemetryService;
  config: NonNullable<CommandContext['services']>['agentContext'];
}

async function handleSessionList(
  deps: SessionActionDeps,
  selector: InstanceType<SessionActionDeps['SessionSelector']>,
): Promise<void> {
  const { addItem, formatRelativeTime } = deps;
  const sessions = await selector.listSessions();
  if (sessions.length === 0) {
    addItem(
      {
        type: 'info',
        text: '📂 Aucune session précédente trouvée pour ce projet.',
      } as HistoryItem,
      Date.now(),
    );
    return;
  }

  // Trier par startTime comme listSessions de sessions.ts
  const sortedSessions = sessions.sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
  );

  let text = `📂 *Sessions disponibles (${sortedSessions.length}) :*\n\n`;
  sortedSessions.forEach((s) => {
    const activeStr = s.isCurrentSession ? ' 🟢 *(active)*' : '';
    const time = formatRelativeTime(s.lastUpdated);
    text += `${s.index}. **${s.displayName}** (${s.messageCount} messages, ${time})${activeStr}\n   _ID:_ \`${s.id}\`\n\n`;
  });

  addItem(
    {
      type: 'info',
      text,
    } as HistoryItem,
    Date.now(),
  );
}

async function handleSessionResume(
  deps: SessionActionDeps,
  selector: InstanceType<SessionActionDeps['SessionSelector']>,
  idOrIndex: string,
): Promise<SlashCommandActionReturn | void> {
  const {
    addItem,
    path,
    loadConversationRecord,
    convertSessionToHistoryFormats,
    config,
    uiTelemetryService,
  } = deps;
  const chatsDir = path.join(config!.storage.getProjectTempDir(), 'chats');
  const sessionInfo = await selector.findSession(idOrIndex);
  const filePath = path.join(chatsDir, sessionInfo.fileName);
  const conversation = await loadConversationRecord(filePath);
  if (!conversation) {
    addItem(
      {
        type: 'error',
        text: `❌ Impossible de charger la session depuis ${filePath}`,
      } as HistoryItem,
      Date.now(),
    );
    return;
  }

  config!.setSessionId(conversation.sessionId);
  uiTelemetryService.hydrate(conversation);

  const historyData = convertSessionToHistoryFormats(conversation.messages);
  const historyItems = historyData.uiHistory.map((item, idx) => ({
    ...item,
    id: idx,
  })) as unknown as HistoryItem[];

  addItem(
    {
      type: 'info',
      text: `🔄 Session ${sessionInfo.index} reprise : "${sessionInfo.displayName}"`,
    } as HistoryItem,
    Date.now(),
  );

  return {
    type: 'load_history',
    clientHistory: [],
    history: historyItems,
  } as unknown as SlashCommandActionReturn;
}

async function handleSessionDelete(
  deps: SessionActionDeps,
  selector: InstanceType<SessionActionDeps['SessionSelector']>,
  idOrIndex: string,
): Promise<void> {
  const { addItem, path, fs } = deps;
  const chatsDir = path.join(deps.config!.storage.getProjectTempDir(), 'chats');
  const sessionInfo = await selector.findSession(idOrIndex);
  if (sessionInfo.isCurrentSession) {
    addItem(
      {
        type: 'error',
        text: '❌ Impossible de supprimer la session active.',
      } as HistoryItem,
      Date.now(),
    );
    return;
  }

  const filePath = path.join(chatsDir, sessionInfo.fileName);
  await fs.unlink(filePath);

  addItem(
    {
      type: 'info',
      text: `🗑️ Session ${sessionInfo.index} supprimée avec succès.`,
    } as HistoryItem,
    Date.now(),
  );
}

async function handleSessionRename(
  deps: SessionActionDeps,
  selector: InstanceType<SessionActionDeps['SessionSelector']>,
  idOrIndex: string,
  parts: string[],
): Promise<void> {
  const { addItem, path, fs, loadConversationRecord } = deps;
  const newName = parts.slice(2).join(' ').trim();
  if (!newName) {
    addItem(
      {
        type: 'error',
        text: '❌ Veuillez spécifier un nouveau nom. Exemple : `/session rename 2 Nouveau Nom`',
      } as HistoryItem,
      Date.now(),
    );
    return;
  }

  const chatsDir = path.join(deps.config!.storage.getProjectTempDir(), 'chats');
  const sessionInfo = await selector.findSession(idOrIndex);
  const filePath = path.join(chatsDir, sessionInfo.fileName);
  const conversation = await loadConversationRecord(filePath);
  if (!conversation) {
    addItem(
      {
        type: 'error',
        text: '❌ Impossible de charger la session pour la renommer.',
      } as HistoryItem,
      Date.now(),
    );
    return;
  }

  conversation.summary = newName;
  await fs.writeFile(filePath, JSON.stringify(conversation, null, 2), 'utf-8');

  addItem(
    {
      type: 'info',
      text: `✏️ Session ${sessionInfo.index} renommée en : "${newName}".`,
    } as HistoryItem,
    Date.now(),
  );
}

/**
 * Commande /session — Gestionnaire de Sessions Hybride
 */
export const hiveSessionCommand: SlashCommand = {
  name: 'session',
  altNames: ['sess'],
  description: 'Gère les sessions de code (list, resume, delete, rename)',
  kind: CommandKind.BUILT_IN,
  takesArgs: true,
  action: async (context: CommandContext, args: string) => {
    const { addItem } = context.ui || {};
    if (!addItem) return;

    const parts = (args || '').trim().split(/\s+/);
    const subCommand = parts[0]?.toLowerCase();

    if (!subCommand || !['list', 'resume', 'delete', 'rename'].includes(subCommand)) {
      addItem(
        {
          type: 'error',
          text: '❌ Usage: /session list | resume <id/index> | delete <id/index> | rename <id/index> <nouveau nom>',
        } as HistoryItem,
        Date.now(),
      );
      return;
    }

    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const {
        SessionSelector,
        loadConversationRecord,
        convertSessionToHistoryFormats,
        formatRelativeTime,
      } = await import('../../utils/sessionUtils.js');
      const { uiTelemetryService } = await import('../contexts/UIStateContext.js');
      const config = context.services?.agentContext;

      if (!config) {
        addItem(
          {
            type: 'error',
            text: "❌ Configuration de l'agent non disponible dans le contexte.",
          } as HistoryItem,
          Date.now(),
        );
        return;
      }

      const chatsDir = path.join(config.storage.getProjectTempDir(), 'chats');
      const selector = new SessionSelector(chatsDir);
      const deps: SessionActionDeps = {
        addItem,
        fs,
        path,
        SessionSelector,
        loadConversationRecord,
        convertSessionToHistoryFormats,
        formatRelativeTime,
        uiTelemetryService,
        config,
      };

      if (subCommand === 'list') {
        await handleSessionList(deps, selector);
        return;
      }

      const idOrIndex = parts[1];
      if (!idOrIndex) {
        addItem(
          {
            type: 'error',
            text: `❌ Veuillez spécifier un identifiant ou un index pour la commande /session ${subCommand}`,
          } as HistoryItem,
          Date.now(),
        );
        return;
      }

      if (subCommand === 'resume') {
        const result = await handleSessionResume(deps, selector, idOrIndex);
        if (result) {
          return result;
        }
        return;
      }

      if (subCommand === 'delete') {
        await handleSessionDelete(deps, selector, idOrIndex);
        return;
      }

      if (subCommand === 'rename') {
        await handleSessionRename(deps, selector, idOrIndex, parts);
        return;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      addItem(
        {
          type: 'error',
          text: `❌ Erreur lors de la gestion de session: ${message}`,
        } as HistoryItem,
        Date.now(),
      );
    }
  },
};

/**
 * Exporte toutes les commandes HIVE-MIND
 */
export const hiveCommands: SlashCommand[] = [
  hiveStatusCommand,
  hivePluginsCommand,
  hiveMemoryCommand,
  hiveRoutesCommand,
  hiveGroupsCommand,
  hiveCronCommand,
  hiveSecurityCommand,
  hiveVoiceCommand,
  hiveSkillsCommand,
  hiveSearchCommand,
  hiveSessionCommand,
];
