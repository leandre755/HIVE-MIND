import {
  safeExistsSync,
  safeReaddirSync,
  safeStatSync,
  safeUnlinkSync,
  resolveWithinRoot,
} from '../utils/safeFs.js';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Stats } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class CleanupService {
  tempDir: string;
  thresholdMs: number;

  constructor() {
    this.tempDir = path.join(__dirname, '..', 'temp');
    this.thresholdMs = 60 * 60 * 1000; // 1 Hour
  }

  async run() {
    console.log('[Cleanup] 🧹 Démarrage du nettoyage temp...');
    if (!safeExistsSync(this.tempDir)) return;

    try {
      const now = Date.now();
      this._cleanRecursive(this.tempDir, now);
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[Cleanup] Erreur:', errorMessage);
    }
  }

  private _cleanFile(filePath: string, file: string, stat: Stats, now: number) {
    if (now - stat.mtimeMs > this.thresholdMs) {
      try {
        safeUnlinkSync(filePath);
      } catch (e: unknown) {
        const eMessage = e instanceof Error ? e.message : String(e);
        console.warn(`[Cleanup] Echec suppression ${file}: ${eMessage}`);
      }
    }
  }

  _cleanRecursive(directory: string, now: number) {
    try {
      const files = safeReaddirSync(directory);

      for (const file of files) {
        if (file === '.gitkeep') continue;

        const filePath = resolveWithinRoot(this.tempDir, file, directory);
        const stat = safeStatSync(filePath);

        if (stat.isDirectory()) {
          this._cleanRecursive(filePath, now);
        } else {
          this._cleanFile(filePath, file, stat, now);
        }
      }
    } catch (e: unknown) {
      const eMessage = e instanceof Error ? e.message : String(e);
      console.warn(`[Cleanup] Erreur lecture dossier ${directory}: ${eMessage}`);
    }
  }
}
