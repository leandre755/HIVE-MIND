// core/handlers/schedulerHandler.js
// Gère les tâches planifiées du scheduler
// Extrait de core/index.js pour modularité

import { randomBytes } from 'node:crypto';
import { eventBus, BotEvents } from '../events.js';
import { container } from '../ServiceContainer.js';
import { workingMemory } from '../../services/workingMemory.js';
import { db } from '../../services/supabase.js';
import { eventInboxService, type SystemEvent } from '../../services/events/EventInboxService.js';
import { actionMemory } from '../../services/memory/ActionMemory.js';
import { hiveWakeSystem } from '../../services/ptc/WakeSystem.js';
import { redis } from '../../services/redisClient.js';
import cronParser from 'cron-parser';
import type { BotEvent, MessageData } from '../types/BotTypes.js';

export interface SchedulerTransport {
  sendText(chatId: string, text: string, options?: unknown): Promise<unknown>;
  banUser?(chatId: string, targetJid: string): Promise<unknown>;
}

export interface SchedulerJobEvent {
  job: string;
}

export interface ReminderItem {
  id: string;
  chat_id?: string;
  context_id?: string;
  message: string;
  remind_at: string;
}

export interface WorkspaceDoc {
  id: string;
  context_id: string;
  key: string;
  content: string;
}

export interface ExtractedEvent {
  message: string;
  date_iso?: string;
  cron?: string;
}

export interface StalledAction {
  chatId: string;
  type: string;
  goal?: string;
}

export interface MissedWake {
  chatId: string;
  prompt: string;
}

export interface GoalItem {
  id: string;
  title: string;
  description: string;
  priority: number | string;
  target_chat_id?: string;
}

export type SchedulerMessageHandler = ((event: BotEvent) => Promise<unknown>) | null;

function getRandomFloat(): number {
  return randomBytes(4).readUInt32BE(0) / 0xffffffff;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    typeof err.message === 'string'
  ) {
    return err.message;
  }
  return String(err);
}

/**
 * Gestionnaire des jobs planifiés
 */
export class SchedulerHandler {
  transport: SchedulerTransport | null;
  messageHandler: SchedulerMessageHandler;

  constructor(
    transport: SchedulerTransport | null = null,
    messageHandler: SchedulerMessageHandler = null,
  ) {
    this.transport = transport;
    this.messageHandler = messageHandler;
  }

  /**
   * Définit le handler de message (pour les jobs qui génèrent des messages)
   */
  setMessageHandler(handler: SchedulerMessageHandler) {
    this.messageHandler = handler;
  }

  /**
   * Exécute un job planifié
   * @param {SchedulerJobEvent} event - Événement du scheduler
   */
  async handleJob(event: SchedulerJobEvent) {
    console.log(`[Scheduler] Exécution job: ${event.job}`);

    switch (event.job) {
      case 'dailyGreeting':
        await this._handleDailyGreeting();
        break;

      case 'spontaneousReflection':
        await this._handleSpontaneousReflection();
        break;

      case 'reminderCheck':
        await this._handleReminderCheck();
        break;

      case 'memoryConsolidation':
        await this._handleMemoryConsolidation();
        break;

      case 'cognitiveDream':
        await this._handleCognitiveDream();
        break;

      case 'memoryCleanup':
        await this._handleMemoryCleanup();
        break;

      case 'memoryDecay':
        await this._handleMemoryDecay();
        break;

      case 'memoryEventScanner':
        await this._handleMemoryEventScanner();
        break;

      case 'tempCleanup':
        await this._handleTempCleanup();
        break;

      case 'socialCueScan':
        await this._handleSocialCueScan();
        break;

      case 'goalExecution':
        await this._handleGoalExecution();
        break;

      // 🛡️ PHASE 3: Jobs de monitoring DB
      case 'dbHealthCheck':
        await this._handleDBHealthCheck();
        break;

      case 'dbPerformanceAnalysis':
        await this._handleDBPerformanceAnalysis();
        break;

      case 'dbWeeklyReport':
        await this._handleDBWeeklyReport();
        break;

      case 'dbCleanup':
        await this._handleDBCleanup();
        break;

      case 'consciousPulse':
        await this._handleConsciousPulse();
        break;

      default:
        console.warn(`[Scheduler] Job inconnu: ${event.job}`);
    }

    eventBus.publish(BotEvents.JOB_COMPLETED, { job: event.job });
  }

  async _handleDailyGreeting() {
    // Placeholder - Envoyer un message matinal aux groupes actifs
    console.log('[Scheduler] dailyGreeting - À implémenter');
  }

  async _handleSpontaneousReflection() {
    console.log('[Scheduler] 🤔 Réflexion Spontanée (Goal Seeking)...');

    const hour = new Date().getHours();
    if (hour < 9 || hour >= 22) return;

    const inactiveGroups = await workingMemory.getInactiveGroups(180);

    for (const groupId of inactiveGroups) {
      console.log(`[GoalSeeking] 💀 Groupe inactif détecté : ${groupId}`);

      if (getRandomFloat() > 0.3) continue;

      const fakeContext: MessageData = {
        isGroup: true,
        chatId: groupId,
        text: 'SYSTEM_WAKEUP_PROTOCOL: The group is inactive. Generate a thought to wake it up politely or with a controversial topic about tech/AI.',
        senderName: 'SYSTEM',
        sender: 'system@internal',
      };

      if (this.messageHandler) {
        await this.messageHandler({
          type: 'scheduled',
          chatId: groupId,
          data: fakeContext,
        });
      }
    }
  }

  async _handleReminderCheck() {
    const reminders = (await db.getPendingReminders()) as ReminderItem[];

    for (const reminder of reminders) {
      await this._processSingleReminder(reminder);
    }
  }

  private async _processSingleReminder(reminder: ReminderItem) {
    let chatId: string | undefined = reminder.chat_id;
    if (!chatId && reminder.context_id) {
      const resolved = await db.resolveLegacyIdFromContext(reminder.context_id);
      if (resolved) chatId = resolved;
    }
    if (!chatId) {
      console.error(
        `[Scheduler] ❌ Impossible de résoudre le chatId pour le rappel ${reminder.id}`,
      );
      await db.markReminderSent(reminder.id);
      return;
    }

    const { actualMessage, cronExpr } = this._parseReminderMessage(reminder.message);

    if (actualMessage.startsWith('COMMAND:BAN_USER:')) {
      await this._executeBanCommand(chatId, actualMessage);
    } else {
      if (this.transport && typeof this.transport.sendText === 'function') {
        await this.transport.sendText(chatId, `⏰ Rappel: ${actualMessage}`);
      }
    }

    if (cronExpr) {
      await this._rescheduleCronReminder(reminder.id, reminder.remind_at, cronExpr);
    } else {
      await db.markReminderSent(reminder.id);
    }
  }

  private _parseReminderMessage(message: string): {
    actualMessage: string;
    cronExpr: string | null;
  } {
    let actualMessage = message;
    let cronExpr: string | null = null;

    if (actualMessage.startsWith('[WS:')) {
      const closeIdx = actualMessage.indexOf(']');
      if (closeIdx !== -1) {
        actualMessage = actualMessage.slice(closeIdx + 1).trimStart();
      }
    }

    if (actualMessage.startsWith('[CRON:')) {
      const closeIdx = actualMessage.indexOf(']');
      if (closeIdx !== -1) {
        cronExpr = actualMessage.slice(6, closeIdx).trim();
        actualMessage = actualMessage.slice(closeIdx + 1).trimStart();
      }
    }

    return { actualMessage, cronExpr };
  }

  private async _executeBanCommand(chatId: string, actualMessage: string) {
    try {
      const payload = actualMessage.replace('COMMAND:BAN_USER:', '');
      const [targetJid, reason] = payload.split('|');

      console.log(`[Scheduler] 🚀 Exécution BAN planifié pour ${targetJid}`);
      if (this.transport && typeof this.transport.banUser === 'function') {
        await this.transport.banUser(chatId, targetJid);
      }

      if (this.transport && typeof this.transport.sendText === 'function') {
        await this.transport.sendText(
          chatId,
          `🚫 **Ban planifié exécuté**\nUtilisateur: @${targetJid.split('@')[0]}\nRaison: ${reason || 'Aucune'}`,
        );
      }
    } catch (err: unknown) {
      const errMsg = getErrorMessage(err);
      console.error(`[Scheduler] ❌ Erreur exécution BAN planifié: ${errMsg}`);
      if (this.transport && typeof this.transport.sendText === 'function') {
        await this.transport.sendText(chatId, `⚠️ Échec du ban planifié: ${errMsg}`);
      }
    }
  }

  private async _rescheduleCronReminder(reminderId: string, remindAt: string, cronExpr: string) {
    try {
      const parser = cronParser as unknown as {
        parseExpression(
          expr: string,
          opts?: unknown,
        ): { next(): { toDate(): Date; toISOString(): string } };
      };
      const interval = parser.parseExpression(cronExpr, {
        currentDate: new Date(remindAt),
      });
      const nextDate = interval.next().toDate();
      await db.rescheduleReminder(reminderId, nextDate);
      console.log(`[Scheduler] 🔄 Rappel récurrent reprogrammé pour: ${nextDate.toISOString()}`);
    } catch (err: unknown) {
      console.error(
        '[Scheduler] Erreur reprogrammation cron (%s):',
        cronExpr,
        getErrorMessage(err),
      );
      await db.markReminderSent(reminderId);
    }
  }

  async _handleMemoryConsolidation() {
    console.log('[Scheduler] 🧶 Consolidation de la mémoire et Tissage du savoir...');
    try {
      const keys = await redis.keys('chat:*:context');
      const chatIds = keys.map((k: string) => k.split(':')[1]);

      if (chatIds.length === 0) {
        console.log('[Scheduler] Aucun chat actif à consolider.');
        return;
      }

      console.log(`[Scheduler] Consolidation de ${chatIds.length} chats...`);
      const consolidationService = container.get<{ consolidate(chatId: string): Promise<void> }>(
        'consolidationService',
      );

      for (const chatId of chatIds) {
        consolidationService
          .consolidate(chatId)
          .catch((err: unknown) =>
            console.error('[Scheduler] Erreur consolidation %s:', chatId, getErrorMessage(err)),
          );
      }
    } catch (e: unknown) {
      console.error('[Scheduler] Erreur globale consolidation:', getErrorMessage(e));
    }
  }

  async _handleCognitiveDream() {
    console.log('[Scheduler] 💤 Le bot entre en phase de rêve (Auto-Reflection)...');
    try {
      const dreamService = container.get<{ dream(): Promise<void> }>('dream');
      if (dreamService) {
        await dreamService.dream();
      }
    } catch (e: unknown) {
      console.error('[Scheduler] Erreur pendant le rêve:', getErrorMessage(e));
    }
  }

  async _handleMemoryCleanup() {
    console.log('[Scheduler] 🧹 Nettoyage mémoire sémantique...');
    try {
      const { supabase } = await import('../../services/supabase.js');
      const { data: heavyChats } = supabase
        ? await supabase.from('semantic_memory').select('chat_id').limit(100)
        : { data: [] as { chat_id: string }[] };

      if (heavyChats && heavyChats.length > 0) {
        const uniqueChatIds = [...new Set(heavyChats.map((m: { chat_id: string }) => m.chat_id))];
        console.log(`[Scheduler] ${uniqueChatIds.length} chat(s) à nettoyer`);

        const memory = container.get<{ cleanup(chatId: string, limit: number): Promise<void> }>(
          'memory',
        );
        await Promise.all(uniqueChatIds.map((chatId) => memory.cleanup(chatId, 100)));
      }
      console.log('[Scheduler] ✅ Nettoyage mémoire terminé');
    } catch (error: unknown) {
      console.error('[Scheduler] Erreur memoryCleanup:', getErrorMessage(error));
    }
  }

  async _handleMemoryEventScanner() {
    console.log(
      '[Scheduler] 📅 Scan de la mémoire épistémique (agent_workspace) pour extraction de rappels...',
    );
    try {
      const { supabase } = await import('../../services/supabase.js');
      if (!supabase) {
        console.warn('[Scheduler] ⚠️ Supabase not available for epistemic scan');
        return;
      }

      const targetTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: workspaces, error } = await supabase
        .from('agent_workspace')
        .select('id, context_id, key, content')
        .gte('updated_at', targetTime);

      if (error) throw error;
      if (!workspaces || workspaces.length === 0) {
        console.log('[Scheduler] Aucun document workspace récent à analyser.');
        return;
      }

      let extractedCount = 0;
      for (const doc of workspaces as WorkspaceDoc[]) {
        extractedCount += await this._analyzeWorkspaceDoc(doc, supabase);
      }

      console.log(`[Scheduler] Fin du scan. ${extractedCount} nouveau(x) rappel(s) créé(s).`);
    } catch (error: unknown) {
      console.error('[Scheduler] Erreur memoryEventScanner:', getErrorMessage(error));
    }
  }

  private async _analyzeWorkspaceDoc(doc: WorkspaceDoc, supabaseClient: unknown): Promise<number> {
    const { providerRouter } = await import('../../providers/index.js');
    const textToAnalyze = doc.content.substring(0, 2000);

    const prompt = `
You are a strict calendar extraction agent. Analyze the following workspace document and extract ONLY explicitly mentioned appointments, reminders, or future actions.
Strict rules:
1. If the event is ONE-TIME (e.g. "tomorrow at 3pm"), set "date_iso" with the exact date and leave "cron" empty.
2. If the event is RECURRING (e.g. "every Tuesday the 12th", "every Friday at 1pm"), set "cron" with a valid cron expression and leave "date_iso" empty.
Format de retour strictement JSON sans markdown (pas de balises \`\`\`json) :
[
  { "message": "Texte complet du rappel ou de la tâche", "date_iso": "2026-05-10T15:00:00.000Z", "cron": "0 13 * * 5" }
]
Si aucun événement futur n'est trouvé, renvoie exactement [].
Date et Heure actuelles: ${new Date().toISOString()}

Document [Clé: ${doc.key}]:
${textToAnalyze}
`;

    const response = await providerRouter.chat([{ role: 'user', content: prompt }], {
      category: 'FAST_CHAT',
      temperature: 0.1,
    });

    if (!response?.content) return 0;
    return this._parseAndStoreWorkspaceEvents(doc, response.content, supabaseClient);
  }

  private async _parseAndStoreWorkspaceEvents(
    doc: WorkspaceDoc,
    rawContent: string,
    supabaseClient: unknown,
  ): Promise<number> {
    try {
      const jsonStr = rawContent.replace(/```json\n?|\n?```/g, '').trim();
      let events: ExtractedEvent[] = [];
      try {
        const json5 = (await import('json5')).default;
        events = json5.parse(jsonStr);
      } catch {
        events = JSON.parse(jsonStr);
      }

      if (!Array.isArray(events) || events.length === 0) return 0;

      const client = supabaseClient as {
        from(table: string): {
          delete(): {
            eq(
              colName: string,
              val1: unknown,
            ): {
              like(
                patternCol: string,
                patternVal: string,
              ): {
                eq(flagCol: string, flagVal: boolean): Promise<unknown>;
              };
            };
          };
          insert(values: unknown): Promise<unknown>;
        };
      };

      await client
        .from('reminders')
        .delete()
        .eq('context_id', doc.context_id)
        .like('message', `[WS: ${doc.key}]%`)
        .eq('sent', false);

      let created = 0;
      for (const ev of events) {
        const isCreated = await this._createReminderFromEvent(doc, ev, client);
        if (isCreated) created++;
      }
      return created;
    } catch (err: unknown) {
      console.error(
        '[Scheduler] Erreur parsing JSON pour document %s:',
        doc.key,
        getErrorMessage(err),
      );
      return 0;
    }
  }

  private async _createReminderFromEvent(
    doc: WorkspaceDoc,
    ev: ExtractedEvent,
    client: { from(table: string): { insert(values: unknown): Promise<unknown> } },
  ): Promise<boolean> {
    let targetDate = ev.date_iso;
    let finalMessage = `[WS: ${doc.key}] ${ev.message}`;

    if (ev.cron) {
      try {
        const parser = cronParser as unknown as {
          parseExpression(expr: string): { next(): { toISOString(): string } };
        };
        const interval = parser.parseExpression(ev.cron);
        targetDate = interval.next().toISOString();
        finalMessage = `[CRON: ${ev.cron}] ${ev.message}`;
      } catch {
        console.error('[Scheduler] Cron invalide ignoré:', ev.cron);
        return false;
      }
    }

    if (finalMessage && targetDate && new Date(targetDate).getTime() > Date.now()) {
      await client.from('reminders').insert({
        context_id: doc.context_id,
        message: finalMessage,
        remind_at: targetDate,
        sent: false,
      });
      console.log(`[Scheduler] ✅ Rappel créé: "${finalMessage}" pour ${targetDate}`);
      return true;
    }
    return false;
  }

  async _handleTempCleanup() {
    console.log('[Scheduler] 🧹 Nettoyage fichiers temporaires...');
    try {
      const { CleanupService } = await import('../../services/cleanup.js');
      const cleanup = new CleanupService();
      await cleanup.run();
    } catch (err: unknown) {
      console.error('[Scheduler] Erreur tempCleanup:', getErrorMessage(err));
    }
  }

  async _handleSocialCueScan() {
    console.log('[Scheduler] 👀 Scan des signaux sociaux...');
    try {
      const { socialCueWatcher } = await import('../../services/socialCueWatcher.js');
      const activeGroups = await workingMemory.getActiveGroups();

      for (const groupId of activeGroups) {
        const signal = await socialCueWatcher.scanGroup(groupId);
        if (signal && signal.shouldIntervene) {
          console.log(`[SocialCue] 🚨 Intervention détectée pour ${groupId}: ${signal.reason}`);
          eventBus.publish(BotEvents.PROACTIVE_TRIGGER, {
            chatId: groupId,
            reason: signal.reason,
            context: signal.context,
          });
        }
      }
    } catch (e: unknown) {
      console.error('[Scheduler] Erreur socialCueScan:', getErrorMessage(e));
    }
  }

  async _handleGoalExecution() {
    console.log('[Scheduler] 🎯 Vérification des objectifs autonomes...');
    try {
      const { goalsService } = await import('../../services/goalsService.js');
      const dueGoals = (await goalsService.getDueGoals()) as unknown as GoalItem[];

      for (const goal of dueGoals) {
        console.log(`[Goals] 🎯 Activation objectif: ${goal.title}`);

        await goalsService.markInProgress(goal.id);

        if (this.messageHandler) {
          const fakeContext: MessageData = {
            isGroup: goal.target_chat_id ? goal.target_chat_id.endsWith('@g.us') : false,
            chatId: goal.target_chat_id || 'system',
            text: `SYSTEM_GOAL_TRIGGER: L'heure est venue d'exécuter l'objectif "${goal.title}".\nConsigne: ${goal.description}\nPriorité: ${goal.priority}`,
            senderName: 'SYSTEM_SCHEDULER',
            sender: 'system@internal',
            systemContext: 'true',
          };
          await this.messageHandler({
            type: 'scheduled',
            chatId: goal.target_chat_id,
            data: fakeContext,
          });
          console.log(`[Goals] ✅ Trigger envoyé pour ${goal.id}`);
        } else {
          console.error(
            "[Goals] ❌ Impossible d'exécuter: messageHandler non défini dans Scheduler",
          );
        }
      }
    } catch (e: unknown) {
      console.error('[Scheduler] Erreur goalExecution:', getErrorMessage(e));
    }
  }

  async _handleMemoryDecay() {
    console.log('[Scheduler] 🧹💾 Cycle de décroissance mémoire...');
    try {
      const { memoryDecay } = await import('../../services/memory/MemoryDecay.js');
      const result = await memoryDecay.decayAll();

      console.log(
        `[Scheduler] ✅ Decay: ${result.archived} souvenirs archivés, ${result.kept} conservés dans ${result.chats} chats`,
      );
    } catch (e: unknown) {
      console.error('[Scheduler] Erreur memoryDecay:', getErrorMessage(e));
    }
  }

  // 🛡️ PHASE 3: Jobs de monitoring DB (Audit #21)

  async _handleDBHealthCheck() {
    console.log('[Scheduler] 🏥 Exécution DB Health Check...');
    try {
      const { monitorDatabaseHealth } = await import('../../scheduler/dbMonitoring.js');
      await monitorDatabaseHealth();
    } catch (e: unknown) {
      console.error('[Scheduler] Erreur dbHealthCheck:', getErrorMessage(e));
    }
  }

  async _handleDBPerformanceAnalysis() {
    console.log('[Scheduler] 📊 Exécution DB Performance Analysis...');
    try {
      const { analyzePerformance } = await import('../../scheduler/dbMonitoring.js');
      await analyzePerformance();
    } catch (e: unknown) {
      console.error('[Scheduler] Erreur dbPerformanceAnalysis:', getErrorMessage(e));
    }
  }

  async _handleDBWeeklyReport() {
    console.log('[Scheduler] 📋 Génération Rapport Hebdomadaire DB...');
    try {
      const { generateWeeklyReport } = await import('../../scheduler/dbMonitoring.js');
      await generateWeeklyReport();
    } catch (e: unknown) {
      console.error('[Scheduler] Erreur dbWeeklyReport:', getErrorMessage(e));
    }
  }

  async _handleDBCleanup() {
    console.log('[Scheduler] 🧹 Exécution DB Cleanup (Audit #16)...');
    try {
      const { cleanupOldData } = await import('../../scheduler/dbMonitoring.js');
      await cleanupOldData();
    } catch (e: unknown) {
      console.error('[Scheduler] Erreur dbCleanup:', getErrorMessage(e));
    }
  }

  async _handleConsciousPulse() {
    console.log('[Watchdog] 💓 Audit système (Inbox, Crash Recovery, WakeEvents, MAPLE)...');
    try {
      await this._scanMapleInactive();
      await this._scanMindosDrives();

      let unreadEvents = await eventInboxService.getUnreadEvents(10);
      unreadEvents = await this._processLearningEvents(unreadEvents);

      const stalledActions = await this._processStalledActions();
      const missedWakes = (await hiveWakeSystem.getMissedWakes()) as MissedWake[];

      if (unreadEvents.length === 0 && stalledActions.length === 0 && missedWakes.length === 0) {
        return;
      }

      console.log(
        `[Watchdog] ⚠️ Réveil requis : ${unreadEvents.length} events, ${stalledActions.length} crashs, ${missedWakes.length} réveils.`,
      );

      const wakeupPrompt = this._buildWakeupPrompt(unreadEvents, stalledActions, missedWakes);

      if (this.messageHandler) {
        const fakeContext: MessageData = {
          isGroup: false,
          chatId: 'system_internal_mind',
          text: wakeupPrompt,
          senderName: 'SYSTEM_WATCHDOG',
          sender: 'system@internal',
          sourceChannel: 'internal',
        };
        await this.messageHandler({
          type: 'scheduled',
          chatId: 'system_internal_mind',
          data: fakeContext,
        });
      }
    } catch (e: unknown) {
      console.error('[Scheduler] Erreur consciousPulse:', getErrorMessage(e));
    }
  }

  private async _scanMapleInactive() {
    try {
      const inactiveGroups = await workingMemory.getInactiveGroups(15);
      for (const chatId of inactiveGroups) {
        const lockKey = `maple_lock:${chatId}`;
        if (redis.isOpen && !(await redis.get(lockKey))) {
          await eventInboxService.pushEvent('trigger_learning', 'watchdog', { chatId });
          await redis.set(lockKey, '1', { EX: 3600 });
        }
      }
    } catch (err: unknown) {
      console.error('[Watchdog] Erreur scan MAPLE inactifs:', getErrorMessage(err));
    }
  }

  private async _scanMindosDrives() {
    try {
      const { driverSystem } = await import('../../services/mindos/DriverSystem.js');
      const activeChats = await workingMemory.getActiveGroups(120);
      for (const chatId of activeChats) {
        await driverSystem.evaluateDrives(chatId, 'hive_main');
      }
    } catch (err: unknown) {
      console.error('[Watchdog] Erreur évaluation MindOS Drives:', getErrorMessage(err));
    }
  }

  private async _processLearningEvents(unreadEvents: SystemEvent[]): Promise<SystemEvent[]> {
    const learningEvents = unreadEvents.filter((e) => e.type === 'trigger_learning');

    // 1. Process learning events (extract insights)
    if (learningEvents.length > 0) {
      try {
        const { learningEngine } = await import('../../services/learning/LearningEngine.js');
        for (const evt of learningEvents) {
          const payload = evt.payload;
          const chatId =
            typeof payload === 'object' && payload !== null && 'chatId' in payload
              ? String(payload.chatId)
              : undefined;
          if (chatId) {
            learningEngine.extractInsights(chatId).catch((err: unknown) => {
              console.error('[Watchdog] learningEngine error:', getErrorMessage(err));
            });
          }
        }
      } catch (err: unknown) {
        console.error('[Watchdog] Erreur traitement evenements MAPLE:', getErrorMessage(err));
      }
    }

    // 2. Remove ALL processed events from inbox to prevent accumulation
    if (redis.isOpen) {
      for (const evt of unreadEvents) {
        await redis.lRem('hive:event_inbox', 0, JSON.stringify(evt));
      }
    }

    return await eventInboxService.getUnreadEvents(10);
  }

  private async _processStalledActions(): Promise<StalledAction[]> {
    const stalledActions = (await actionMemory.getStalledActions(
      5 * 60 * 1000,
    )) as unknown as StalledAction[];
    for (const action of stalledActions) {
      console.log(`[Watchdog] 🧟 Zombie détecté : ${action.type} (Chat: ${action.chatId})`);
      await actionMemory.interruptAction(
        action.chatId,
        'TIMEOUT: Action stalled for more than 5 minutes.',
      );

      if (this.transport && typeof this.transport.sendText === 'function') {
        await this.transport.sendText(
          action.chatId,
          `⚠️ **Action Interrompue** : L'action \`${action.type}\` a été stoppée car elle ne répondait plus depuis 5 minutes.`,
        );
      }
    }
    return stalledActions;
  }

  private _buildWakeupPrompt(
    unreadEvents: SystemEvent[],
    stalledActions: StalledAction[],
    missedWakes: MissedWake[],
  ): string {
    let wakeupPrompt =
      '[SYSTEM WATCHDOG & RECOVERY PROTOCOL]\nTu as été réveillé par le Heartbeat du système.\n\n';

    if (unreadEvents.length > 0) {
      wakeupPrompt += `📥 NOUVEAUX ÉVÉNEMENTS:\nTu as ${unreadEvents.length} événements dans ton Inbox. Utilise l'outil \`read_event_inbox\` pour les lire, traite-les, puis utilise \`clear_event_inbox\`.\n\n`;
    }

    if (missedWakes.length > 0) {
      wakeupPrompt += '⏰ RAPPELS / TÂCHES DE FOND (WakeSystem):\n';
      missedWakes.forEach((w) => {
        wakeupPrompt += `- Contexte/Chat: ${w.chatId} | Consigne: "${w.prompt}"\n`;
      });
      wakeupPrompt +=
        "Exécute ces consignes maintenant (utilise send_message pour notifier l'utilisateur concerné si nécessaire).\n\n";
    }

    if (stalledActions.length > 0) {
      wakeupPrompt += '🚨 TÂCHES INTERROMPUES (CRASH RECOVERY):\n';
      stalledActions.forEach((a) => {
        wakeupPrompt += `- Chat: ${a.chatId} | Outil: ${a.type} | Objectif: "${a.goal}"\n`;
      });
      wakeupPrompt +=
        "Il semble que tu aies crashé pendant ces tâches. Analyse la situation et reprends l'exécution si possible.\n\n";
    }

    wakeupPrompt +=
      'DIRECTIVE: Gère cette file d\'attente. Une fois terminé ou si tu n\'as rien de concret à faire, réponds UNIQUEMENT par le token "__HIVE_SILENT_7f3a__" pour te rendormir silencieusement.';

    return wakeupPrompt;
  }
}

export default SchedulerHandler;
