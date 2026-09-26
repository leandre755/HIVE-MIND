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
    const runId = randomUUID();
    const runDir = join(tempBaseDir, runId);
    safeMkdirSync(runDir, { recursive: true });

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

  it('Priority 1.a: should prioritize file-specific environment variable over all others', () => {
    const { envDir, projectDir, userHome, xdgConfigHome } = createTempEnvironment();
    const filename = 'models_config.json';
    const fileSpecificPath = join(envDir, 'custom_models.json');

    safeWriteFileSync(fileSpecificPath, '{"source": "file_specific_env"}');
    safeWriteFileSync(join(envDir, filename), '{"source": "env_dir"}');
    safeWriteFileSync(join(projectDir, 'config', filename), '{"source": "project"}');
    safeWriteFileSync(join(userHome, '.hivemind', 'config', filename), '{"source": "user"}');
    safeWriteFileSync(join(xdgConfigHome, 'hive-mind', filename), '{"source": "xdg"}');

    process.env.HIVE_CONFIG_MODELS_CONFIG_JSON = fileSpecificPath;
    process.env.HIVE_CONFIG_DIR = envDir;
    process.env.HIVE_HOME_DIR = join(userHome, '.hivemind');
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    process.chdir(projectDir);

    const resolved = resolveConfigPath(filename);
    expect(resolved).toBe(resolve(fileSpecificPath));
  });

  it('Priority 1.b: should prioritize HIVE_CONFIG_DIR when file-specific env is absent', () => {
    const { envDir, projectDir, userHome, xdgConfigHome } = createTempEnvironment();
    const filename = 'config.json';
    const envDirPath = join(envDir, filename);

    safeWriteFileSync(envDirPath, '{"source": "env_dir"}');
    safeWriteFileSync(join(projectDir, 'config', filename), '{"source": "project"}');
    safeWriteFileSync(join(userHome, '.hivemind', 'config', filename), '{"source": "user"}');
    safeWriteFileSync(join(xdgConfigHome, 'hive-mind', filename), '{"source": "xdg"}');

    delete process.env.HIVE_CONFIG_CONFIG_JSON;
    process.env.HIVE_CONFIG_DIR = envDir;
    process.env.HIVE_HOME_DIR = join(userHome, '.hivemind');
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    process.chdir(projectDir);

    const resolved = resolveConfigPath(filename);
    expect(resolved).toBe(resolve(envDirPath));
  });

  it('Priority 2: should prioritize project ./config/ when environment variables are unset', () => {
    const { projectDir, userHome, xdgConfigHome } = createTempEnvironment();
    const filename = 'scheduler.json';
    const projectPath = join(projectDir, 'config', filename);

    safeWriteFileSync(projectPath, '{"source": "project"}');
    safeWriteFileSync(join(userHome, '.hivemind', 'config', filename), '{"source": "user"}');
    safeWriteFileSync(join(xdgConfigHome, 'hive-mind', filename), '{"source": "xdg"}');

    delete process.env.HIVE_CONFIG_DIR;
    delete process.env.HIVE_CONFIG_SCHEDULER_JSON;
    process.env.HIVE_HOME_DIR = join(userHome, '.hivemind');
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    process.chdir(projectDir);

    const resolved = resolveConfigPath(filename);
    expect(resolved).toBe(resolve(projectPath));
  });

  it('Priority 3: should prioritize user unified ~/.hivemind/config/ when project config is absent', () => {
    const { projectDir, userHome, xdgConfigHome } = createTempEnvironment();
    const filename = 'pricing.json';
    const userPath = join(userHome, '.hivemind', 'config', filename);

    safeWriteFileSync(userPath, '{"source": "user"}');
    safeWriteFileSync(join(xdgConfigHome, 'hive-mind', filename), '{"source": "xdg"}');

    delete process.env.HIVE_CONFIG_DIR;
    delete process.env.HIVE_CONFIG_PRICING_JSON;
    process.env.HIVE_HOME_DIR = join(userHome, '.hivemind');
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    process.chdir(projectDir);

    const resolved = resolveConfigPath(filename);
    expect(resolved).toBe(resolve(userPath));
  });

  it('Priority 4: should prioritize XDG fallback ~/.config/hive-mind/ when unified user config is absent', () => {
    const { projectDir, userHome, xdgConfigHome } = createTempEnvironment();
    const filename = 'services_config.json';
    const xdgPath = join(xdgConfigHome, 'hive-mind', filename);

    safeWriteFileSync(xdgPath, '{"source": "xdg"}');

    delete process.env.HIVE_CONFIG_DIR;
    delete process.env.HIVE_CONFIG_SERVICES_CONFIG_JSON;
    process.env.HIVE_HOME_DIR = join(userHome, '.hivemind');
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    process.chdir(projectDir);

    const resolved = resolveConfigPath(filename);
    expect(resolved).toBe(resolve(xdgPath));
  });

  it('Priority 5: should fall back to embedded defaults when no user or project file exists', () => {
    const { projectDir, userHome, xdgConfigHome } = createTempEnvironment();
    const filename = 'config.json';

    delete process.env.HIVE_CONFIG_DIR;
    delete process.env.HIVE_CONFIG_CONFIG_JSON;
    process.env.HIVE_HOME_DIR = join(userHome, '.hivemind');
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    process.chdir(projectDir);

    const resolved = resolveConfigPath(filename);
    expect(resolved).toBe(resolve(join(DEFAULTS_CONFIG_DIR, filename)));
    expect(safeExistsSync(resolved)).toBe(true);
  });

  it('Fallback for un-defaulted files (like credentials.json) returns user config path', () => {
    const { projectDir, userHome, xdgConfigHome } = createTempEnvironment();
    const filename = 'credentials.json';

    delete process.env.HIVE_CONFIG_DIR;
    delete process.env.HIVE_CONFIG_CREDENTIALS_JSON;
    process.env.HIVE_HOME_DIR = join(userHome, '.hivemind');
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    process.chdir(projectDir);

    const resolved = resolveConfigPath(filename);
    const expectedUserPath = resolve(join(userHome, '.hivemind', 'config', 'credentials.json'));
    expect(resolved).toBe(expectedUserPath);
    expect(safeExistsSync(resolved)).toBe(false);
  });
});
