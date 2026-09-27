/**
 * src/config/ConfigPathResolver.ts
 *
 * Résolveur hiérarchique des chemins de configuration et des espaces de travail
 * de HIVE-MIND pour l'installation autonome et la portabilité hors arbre source.
 */

import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeExistsSync, safeRealPathSync, resolveWithinRoot } from '../utils/safeFs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const DEFAULTS_CONFIG_DIR = resolveWithinRoot(__dirname, 'defaults');

const warnedLegacyPaths = new Set<string>();

export const clearLegacyWarningsCache = (): void => warnedLegacyPaths.clear();

function warnLegacyLocation(path: string): void {
  if (!warnedLegacyPaths.has(path)) {
    warnedLegacyPaths.add(path);
    console.warn(`[Config] Legacy config location in use: ${path}`);
  }
}

export function sanitizeFilename(filename: string): string {
  const clean = basename(filename).trim();
  if (!clean || clean === '.' || clean === '..') {
    throw new Error(`Invalid configuration filename: ${filename}`);
  }
  return clean;
}

const getEnvDir = (v?: string): string | undefined => (v?.trim() ? resolve(v.trim()) : undefined);

export const resolveHiveHome = (): string =>
  getEnvDir(process.env.HIVE_HOME_DIR) ?? join(homedir(), '.hivemind');
export const resolveUserConfigDir = (): string => join(resolveHiveHome(), 'config');
export const resolveProjectConfigDir = (): string => join(process.cwd(), 'config');
export const resolveDefaultsConfigDir = (): string =>
  getEnvDir(process.env.HIVE_DEFAULTS_CONFIG_DIR) ?? DEFAULTS_CONFIG_DIR;
export const resolveLegacyConfigDir = (): string =>
  getEnvDir(process.env.HIVE_LEGACY_CONFIG_DIR) ?? dirname(DEFAULTS_CONFIG_DIR);

function toCanonicalPath(targetPath: string): string {
  try {
    if (safeExistsSync(targetPath)) {
      return safeRealPathSync(targetPath);
    }
    const parent = dirname(targetPath);
    if (safeExistsSync(parent)) {
      return join(safeRealPathSync(parent), basename(targetPath));
    }
  } catch {
    // repli lexical en cas d'erreur de résolution canonique
  }
  return resolve(targetPath);
}

export function isPathInside(parentDir: string, candidatePath: string): boolean {
  try {
    const root = toCanonicalPath(parentDir);
    const candidate = toCanonicalPath(candidatePath);
    const rel = relative(root, candidate);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  } catch {
    return false;
  }
}

export function isTemplateOrReadOnlyConfig(configPath: string): boolean {
  return (
    isPathInside(resolveDefaultsConfigDir(), configPath) ||
    isPathInside(resolveLegacyConfigDir(), configPath)
  );
}

function getFileSpecificEnvPath(cleanName: string): string | undefined {
  const key = `HIVE_CONFIG_${cleanName.replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`;
  return getEnvDir(Reflect.get(process.env, key));
}

const SENSITIVE_PROJECT_CONFIGS = new Set([
  'credentials.json',
  'models_config.json',
  'pricing.json',
  'scheduler.json',
  'services_config.json',
]);

function isProjectConfigAllowed(cleanName: string): boolean {
  if (!SENSITIVE_PROJECT_CONFIGS.has(cleanName.toLowerCase())) return true;
  return ['true', '1'].includes(process.env.HIVE_TRUST_PROJECT_CONFIG?.trim().toLowerCase() ?? '');
}

function resolveEnvCandidate(cleanName: string): string | undefined {
  const fileSpecificPath = getFileSpecificEnvPath(cleanName);
  if (fileSpecificPath && safeExistsSync(fileSpecificPath)) return fileSpecificPath;
  const envConfigDir = process.env.HIVE_CONFIG_DIR?.trim();
  if (envConfigDir) {
    const candidate = resolve(join(envConfigDir, cleanName));
    if (safeExistsSync(candidate)) return candidate;
  }
  return undefined;
}

export function resolveConfigPath(filename: string): string {
  const cleanName = sanitizeFilename(filename);

  // 1. Variables d'environnement
  const envCandidate = resolveEnvCandidate(cleanName);
  if (envCandidate) return envCandidate;

  // 2. Dossier de projet courant ./config/ (restreint pour les configs sensibles sans opt-in explicite)
  if (isProjectConfigAllowed(cleanName)) {
    const projectCandidate = resolve(join(resolveProjectConfigDir(), cleanName));
    if (safeExistsSync(projectCandidate)) return projectCandidate;
  }

  // 3. Dossier utilisateur unifié ~/.hivemind/config/
  const userCandidate = resolve(join(resolveUserConfigDir(), cleanName));
  if (safeExistsSync(userCandidate)) return userCandidate;

  // Surcharge explicite des defaults avant le dossier hérité
  const isCustomDefaults = !!process.env.HIVE_DEFAULTS_CONFIG_DIR?.trim();
  if (isCustomDefaults && cleanName.toLowerCase() !== 'credentials.json') {
    const customCandidate = resolveWithinRoot(resolveDefaultsConfigDir(), cleanName);
    if (safeExistsSync(customCandidate)) return customCandidate;
  }

  // 4. Dossier hérité du module src/config/ (fallback de rétro-compatibilité)
  const legacyCandidate = resolveWithinRoot(resolveLegacyConfigDir(), cleanName);
  if (safeExistsSync(legacyCandidate)) {
    warnLegacyLocation(legacyCandidate);
    return legacyCandidate;
  }

  // 5. Defaults embarqués (exclus strictement pour credentials.json)
  if (cleanName.toLowerCase() !== 'credentials.json') {
    const embeddedCandidate = resolveWithinRoot(DEFAULTS_CONFIG_DIR, cleanName);
    if (safeExistsSync(embeddedCandidate)) return embeddedCandidate;
  }

  // Repli final prévisible vers l'espace utilisateur pour création future
  return userCandidate;
}

export function resolveDataDir(sub?: string): string {
  const cleanSub = sub?.trim();
  if (cleanSub === 'storage' || cleanSub === 'storage_hm') {
    return getEnvDir(process.env.STORAGE_DIR) ?? join(resolveSandboxDir(), 'storage_hm');
  }
  const base = getEnvDir(process.env.HIVE_DATA_DIR) ?? join(resolveHiveHome(), 'data');
  return cleanSub ? resolveWithinRoot(base, cleanSub) : base;
}

export const resolveTempDir = (sub?: string): string => {
  const base =
    getEnvDir(process.env.HIVE_TEMP_DIR) ??
    getEnvDir(process.env.HIVE_SANDBOX_DIR) ??
    join(homedir(), '.sandbox1');
  return sub?.trim() ? resolveWithinRoot(base, sub.trim()) : base;
};
export const resolveSandboxDir = (sub?: string): string => resolveTempDir(sub);
