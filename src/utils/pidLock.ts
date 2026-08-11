/**
 * utils/pidLock.ts
 * Système de verrouillage par PID pour éviter les instances multiples
 */

import { safeExistsSync, safeReadFileSync, safeWriteFileSync, safeUnlinkSync } from './safeFs.js';
import path from 'path';

const PID_FILE = path.join(process.cwd(), '.hive-mind.pid');

function getRunningPid(filePath: string): number | undefined {
  if (!safeExistsSync(filePath)) return undefined;
  try {
    const pid = parseInt(safeReadFileSync(filePath, 'utf8'), 10);
    if (isNaN(pid)) return undefined;
    process.kill(pid, 0);
    return pid;
  } catch (e) {
    const err = e as { code?: string };
    if (err.code === 'EPERM') {
      console.error(
        '\x1b[31m[CRITICAL] Another instance is running but we lack permissions.\x1b[0m',
      );
      process.exit(1);
    }
    if (err.code !== 'ESRCH') throw e;
  }
  return undefined;
}

/**
 * Acquiert un verrou PID pour empêcher l'exécution de plusieurs instances
 * @throws {Error} Si une autre instance est déjà en cours.
 */
export function acquireLock(): void {
  const oldPid = getRunningPid(PID_FILE);
  if (oldPid) {
    console.error(
      `\x1b[31m[CRITICAL] Another instance of HIVE-MIND is already running (PID: ${oldPid}).\x1b[0m`,
    );
    console.error(
      '\x1b[31m[CRITICAL] Starting a second instance would cause WhatsApp session conflicts.\x1b[0m',
    );
    process.exit(1);
  }

  if (safeExistsSync(PID_FILE)) {
    console.log('[Startup] Found stale PID file. Cleaning up...');
  }
  safeWriteFileSync(PID_FILE, process.pid.toString());
}

/**
 * Libère le verrou PID en supprimant le fichier .pid
 */
export function releaseLock(): void {
  try {
    if (safeExistsSync(PID_FILE)) {
      const content = safeReadFileSync(PID_FILE, 'utf8');
      const currentPid = parseInt(content, 10);
      if (currentPid === process.pid) {
        safeUnlinkSync(PID_FILE);
      }
    }
  } catch {
    // Échec silencieux lors de la fermeture
  }
}

/**
 * Vérifie si un verrou existe et est valide
 */
export function isLocked(): boolean {
  if (!safeExistsSync(PID_FILE)) return false;
  try {
    const content = safeReadFileSync(PID_FILE, 'utf8');
    const oldPid = parseInt(content, 10);
    process.kill(oldPid, 0);
    return true;
  } catch {
    return false;
  }
}

export default {
  acquireLock,
  releaseLock,
  isLocked,
};
