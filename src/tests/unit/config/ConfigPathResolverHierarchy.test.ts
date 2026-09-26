/**
 * src/tests/unit/config/ConfigPathResolverHierarchy.test.ts
 *
 * Tests unitaires de la hiérarchie de résolution des configurations (#133 / #96.3) :
 * - Priorité 1.a : variable d'environnement explicite par fichier
 * - Priorité 1.b : variable d'environnement dossier HIVE_CONFIG_DIR
 * - Priorité 2 : dossier ./config/ du projet
 * - Priorité 3 : dossier utilisateur unifié ~/.hivemind/config/
 * - Priorité 4 : dossier de compatibilité XDG ~/.config/hive-mind/
 * - Priorité 5 : templates par défaut embarqués
 * - Repli sécurisé pour les fichiers sans template par défaut (credentials.json)
 */

import { describe, expect, it, beforeEach, afterEach, afterAll } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DEFAULTS_CONFIG_DIR, resolveConfigPath } from '../../../config/ConfigPathResolver.js';
import {
  safeExistsSync,
  safeMkdirSync,
  safeMkdtempSync,
  safeWriteFileSync,
  safeUnlinkSync,
  safeRmdirSync,
  safeReaddirSync,
} from '../../../utils/safeFs.js';

interface TempFixtureEnv {
  baseDir: string;
  envDir: string;
  projectDir: string;
  userHome: string;
  xdgConfigHome: string;
}

describe('ConfigPathResolver Hierarchy (#133)', () => {
  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();
  let tempBaseDir: string | null = null;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    if (process.cwd() !== originalCwd) {
      process.chdir(originalCwd);
    }
  });

  afterAll(() => {
    if (tempBaseDir && safeExistsSync(tempBaseDir)) {
      cleanDirectoryRecursive(tempBaseDir);
    }
  });

  function cleanDirectoryRecursive(dirPath: string): void {
    if (!safeExistsSync(dirPath)) return;
    const entries = safeReaddirSync(dirPath) as unknown as string[];
    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      try {
        cleanDirectoryRecursive(fullPath);
      } catch {
        // Fallback
      }
      try {
        safeUnlinkSync(fullPath);
      } catch {
        try {
          safeRmdirSync(fullPath);
        } catch {
          // Ignorer
        }
      }
    }
    try {
      safeRmdirSync(dirPath);
    } catch {
      // Ignorer
    }
  }

  function createTempEnvironment(): TempFixtureEnv {
    if (!tempBaseDir) {
      tempBaseDir = safeMkdtempSync(join(tmpdir(), 'hive-mind-cfg-hierarchy-'));
    }
    const runDir = join(tempBaseDir, randomUUID());
    const envDir = join(runDir, 'env-config');
    const projectDir = join(runDir, 'project');
    const userHome = join(runDir, 'user-home');
    const xdgConfigHome = join(runDir, 'xdg-config');

    safeMkdirSync(envDir, { recursive: true });
    safeMkdirSync(join(projectDir, 'config'), { recursive: true });
    safeMkdirSync(join(userHome, '.hivemind', 'config'), { recursive: true });
    safeMkdirSync(join(xdgConfigHome, 'hive-mind'), { recursive: true });

    return { baseDir: runDir, envDir, projectDir, userHome, xdgConfigHome };
  }

  function seedFiles(env: TempFixtureEnv, fn: string) {
    const fileSpec = join(env.envDir, `custom_${fn}`);
    const envPath = join(env.envDir, fn);
    const prjPath = join(env.projectDir, 'config', fn);
    const usrPath = join(env.userHome, '.hivemind', 'config', fn);
    const xdgPath = join(env.xdgConfigHome, 'hive-mind', fn);

    safeWriteFileSync(fileSpec, '{"source":"file_specific"}');
    safeWriteFileSync(envPath, '{"source":"env"}');
    safeWriteFileSync(prjPath, '{"source":"project"}');
    safeWriteFileSync(usrPath, '{"source":"user"}');
    safeWriteFileSync(xdgPath, '{"source":"xdg"}');

    return { fileSpec, envPath, prjPath, usrPath, xdgPath };
  }

  function applyEnv(env: TempFixtureEnv) {
    process.env.HIVE_HOME_DIR = join(env.userHome, '.hivemind');
    process.env.XDG_CONFIG_HOME = env.xdgConfigHome;
    process.chdir(env.projectDir);
  }

  it('Priority 1.a: should prioritize file-specific environment variable over all others', () => {
    const env = createTempEnvironment();
    const { fileSpec } = seedFiles(env, 'models_config.json');
    process.env.HIVE_CONFIG_MODELS_CONFIG_JSON = fileSpec;
    process.env.HIVE_CONFIG_DIR = env.envDir;
    applyEnv(env);

    expect(resolveConfigPath('models_config.json')).toBe(resolve(fileSpec));
  });

  it('Priority 1.b: should prioritize HIVE_CONFIG_DIR when file-specific env is absent', () => {
    const env = createTempEnvironment();
    const { envPath } = seedFiles(env, 'config.json');
    delete process.env.HIVE_CONFIG_CONFIG_JSON;
    process.env.HIVE_CONFIG_DIR = env.envDir;
    applyEnv(env);

    expect(resolveConfigPath('config.json')).toBe(resolve(envPath));
  });

  it('Priority 2: should prioritize project ./config/ when environment variables are unset', () => {
    const env = createTempEnvironment();
    const { prjPath } = seedFiles(env, 'scheduler.json');
    delete process.env.HIVE_CONFIG_DIR;
    delete process.env.HIVE_CONFIG_SCHEDULER_JSON;
    applyEnv(env);

    expect(resolveConfigPath('scheduler.json')).toBe(resolve(prjPath));
  });

  it('Priority 3: should prioritize user unified ~/.hivemind/config/ when project config is absent', () => {
    const env = createTempEnvironment();
    const usrPath = join(env.userHome, '.hivemind', 'config', 'pricing.json');
    safeWriteFileSync(usrPath, '{"source":"user"}');
    safeWriteFileSync(join(env.xdgConfigHome, 'hive-mind', 'pricing.json'), '{"source":"xdg"}');
    delete process.env.HIVE_CONFIG_DIR;
    delete process.env.HIVE_CONFIG_PRICING_JSON;
    applyEnv(env);

    expect(resolveConfigPath('pricing.json')).toBe(resolve(usrPath));
  });

  it('Priority 4: should prioritize XDG fallback ~/.config/hive-mind/ when unified user config is absent', () => {
    const env = createTempEnvironment();
    const xdgPath = join(env.xdgConfigHome, 'hive-mind', 'services_config.json');
    safeWriteFileSync(xdgPath, '{"source":"xdg"}');
    delete process.env.HIVE_CONFIG_DIR;
    delete process.env.HIVE_CONFIG_SERVICES_CONFIG_JSON;
    applyEnv(env);

    expect(resolveConfigPath('services_config.json')).toBe(resolve(xdgPath));
  });

  it('Priority 5: should fall back to embedded defaults when no user or project file exists', () => {
    const env = createTempEnvironment();
    delete process.env.HIVE_CONFIG_DIR;
    delete process.env.HIVE_CONFIG_CONFIG_JSON;
    applyEnv(env);

    const resolved = resolveConfigPath('config.json');
    expect(resolved).toBe(resolve(join(DEFAULTS_CONFIG_DIR, 'config.json')));
    expect(safeExistsSync(resolved)).toBe(true);
  });

  it('Fallback for un-defaulted files (like credentials.json) returns user config path', () => {
    const env = createTempEnvironment();
    delete process.env.HIVE_CONFIG_DIR;
    delete process.env.HIVE_CONFIG_CREDENTIALS_JSON;
    applyEnv(env);

    const resolved = resolveConfigPath('credentials.json');
    expect(resolved).toBe(resolve(join(env.userHome, '.hivemind', 'config', 'credentials.json')));
    expect(safeExistsSync(resolved)).toBe(false);
  });
});
