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

export const DEFAULTS_CONFIG_DIR = resolveWithinRoot(__dirname, 'defaults');

export function sanitizeFilename(filename: string): string {
  const clean = basename(filename).trim();
  if (!clean || clean === '.' || clean === '..') {
    throw new Error(`Invalid configuration filename: ${filename}`);
  }
  return clean;
}

export function resolveHiveHome(): string {
  const env = process.env.HIVE_HOME_DIR?.trim();
  return env ? resolve(env) : join(homedir(), '.hivemind');
}

export function resolveUserConfigDir(): string {
  return join(resolveHiveHome(), 'config');
}

export function resolveXdgConfigDir(): string {
  const env = process.env.XDG_CONFIG_HOME?.trim();
  return env ? join(resolve(env), 'hive-mind') : join(homedir(), '.config', 'hive-mind');
}

export function resolveProjectConfigDir(): string {
  return join(process.cwd(), 'config');
}

export function resolveDefaultsConfigDir(): string {
  return DEFAULTS_CONFIG_DIR;
}

function getFileSpecificEnvPath(cleanName: string): string | undefined {
  const normalized = cleanName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase();
  const envVal = Reflect.get(process.env, `HIVE_CONFIG_${normalized}`);
  return typeof envVal === 'string' && envVal.trim().length > 0
    ? resolve(envVal.trim())
    : undefined;
}

export function resolveConfigPath(filename: string): string {
  const cleanName = sanitizeFilename(filename);

  // 1.a Variable d'environnement spécifique au fichier
  const fileSpecificPath = getFileSpecificEnvPath(cleanName);
  if (fileSpecificPath && safeExistsSync(fileSpecificPath)) {
    return fileSpecificPath;
  }

  // 1.b Variable d'environnement HIVE_CONFIG_DIR
  const envConfigDir = process.env.HIVE_CONFIG_DIR?.trim();
  if (envConfigDir) {
    const candidate = resolve(join(envConfigDir, cleanName));
    if (safeExistsSync(candidate)) return candidate;
  }

  // 2. Dossier de projet courant ./config/
  const projectCandidate = resolve(join(resolveProjectConfigDir(), cleanName));
  if (safeExistsSync(projectCandidate)) return projectCandidate;

  // 3. Dossier utilisateur unifié ~/.hivemind/config/
  const userCandidate = resolve(join(resolveUserConfigDir(), cleanName));
  if (safeExistsSync(userCandidate)) return userCandidate;

  // 4. Dossier de repli de compatibilité XDG Linux ~/.config/hive-mind/
  const xdgCandidate = resolve(join(resolveXdgConfigDir(), cleanName));
  if (safeExistsSync(xdgCandidate)) return xdgCandidate;

  // 5. Defaults embarqués
  const defaultsCandidate = resolveWithinRoot(resolveDefaultsConfigDir(), cleanName);
  if (safeExistsSync(defaultsCandidate)) return defaultsCandidate;

  // Repli final prévisible vers l'espace utilisateur pour création future
  return userCandidate;
}

export function resolveDataDir(sub?: string): string {
  const storage = process.env.STORAGE_DIR?.trim();
  if (sub === 'storage' && storage) return resolve(storage);
  const data = process.env.HIVE_DATA_DIR?.trim();
  const base = data ? resolve(data) : join(resolveHiveHome(), 'data');
  return sub?.trim() ? join(base, sub.trim()) : base;
}

export function resolveTempDir(sub?: string): string {
  const temp = (process.env.HIVE_TEMP_DIR || process.env.HIVE_SANDBOX_DIR)?.trim();
  const base = temp ? resolve(temp) : join(homedir(), '.sandbox1');
  return sub?.trim() ? join(base, sub.trim()) : base;
}

export function resolveSandboxDir(sub?: string): string {
  return resolveTempDir(sub);
}
