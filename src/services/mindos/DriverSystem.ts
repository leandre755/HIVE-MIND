// services/mindos/DriverSystem.ts
// Service autonome de motivation (MindOS DriverSystem)
// Gère l'évaluation périodique des drives des blueprints d'agent et déclenche des pensées spontanées.

import { redis, ensureConnected } from '../redisClient.js';
import { blueprintManager } from '../../core/blueprint/AgentBlueprint.js';
import { workingMemory } from '../workingMemory.js';
import { eventInboxService } from '../events/EventInboxService.js';

export class DriverSystem {
  /**
   * Évalue les drives pour un chatId donné et déclenche un événement autonome si les conditions sont remplies.
   * Preserves invariant: triggers at most one spontaneous thought per chatId per hour, only if chat is calm.
   *
   * @param chatId Identifiant unique de la conversation
   * @param blueprintId Identifiant du blueprint à charger (défaut 'hive_main')
   * @returns boolean true si une action a été déclenchée, false sinon
   */
  async evaluateDrives(chatId: string, blueprintId: string = 'hive_main'): Promise<boolean> {
    try {
      await ensureConnected();
      if (!redis.isOpen) {
        console.warn('[DriverSystem] Redis is not open, skipping drives evaluation.');
        return false;
      }

      // 1. Charger le blueprint
      let blueprint;
      try {
        blueprint = blueprintManager.loadBlueprint(blueprintId);
      } catch (err: unknown) {
        console.error(
          '[DriverSystem] Failed to load blueprint "%s":',
          blueprintId,
          err instanceof Error ? err.message : String(err),
        );
        return false;
      }

      const drives = blueprint.mindos?.drives;
      if (!drives || drives.length === 0) {
        return false;
      }

      // 2. Vérifier le verrou (lock) pour ce canal
      const lockKey = `driver_lock:${chatId}`;
      const hasLock = await redis.get(lockKey);
      if (hasLock) {
        return false;
      }

      // 3. Vérifier la vélocité de la conversation
      const { velocity, mode } = await workingMemory.getChatVelocity(chatId);
      const isCalm = mode === 'calm' && velocity === 0;
      if (!isCalm) {
        return false;
      }

      // 4. Poser le verrou Redis pour 1 heure (3600 secondes)
      await redis.set(lockKey, '1', { EX: 3600 });

      // 5. Sélectionner un drive de manière équitable (round-robin persistant)
      const lastIndexKey = `driver_last_index:${chatId}`;
      const lastIndexStr = await redis.get(lastIndexKey);
      let index = 0;
      if (lastIndexStr !== null) {
        index = (parseInt(lastIndexStr, 10) + 1) % drives.length;
      }
      await redis.set(lastIndexKey, index.toString(), { EX: 86400 * 7 }); // Persiste 7 jours

      const selectedDrive = drives.at(index) ?? drives[0];
      console.log(`[DriverSystem] 🧠 Drive autonome déclenché pour ${chatId} : "${selectedDrive}"`);

      // 6. Pousser l'événement de pensée spontanée dans l'EventInbox
      await eventInboxService.pushEvent('spontaneous_thought', 'driver_system', {
        chatId,
        drive: selectedDrive,
        prompt: `SYSTEM_PROACTIVE_DRIVE: Tu es motivé de manière autonome par ton drive : "${selectedDrive}". Génère une réflexion ou une suggestion pertinente pour ce canal de discussion.`,
      });

      return true;
    } catch (error: unknown) {
      console.error(
        '[DriverSystem] Error in evaluateDrives:',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }
}

export const driverSystem = new DriverSystem();
export default driverSystem;
