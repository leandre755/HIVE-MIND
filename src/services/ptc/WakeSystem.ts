/**
 * WakeSystem — Moteur de tâches longue durée pour HIVE-MIND
 *
 * WHY: Résoudre le problème fondamental des agents IA : les LLMs ont un timeout
 * de 90s maximum par requête, mais certaines tâches (compilation, scraping, analyse)
 * prennent des heures. Les LLMs ne peuvent pas "boucler" en attendant.
 *
 * SOLUTION (inspirée d'OpenClaw's Heartbeat + Cron pattern) :
 * Au lieu de bloquer la boucle LLM en attendant, le script PTC enregistre une tâche
 * "Wake Event" via `HIVE.sleepAndWake()`. Le ProgrammaticExecutor termine immédiatement,
 * libère le round-trip LLM, et le WakeSystem relance le pipeline agentique
 * automatiquement quand le délai est écoulé ou quand la condition est remplie.
 *
 * ARCHITECTURE:
 *   - WakeEvent : une tâche planifiée avec un délai + un contexte de réveil
 *   - WakeCallback : la fonction que l'appelant (CoreHandler) enregistre pour être
 *                    réveillé quand l'event est prêt
 *   - Heartbeat : polling léger (toutes les X sec) qui vérifie les events expirés
 */

import { EventEmitter } from 'node:events';
import { redis, ensureConnected } from '../redisClient.js';

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes } from 'crypto';

export interface WakeEvent {
  readonly id: string;
  readonly chatId: string;
  readonly wakeAtMs: number; // Timestamp Unix (ms) de réveil
  readonly prompt: string; // Message de rappel à injecter dans la boucle
  readonly createdAtMs: number;
  readonly backgroundCommandId?: string; // ID d'un process lancé en background (optionnel)
  readonly checkEveryMs?: number; // Pour le polling récurrent (optionnel)
}

/**
 * Ce que le WakeSystem rend disponible dans le sandbox PTC via l'objet `HIVE`.
 */
export interface HiveWakeBridge {
  /**
   * Suspend l'exécution LLM et programme un réveil automatique.
   * @param delayMs — Délai avant réveil (en millisecondes)
   * @param wakePrompt — Texte injecté dans le pipeline quand l'agent se réveille
   * @returns Un objet indiquant que le wake event a été enregistré
   */
  sleepAndWake(delayMs: number, wakePrompt: string): Promise<SleepResult>;

  /**
   * Lance une commande shell en arrière-plan et programme un réveil quand elle finit.
   * L'agent se libère immédiatement sans attendre la fin de la commande.
   * @param commandId — ID d'un `exec` background déjà lancé
   * @param checkEveryMs — Fréquence de vérification du statut (défaut: 10s)
   * @param wakePrompt — Texte injecté dans le pipeline quand la commande se termine
   */
  waitForBackground(
    commandId: string,
    checkEveryMs: number,
    wakePrompt: string,
  ): Promise<SleepResult>;
}

export interface SleepResult {
  readonly type: 'SLEEP_SCHEDULED' | 'SLEEP_ERROR';
  readonly wakeEventId: string;
  readonly wakeAtMs: number;
  readonly message: string;
}

export type WakeCallback = (event: WakeEvent) => Promise<void>;

// ─────────────────────────────────────────────────────────────────────────────
// WAKE SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

export class HiveWakeSystem extends EventEmitter {
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly heartbeatIntervalMs: number;
  private wakeCallbacks = new Map<string, WakeCallback>();

  /**
   * @param heartbeatIntervalMs — Fréquence du heartbeat interne (défaut: 5 secondes)
   */
  constructor(heartbeatIntervalMs = 5_000) {
    super();
    this.heartbeatIntervalMs = heartbeatIntervalMs;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Démarre la boucle heartbeat interne.
   * À appeler au démarrage de HIVE-MIND (une seule fois).
   */
  start(): void {
    if (this.heartbeatInterval) {
      return; // Déjà démarré
    }
    this.heartbeatInterval = setInterval(() => {
      this.tick().catch((err) => console.error('[WakeSystem] Heartbeat tick failed:', err));
    }, this.heartbeatIntervalMs);
    console.log(`[WakeSystem] ✅ Heartbeat démarré (intervalle: ${this.heartbeatIntervalMs}ms)`);
  }

  /**
   * Arrête proprement la boucle heartbeat.
   */
  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log('[WakeSystem] 🛑 Heartbeat arrêté');
    }
  }

  /**
   * Enregistre un Wake Event. Retourne son ID.
   * Utilisé par le script PTC via l'API `HIVE.sleepAndWake()`.
   */
  async scheduleWake(
    chatId: string,
    delayMs: number,
    prompt: string,
    backgroundCommandId?: string,
    checkEveryMs?: number,
  ): Promise<SleepResult> {
    const id = `wake_${Date.now()}_${randomBytes(3).toString('hex')}`;
    const now = Date.now();
    const wakeAtMs = now + delayMs;

    const event: WakeEvent = {
      id,
      chatId,
      wakeAtMs,
      prompt,
      createdAtMs: now,
      backgroundCommandId,
      checkEveryMs,
    };

    await ensureConnected();
    if (redis.isOpen) {
      await redis.hSet('hive:wake_events', id, JSON.stringify(event));
      console.log(
        `[WakeSystem] 📅 Wake Event programmé (Redis): id=${id}, chatId=${chatId}, ` +
          `dans ${Math.round(delayMs / 1000)}s, prompt="${prompt.slice(0, 60)}..."`,
      );
    } else {
      console.error('[WakeSystem] Redis not open. Wake event scheduling failed.');
    }

    return {
      type: 'SLEEP_SCHEDULED',
      wakeEventId: id,
      wakeAtMs,
      message: `Wake event enregistré dans la DB. Réveil dans ${Math.round(delayMs / 1000)}s.`,
    };
  }

  /**
   * Retrieves wake events that have passed their wake time, deleting them from Redis.
   */
  async getMissedWakes(): Promise<WakeEvent[]> {
    await ensureConnected();
    if (!redis.isOpen) return [];
    const eventsObj = await redis.hGetAll('hive:wake_events');
    const now = Date.now();
    const missed: WakeEvent[] = [];

    for (const [id, eventStr] of Object.entries(eventsObj)) {
      try {
        const event = JSON.parse(eventStr) as WakeEvent;
        if (event.wakeAtMs <= now) {
          missed.push(event);
          await redis.hDel('hive:wake_events', id);
        }
      } catch (e: unknown) {
        console.error(
          '[WakeSystem] Error parsing wake event:',
          e instanceof Error ? e.message : String(e),
        );
        await redis.hDel('hive:wake_events', id); // Clean invalid data
      }
    }
    return missed;
  }

  /**
   * Enregistre un callback appelé quand un wake event est prêt pour un chatId donné.
   * Le CoreHandler (core/index.ts) doit appeler cette méthode au démarrage.
   */
  registerWakeCallback(chatId: string, callback: WakeCallback): void {
    this.wakeCallbacks.set(chatId, callback);
  }

  /**
   * Construit le bridge `HIVE` injecté dans le sandbox VM du PTC.
   * @param chatId — Conversation courante, pour associer le wake event au bon canal
   */
  buildHiveBridge(chatId: string): HiveWakeBridge {
    return {
      sleepAndWake: async (delayMs: number, wakePrompt: string): Promise<SleepResult> => {
        if (!Number.isFinite(delayMs) || delayMs < 0) {
          return {
            type: 'SLEEP_ERROR',
            wakeEventId: '',
            wakeAtMs: 0,
            message: `[HIVE.sleepAndWake] Erreur: delayMs doit être un nombre positif (reçu: ${delayMs})`,
          };
        }
        if (!wakePrompt || typeof wakePrompt !== 'string') {
          return {
            type: 'SLEEP_ERROR',
            wakeEventId: '',
            wakeAtMs: 0,
            message: '[HIVE.sleepAndWake] Erreur: wakePrompt est obligatoire',
          };
        }
        // Plafonner à 24h pour éviter les oublis
        const clampedDelay = Math.min(delayMs, 24 * 60 * 60 * 1000);
        return await this.scheduleWake(chatId, clampedDelay, wakePrompt);
      },

      waitForBackground: async (
        commandId: string,
        checkEveryMs: number = 10_000,
        wakePrompt: string,
      ): Promise<SleepResult> => {
        // Programme un premier check après checkEveryMs.
        // Le tick() vérifiera le commandId et re-planifiera si toujours en cours.
        const clampedInterval = Math.max(checkEveryMs, 3_000); // Min 3s
        return await this.scheduleWake(
          chatId,
          clampedInterval,
          wakePrompt,
          commandId,
          clampedInterval,
        );
      },
    };
  }

  /**
   * Retourne le nombre de wake events en attente (legacy getter).
   */
  get pendingCount(): number {
    return 0;
  }

  /**
   * Retourne le nombre de wake events en attente depuis Redis.
   */
  async getPendingCount(): Promise<number> {
    await ensureConnected();
    if (!redis.isOpen) return 0;
    return await redis.hLen('hive:wake_events');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE — Heartbeat loop
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Tick du heartbeat. Appelé toutes les `heartbeatIntervalMs` ms.
   * Vérifie les events expirés et les dispatch aux callbacks enregistrés.
   */
  private async tick(): Promise<void> {
    await ensureConnected();
    if (!redis.isOpen) return;

    const missed = await this.getMissedWakes();
    for (const event of missed) {
      this.fireWakeEvent(event);
    }
  }

  /**
   * Dispatch un wake event : appelle le callback enregistré pour ce chatId,
   * ou émet un event générique si aucun callback n'est enregistré.
   */
  private fireWakeEvent(event: WakeEvent): void {
    console.log(
      `[WakeSystem] ⏰ Réveil: chatId=${event.chatId}, id=${event.id}, prompt="${event.prompt.slice(0, 60)}..."`,
    );

    const callback = this.wakeCallbacks.get(event.chatId);
    if (callback) {
      callback(event).catch((err: Error) => {
        console.error('[WakeSystem] ❌ Erreur callback wake pour %s:', event.chatId, err.message);
      });
    } else {
      // Fallback : émettre un event Node.js pour que le CoreHandler puisse écouter
      // via wakeSystem.on('wake', handler) si le chatId n'est pas encore enregistré
      this.emit('wake', event);
    }
  }
}

// Export singleton global
export const hiveWakeSystem = new HiveWakeSystem(5_000);
export default hiveWakeSystem;
