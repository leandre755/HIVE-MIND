// core/concurrency/SwarmDispatcher.js
import os from 'os';

/**
 * SwarmDispatcher
 * Orchestrateur de tâches asynchrones (Messages) avec :
 * 1. Isolation par Clé (JID) : Les tâches d'un même JID sont sérialisées.
 * 2. Parallélisme Global : Les JIDs différents s'exécutent en parallèle.
 * 3. Observabilité : Métriques en temps réel.
 * 4. Priority Bypass : System commands skip the global queue.
 */
class SwarmDispatcher {
  private accessMap: Map<string, Promise<unknown>>;
  private globalQueue: Array<() => void>;
  private metrics: {
    activeThreads: number;
    queuedTasks: number;
    totalProcessed: number;
    errors: number;
  };

  constructor() {
    // Map<JID, Promise>
    // Garde la trace de la DERNIÈRE tâche en cours pour chaque JID
    this.accessMap = new Map();

    // File d'attente globale pour protéger la RAM (ActiveThreads > Max)
    this.globalQueue = [];

    // Métriques pour le monitoring
    this.metrics = {
      activeThreads: 0,
      queuedTasks: 0,
      totalProcessed: 0,
      errors: 0,
    };

    console.log('[Swarm] 🐝 Dispatcher Initialized');
  }

  /**
   * Calcule le nombre max de workers simultanés selon la RAM.
   * 1 Worker ~ 250MB (Contexte + Node/V8 overhead)
   */
  getMaxConcurrency(): number {
    const freeMemMB = os.freemem() / (1024 * 1024);
    const cpuCores = os.cpus().length;

    // Formule : Min(RAM, CPU*3, HardCap)
    // HardCap à 50 pour éviter l'écroulement Node
    const memoryLimit = Math.floor(freeMemMB / 250);
    const cpuLimit = cpuCores * 3;

    // Minimum 2 workers pour ne pas bloquer complètement
    return Math.max(2, Math.min(memoryLimit, cpuLimit, 50));
  }

  /**
   * Tente de dépiler une tâche globale en attente si des ressources sont dispos
   */
  _processGlobalQueue(): void {
    if (this.globalQueue.length === 0) return;

    // On vérifie D'ABORD si on a de la place
    const max = this.getMaxConcurrency();
    if (this.metrics.activeThreads < max) {
      const nextTask = this.globalQueue.shift();
      this.metrics.queuedTasks--;
      if (nextTask) {
        // On lance la tâche (résolution de la promesse d'attente)
        nextTask();
      }

      // On tente d'en lancer d'autres si possible (récursif light)
      this._processGlobalQueue();
    }
  }

  /**
   * Checks if the message is a priority system command (bypasses global queue).
   */
  isPriorityCommand(message: unknown): boolean {
    if (!message || typeof message !== 'object') return false;
    const msg = message as { text?: string; content?: string };
    const msgText = msg.text || msg.content;
    if (!msgText || typeof msgText !== 'string') return false;
    const priorityRegex = /^!(ping|menu|help|stop|info)/i;
    return priorityRegex.test(msgText);
  }

  /**
   * Wrapper d'exécution pour gérer la concurrence globale
   * @param {boolean} isPriority - Si true, bypass la limite de charge (Priority Lane)
   */
  async _executeWithThrottling(
    jid: string,
    taskId: string,
    taskFactory: () => Promise<unknown>,
    isPriority: boolean = false,
  ): Promise<unknown> {
    const max = this.getMaxConcurrency();

    // 1. Attendre les ressources globales (Global Queue)
    // [FastLane] Si prioritaire, on ignore la limite si on est le SEUL thread prioritaire (pour pas exploser non plus)
    // Mais ici on bypass simpliste : Priority = Immediate
    if (!isPriority && this.metrics.activeThreads >= max) {
      console.log(
        `[Swarm] 🟠 Throttling Task [${jid}:${taskId}] (Active: ${this.metrics.activeThreads}, Queue: ${this.globalQueue.length + 1})`,
      );
      this.metrics.queuedTasks++;

      // On crée une promesse qui ne se résout que quand _processGlobalQueue nous appelle
      await new Promise<void>((resolve) => {
        this.globalQueue.push(resolve);
      });
    } else if (isPriority && this.metrics.activeThreads >= max) {
      console.log(
        `[Swarm] ⚡ Priority Bypass for Task [${jid}:${taskId}] (Active: ${this.metrics.activeThreads} >= ${max})`,
      );
    }

    // 2. Début exécution réelle
    this.metrics.activeThreads++;
    const start = Date.now();

    try {
      console.log(
        `[Swarm] 🟢 Start Task [${jid}:${taskId}] (Active: ${this.metrics.activeThreads})`,
      );
      const result = await taskFactory();
      this.metrics.totalProcessed++;
      return result;
    } catch (error: unknown) {
      this.metrics.errors++;
      console.error('[Swarm] ❌ Error Task [%s:%s]:', jid, taskId, error);
      throw error;
    } finally {
      this.metrics.activeThreads--;
      const duration = Date.now() - start;
      console.log(`[Swarm] 🏁 End Task [${jid}:${taskId}] (${duration}ms)`);

      // 3. Libérer une place pour un autre
      this._processGlobalQueue();
    }
  }

  /**
   * Dispatch une tâche dans le Swarm.
   * @param {string} jid - Identifiant unique de conversation (Lock Key)
   * @param {object} message - Message brut (pour analyse priorité) ou Objet {id, content}
   * @param {Function} taskFactory - Factory retournant une Promise (ex: () => handleMessage())
   * @returns {Promise} - Résultat de la tâche
   */
  async dispatch(
    jid: string,
    message: unknown,
    taskFactory: () => Promise<unknown>,
  ): Promise<unknown> {
    const msg = message as { key?: { id?: string }; id?: string } | null;
    const taskId = msg?.key?.id || msg?.id || `Msg_${Date.now()}`;

    // Check priority command
    const isPriority = this.isPriorityCommand(message);

    // 1. Récupérer la dernière promesse pour ce JID (ou Resolved immédiat)
    const previousTask = this.accessMap.get(jid) || Promise.resolve();

    // 2. Créer la nouvelle tâche chaînée
    // On "attend" que la précédente finisse LOCALE (JID)
    // PUIS on lance _executeWithThrottling qui attend les ressources GLOBALES
    const currentTask = previousTask
      .catch(() => {
        console.warn(`[Swarm] ⚠️ Previous task failed for ${jid}, continuing chain.`);
      })
      .then(() => {
        return this._executeWithThrottling(jid, taskId, taskFactory, isPriority);
      })
      .finally(() => {
        // Nettoyage Map: Une fois fini, si on est toujours le dernier, on clean
        if (this.accessMap.get(jid) === currentTask) {
          this.accessMap.delete(jid);
        }
      });

    // 3. Mettre à jour la Map pour que le PROCHAIN appel attende CETTE tâche
    this.accessMap.set(jid, currentTask);

    return currentTask;
  }

  /**
   * Retourne les métriques actuelles
   */
  getMetrics() {
    return {
      ...this.metrics,
      activeJids: this.accessMap.size,
      maxConcurrency: this.getMaxConcurrency(),
    };
  }
}

// Export singleton
export default new SwarmDispatcher();
