/**
 * HiveFileService — Service de fichiers pour le TUI HIVE-MIND
 *
 * Ce service implémente l'interface nécessaire pour le système @file du TUI
 * en utilisant les outils existants de HIVE-MIND (read_file, list_directory, etc.)
 *
 * Il remplace le FileDiscoveryService de Gemini CLI pour le TUI HIVE-MIND.
 */

import * as path from 'node:path';
import { safeReadFile, safeStat, safeReaddir } from '../../utils/safeFs.js';

// Types pour le service de fichiers
export interface FileStats {
  isFile(): boolean;
  isDirectory(): boolean;
  size: number;
  mtime: Date;
}

export interface FileDiscoveryOptions {
  respectGitIgnore?: boolean;
  respectHiveIgnore?: boolean;
}

export interface FileFilteringOptions {
  respectGitIgnore?: boolean;
  respectHiveIgnore?: boolean;
  enableFileWatcher?: boolean;
  maxFileCount?: number;
  searchTimeout?: number;
}

/**
 * HiveFileService implémente les fonctionnalités de découverte de fichiers
 * nécessaires pour le TUI HIVE-MIND
 */
export class HiveFileService {
  private targetDir: string;
  private gitIgnoredFiles: Set<string> = new Set();
  private hiveIgnoredFiles: Set<string> = new Set();

  constructor(targetDir: string = process.cwd()) {
    this.targetDir = targetDir;
    this.loadIgnoreFiles();
  }

  /**
   * Charge les fichiers .gitignore et .geminiignore
   */
  private async loadIgnoreFiles(): Promise<void> {
    try {
      const gitignorePath = path.join(this.targetDir, '.gitignore');
      const gitignoreContent = await safeReadFile(gitignorePath, 'utf-8').catch(() => '');
      this.gitIgnoredFiles = this.parseIgnoreFile(gitignoreContent);
    } catch {
      // Pas de .gitignore, c'est ok
    }

    try {
      const hiveignorePath = path.join(this.targetDir, '.hiveignore');
      let hiveignoreContent = await safeReadFile(hiveignorePath, 'utf-8').catch(() => null);
      if (hiveignoreContent === null) {
        const geminiignorePath = path.join(this.targetDir, '.geminiignore');
        hiveignoreContent = await safeReadFile(geminiignorePath, 'utf-8').catch(() => '');
      }
      this.hiveIgnoredFiles = this.parseIgnoreFile(hiveignoreContent);
    } catch {
      // Pas de fichier d'ignore, c'est ok
    }
  }

  /**
   * Parse un fichier d'ignore et retourne les patterns
   */
  private parseIgnoreFile(content: string): Set<string> {
    const patterns = new Set<string>();
    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        patterns.add(trimmed);
      }
    }

    return patterns;
  }

  /**
   * Vérifie si un fichier doit être ignoré
   */
  shouldIgnoreFile(filePath: string, options: FileDiscoveryOptions = {}): boolean {
    const { respectGitIgnore = true, respectHiveIgnore = true } = options;

    if (respectGitIgnore) {
      for (const pattern of this.gitIgnoredFiles) {
        if (this.matchesPattern(filePath, pattern)) {
          return true;
        }
      }
    }

    if (respectHiveIgnore) {
      for (const pattern of this.hiveIgnoredFiles) {
        if (this.matchesPattern(filePath, pattern)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Vérifie si un chemin correspond à un pattern
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    const basename = path.basename(filePath);
    const patternBasename = path.basename(pattern);

    if (pattern.includes('*')) {
      const cleanPattern = pattern.replace(/\*/g, '');
      return basename.includes(cleanPattern) || filePath.includes(cleanPattern);
    }

    return basename === patternBasename || filePath.includes(pattern);
  }

  /**
   * Vérifie si un fichier existe
   */
  async fileExists(filePath: string): Promise<boolean> {
    try {
      await safeStat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Récupère les stats d'un fichier
   */
  async stat(filePath: string): Promise<FileStats | null> {
    try {
      const stats = await safeStat(filePath);
      return {
        isFile: () => stats.isFile(),
        isDirectory: () => stats.isDirectory(),
        size: stats.size,
        mtime: stats.mtime,
      };
    } catch {
      return null;
    }
  }

  /**
   * Liste les fichiers d'un répertoire
   */
  async listDirectory(dirPath: string): Promise<string[]> {
    try {
      const entries = await safeReaddir(dirPath);
      return entries as string[];
    } catch {
      return [];
    }
  }

  /**
   * Lit le contenu d'un fichier
   */
  async readFile(filePath: string): Promise<string | null> {
    try {
      return await safeReadFile(filePath, 'utf-8');
    } catch {
      return null;
    }
  }

  /**
   * Résout un chemin relatif par rapport au répertoire cible
   */
  resolvePath(relativePath: string): string {
    return path.resolve(this.targetDir, relativePath);
  }

  /**
   * Récupère le répertoire cible
   */
  getTargetDir(): string {
    return this.targetDir;
  }
}

// Instance singleton
export const hiveFileService = new HiveFileService();

// Export par défaut
export default hiveFileService;
