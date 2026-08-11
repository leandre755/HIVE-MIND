// scheduler/index.js
// Gestionnaire de tâches planifiées (Cron) pour le mode proactif

import { validate, schedule, ScheduledTask } from 'node-cron';
import { safeReadFileSync } from '../utils/safeFs.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { orchestrator } from '../core/orchestrator.js';
import { eventBus, BotEvents } from '../core/events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface JobConfig {
  name: string;
  cron: string;
  target: string;
  enabled: boolean;
  description?: string;
}

interface SchedulerConfigJson {
  enabled: boolean;
  timezone?: string;
  jobs?: JobConfig[];
  triggers?: Record<string, unknown>;
}

// Charger la config
let schedulerConfig: SchedulerConfigJson;
try {
  schedulerConfig = JSON.parse(
    safeReadFileSync(join(__dirname, '..', 'config', 'scheduler.json'), 'utf-8'),
  ) as SchedulerConfigJson;
} catch {
  console.warn('⚠️ scheduler.json non trouvé, mode proactif désactivé');
  schedulerConfig = { enabled: false, jobs: [] };
}

class Scheduler {
  jobs: Map<string, { task: ScheduledTask; config: JobConfig }>;
  isRunning: boolean;

  constructor() {
    this.jobs = new Map();
    this.isRunning = false;
  }

  /**
   * Initialise tous les jobs configurés
   */
  init() {
    if (this.isRunning) return;
    if (!schedulerConfig.enabled) {
      // Scheduler désactivé silencieusement
      return;
    }

    // Initialisation silencieuse

    for (const jobConfig of schedulerConfig.jobs || []) {
      if (!jobConfig.enabled) continue;

      try {
        this._registerJob(jobConfig);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('❌ Erreur job %s:', jobConfig.name, errorMessage);
      }
    }

    this.isRunning = true;
    // Jobs initialisés silencieusement
  }

  /**
   * Enregistre un job Cron
   */
  _registerJob(config: JobConfig) {
    const { name, cron: cronExpr, target } = config;

    // Valide l'expression Cron
    if (!validate(cronExpr)) {
      throw new Error(`Expression cron invalide: ${cronExpr}`);
    }

    const task = schedule(
      cronExpr,
      async () => {
        console.log(`⏰ Job déclenché: ${name}`);

        eventBus.publish(BotEvents.JOB_TRIGGERED, { job: name });

        // Envoie l'événement à l'orchestrateur
        orchestrator.enqueue({
          type: 'scheduled',
          chatId: 'system',
          data: {},
          job: name,
          target,
          priority: 2, // Priorité moyenne
          timestamp: Date.now(),
        });
      },
      {
        timezone: schedulerConfig.timezone || 'Europe/Paris',
      },
    );

    this.jobs.set(name, { task, config });
    task.start();

    // Job enregistré silencieusement
  }

  /**
   * Démarre un job spécifique
   */
  start(jobName: string) {
    const job = this.jobs.get(jobName);
    if (job) {
      job.task.start();
      console.log(`▶️ Job démarré: ${jobName}`);
    }
  }

  /**
   * Arrête un job spécifique
   */
  stop(jobName: string) {
    const job = this.jobs.get(jobName);
    if (job) {
      job.task.stop();
      console.log(`⏹️ Job arrêté: ${jobName}`);
    }
  }

  /**
   * Arrête tous les jobs
   */
  stopAll() {
    for (const [, job] of this.jobs) {
      job.task.stop();
    }
    this.isRunning = false;
    console.log('⏹️ Tous les jobs arrêtés');
  }

  /**
   * Exécute un job immédiatement
   */
  async runNow(jobName: string) {
    const job = this.jobs.get(jobName);
    if (!job) {
      throw new Error(`Job inconnu: ${jobName}`);
    }

    console.log(`🚀 Exécution immédiate: ${jobName}`);

    orchestrator.enqueue({
      type: 'scheduled',
      chatId: 'system',
      data: {},
      job: jobName,
      target: job.config.target,
      priority: 1, // Haute priorité pour exécution manuelle
      timestamp: Date.now(),
    });
  }

  /**
   * Liste tous les jobs
   */
  list() {
    return Array.from(this.jobs.entries()).map(([name, job]) => ({
      name,
      cron: job.config.cron,
      description: job.config.description,
      enabled: job.config.enabled,
      nextRun: this._getNextRun(job.config.cron),
    }));
  }

  /**
   * Calcule la prochaine exécution
   */
  _getNextRun(_cronExpr: string) {
    // Simplifié - utiliser une lib comme cron-parser pour plus de précision
    return 'Voir expression cron';
  }

  /**
   * Récupère la config des triggers
   */
  getTriggers() {
    return schedulerConfig.triggers || {};
  }
}

export const scheduler = new Scheduler();
export default scheduler;
