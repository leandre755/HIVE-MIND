import {
  safeLstatSync,
  safeReaddirSync,
  safeUnlinkSync,
  resolveWithinRoot,
  type Stats,
} from '../utils/safeFs.js';
import path from 'path';
import { fileURLToPath } from 'url';

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
    const dirs = Array.from(new Set([this.tempDir, path.resolve(process.cwd(), 'temp')]));
    try {
      const now = Date.now();
      for (const dir of dirs) this._cleanRecursive(dir, now, dir);
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

  private _safeLstat(filePath: string, file: string): Stats | null {
    try {
      return safeLstatSync(filePath);
    } catch (e: unknown) {
      if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        console.warn(`[Cleanup] Erreur stat ${file}: ${e instanceof Error ? e.message : e}`);
      }
      return null;
    }
  }

  _cleanRecursive(directory: string, now: number, rootDir: string = this.tempDir) {
    const rootStat = directory === rootDir ? this._safeLstat(rootDir, rootDir) : null;
    if (directory === rootDir && (!rootStat?.isDirectory() || rootStat.isSymbolicLink())) return;
    try {
      const files = safeReaddirSync(directory);

      for (const file of files) {
        if (file === '.gitkeep') continue;

        const filePath = resolveWithinRoot(rootDir, file, directory);
        const stat = this._safeLstat(filePath, file);
        if (!stat || stat.isSymbolicLink()) continue;

        if (stat.isDirectory()) {
          this._cleanRecursive(filePath, now, rootDir);
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
