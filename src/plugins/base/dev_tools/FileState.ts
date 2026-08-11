import { safeStatSync } from '../../../utils/safeFs.js';

/**
 * Gère l'état des fichiers lus par l'agent.
 * Permet de détecter si un fichier a été modifié par l'utilisateur
 * entre le moment où l'agent l'a lu et le moment où il tente de l'éditer.
 */
class FileStateTracker {
  private readTimestamps: Map<string, number> = new Map();

  /**
   * Enregistre le timestamp actuel d'un fichier sur le disque
   */
  recordRead(filePath: string): void {
    try {
      const stats = safeStatSync(filePath);
      this.readTimestamps.set(filePath, stats.mtimeMs);
    } catch {
      // Fichier non accessible — skipped silently
    }
  }

  /**
   * Vérifie si le fichier a été modifié depuis le dernier enregistrement
   * @returns { success: boolean, lastRead: number, current: number }
   */
  hasChanged(filePath: string): { changed: boolean; lastRead?: number; current?: number } {
    try {
      const lastRead = this.readTimestamps.get(filePath);
      if (!lastRead) return { changed: false }; // Jamais lu, on laisse passer

      const stats = safeStatSync(filePath);
      const current = stats.mtimeMs;

      return {
        changed: current > lastRead,
        lastRead,
        current,
      };
    } catch {
      return { changed: false };
    }
  }

  /**
   * Nettoie l'entrée après une écriture réussie (le bot est maintenant à jour)
   */
  clear(filePath: string): void {
    this.readTimestamps.delete(filePath);
  }
}

export const fileState = new FileStateTracker();
export default fileState;
