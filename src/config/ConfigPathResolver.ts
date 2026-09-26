/**
 * src/config/ConfigPathResolver.ts
 *
 * Résolveur hiérarchique des chemins de configuration et des espaces de travail
 * de HIVE-MIND pour l'installation autonome et la portabilité hors arbre source.
 */

import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeExistsSync, resolveWithinRoot } from '../utils/safeFs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Répertoire des configurations templates par défaut embarquées dans le bundle/build.
 */
export const DEFAULTS_CONFIG_DIR = resolveWithinRoot(__dirname, 'defaults');

/**
 * Nettoie et valide un nom de fichier pour prévenir les traversées de chemin.
 */
export function sanitizeFilename(filename: string): string {
  const clean = basename(filename).trim();
  if (!clean || clean === '.' || clean === '..') {
    throw new Error(`Invalid configuration filename: ${filename}`);
  }
  return clean;
}

/**
 * Résout le répertoire racine unifié de l'application (~/.hivemind).
 */
export function resolveHiveHome(): string {
  const envHome = process.env.HIVE_HOME_DIR;
  if (envHome && envHome.trim().length > 0) {
    return resolve(envHome.trim());
  }
  return join(homedir(), '.hivemind');
}

/**
 * Résout le répertoire des configurations utilisateur unifié (~/.hivemind/config).
 */
export function resolveUserConfigDir(): string {
  return join(resolveHiveHome(), 'config');
}

/**
 * Résout le répertoire de configuration XDG Linux (~/.config/hive-mind).
 */
export function resolveXdgConfigDir(): string {
  const xdgHome = process.env.XDG_CONFIG_HOME;
  if (xdgHome && xdgHome.trim().length > 0) {
    return join(resolve(xdgHome.trim()), 'hive-mind');
  }
  return join(homedir(), '.config', 'hive-mind');
}

/**
 * Résout le répertoire de configuration du projet courant (./config).
 */
export function resolveProjectConfigDir(): string {
  return join(process.cwd(), 'config');
}

/**
 * Résout le répertoire de configuration par défaut embarqué.
 */
export function resolveDefaultsConfigDir(): string {
  return DEFAULTS_CONFIG_DIR;
}

/**
 * Recherche une surcharge explicite par variable d'environnement pour un fichier.
 * Format supporté : HIVE_CONFIG_<FILENAME_NORMALISE> (ex: HIVE_CONFIG_MODELS_CONFIG_JSON).
 */
function getFileSpecificEnvPath(cleanName: string): string | undefined {
  const normalized = cleanName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
  const envKey = `HIVE_CONFIG_${normalized}`;
  const envVal = Reflect.get(process.env, envKey);
  if (typeof envVal === 'string' && envVal.trim().length > 0) {
    return resolve(envVal.trim());
  }
  return undefined;
}

/**
 * Résout le chemin absolu d'un fichier de configuration selon la hiérarchie stricte :
 * 1. Variable d'environnement explicite par fichier (HIVE_CONFIG_<FILE>) ou dossier (HIVE_CONFIG_DIR)
 * 2. Dossier ./config/<filename> du projet courant
 * 3. Dossier utilisateur unifié ~/.hivemind/config/<filename>
 * 4. Dossier de compatibilité XDG ~/.config/hive-mind/<filename>
 * 5. Valeurs par défaut embarquées dans le paquet (src/config/defaults/<filename>)
 *
 * Si le fichier n'existe physiquement à aucun de ces niveaux :
 * - Renvoie le chemin dans defaults/ s'il y a un template par défaut
 * - Sinon renvoie le chemin cible utilisateur ~/.hivemind/config/<filename>
 */
export function resolveConfigPath(filename: string): string {
  const cleanName = sanitizeFilename(filename);

  // 1.a Variable d'environnement spécifique au fichier
  const fileSpecificPath = getFileSpecificEnvPath(cleanName);
  if (fileSpecificPath && safeExistsSync(fileSpecificPath)) {
    return fileSpecificPath;
  }

  // 1.b Variable d'environnement HIVE_CONFIG_DIR
  const envConfigDir = process.env.HIVE_CONFIG_DIR;
  if (envConfigDir && envConfigDir.trim().length > 0) {
    const candidate = resolve(join(envConfigDir.trim(), cleanName));
    if (safeExistsSync(candidate)) {
      return candidate;
    }
  }

  // 2. Dossier de projet courant ./config/
  const projectCandidate = resolve(join(resolveProjectConfigDir(), cleanName));
  if (safeExistsSync(projectCandidate)) {
    return projectCandidate;
  }

  // 3. Dossier utilisateur unifié ~/.hivemind/config/
  const userCandidate = resolve(join(resolveUserConfigDir(), cleanName));
  if (safeExistsSync(userCandidate)) {
    return userCandidate;
  }

  // 4. Dossier de repli de compatibilité XDG Linux ~/.config/hive-mind/
  const xdgCandidate = resolve(join(resolveXdgConfigDir(), cleanName));
  if (safeExistsSync(xdgCandidate)) {
    return xdgCandidate;
  }

  // 5. Defaults embarqués
  const defaultsCandidate = resolveWithinRoot(resolveDefaultsConfigDir(), cleanName);
  if (safeExistsSync(defaultsCandidate)) {
    return defaultsCandidate;
  }

  // Repli final prévisible vers l'espace utilisateur pour création future
  return userCandidate;
}

/**
 * Résout le répertoire des données persistantes (~/.hivemind/data ou sous-dossier).
 */
export function resolveDataDir(sub?: string): string {
  if (sub === 'storage' && process.env.STORAGE_DIR && process.env.STORAGE_DIR.trim().length > 0) {
    return resolve(process.env.STORAGE_DIR.trim());
  }

  const envDataDir = process.env.HIVE_DATA_DIR;
  const baseDir =
    envDataDir && envDataDir.trim().length > 0
      ? resolve(envDataDir.trim())
      : join(resolveHiveHome(), 'data');

  return sub && sub.trim().length > 0 ? join(baseDir, sub.trim()) : baseDir;
}

/**
 * Résout le répertoire temporaire / sandbox (~/.sandbox1 ou sous-dossier).
 */
export function resolveTempDir(sub?: string): string {
  const envTemp = process.env.HIVE_TEMP_DIR || process.env.HIVE_SANDBOX_DIR;
  const baseDir =
    envTemp && envTemp.trim().length > 0 ? resolve(envTemp.trim()) : join(homedir(), '.sandbox1');

  return sub && sub.trim().length > 0 ? join(baseDir, sub.trim()) : baseDir;
}

/**
 * Alias sémantique pour resolveTempDir() adapté au contexte du bac à sable d'exécution.
 */
export function resolveSandboxDir(sub?: string): string {
  return resolveTempDir(sub);
}
