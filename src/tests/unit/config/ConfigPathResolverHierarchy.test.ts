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

import { describe, expect, it, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { resolveConfigPath, clearLegacyWarningsCache } from '../../../config/ConfigPathResolver.js';
import {
  safeExistsSync,
  safeMkdirSync,
  safeMkdtempSync,
  safeWriteFileSync,
  safeRemoveDirectorySync,
} from '../../../utils/safeFs.js';

interface TempFixtureEnv {
  baseDir: string;
  envDir: string;
  projectDir: string;
  userHome: string;
  xdgConfigHome: string;
  defaultsDir: string;
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
    if (tempBaseDir && safeExistsSync(tempBaseDir)) safeRemoveDirectorySync(tempBaseDir);
  });

  function createTempEnvironment(): TempFixtureEnv {
    if (!tempBaseDir) tempBaseDir = safeMkdtempSync(join(tmpdir(), 'hive-mind-cfg-hierarchy-'));
    const runDir = join(tempBaseDir, randomUUID());
    const envDir = join(runDir, 'env-config'),
      projectDir = join(runDir, 'project');
    const userHome = join(runDir, 'user-home'),
      xdgConfigHome = join(runDir, 'xdg-config'),
      defaultsDir = join(runDir, 'defaults');
    for (const p of [
      envDir,
      join(projectDir, 'config'),
      join(userHome, '.hivemind', 'config'),
      join(xdgConfigHome, 'hive-mind'),
      defaultsDir,
    ]) {
      safeMkdirSync(p, { recursive: true });
    }
    return { baseDir: runDir, envDir, projectDir, userHome, xdgConfigHome, defaultsDir };
  }

  function seedFiles(env: TempFixtureEnv, fn: string) {
    const fileSpec = join(env.envDir, `custom_${fn}`),
      envPath = join(env.envDir, fn);
    const prjPath = join(env.projectDir, 'config', fn),
      usrPath = join(env.userHome, '.hivemind', 'config', fn),
      xdgPath = join(env.xdgConfigHome, 'hive-mind', fn);
    for (const [p, s] of [
      [fileSpec, 'file_specific'],
      [envPath, 'env'],
      [prjPath, 'project'],
      [usrPath, 'user'],
      [xdgPath, 'xdg'],
    ]) {
      safeWriteFileSync(p, `{"source":"${s}"}`);
    }
    return { fileSpec, envPath, prjPath, usrPath, xdgPath };
  }

  function applyEnv(env: TempFixtureEnv) {
    process.env.HIVE_HOME_DIR = join(env.userHome, '.hivemind');
    process.env.XDG_CONFIG_HOME = env.xdgConfigHome;
    process.chdir(env.projectDir);
  }

  it('Priority 1.a: should prioritize file-specific environment variable over all others', () => {
    const env = createTempEnvironment(),
      { fileSpec } = seedFiles(env, 'models_config.json');
    process.env.HIVE_CONFIG_MODELS_CONFIG_JSON = fileSpec;
    process.env.HIVE_CONFIG_DIR = env.envDir;
    applyEnv(env);
    expect(resolveConfigPath('models_config.json')).toBe(resolve(fileSpec));
  });

  it('Priority 1.b: should prioritize HIVE_CONFIG_DIR when file-specific env is absent', () => {
    const env = createTempEnvironment(),
      { envPath } = seedFiles(env, 'config.json');
    Reflect.deleteProperty(process.env, 'HIVE_CONFIG_CONFIG_JSON');
    process.env.HIVE_CONFIG_DIR = env.envDir;
    applyEnv(env);
    expect(resolveConfigPath('config.json')).toBe(resolve(envPath));
  });

  it('Priority 2: should prioritize project ./config/ when environment variables are unset', () => {
    const env = createTempEnvironment(),
      { prjPath } = seedFiles(env, 'scheduler.json');
    Reflect.deleteProperty(process.env, 'HIVE_CONFIG_DIR');
    Reflect.deleteProperty(process.env, 'HIVE_CONFIG_SCHEDULER_JSON');
    applyEnv(env);
    expect(resolveConfigPath('scheduler.json')).toBe(resolve(prjPath));
  });

  it('Priority 3: should prioritize user unified ~/.hivemind/config/ when project config is absent', () => {
    const env = createTempEnvironment(),
      usrPath = join(env.userHome, '.hivemind', 'config', 'pricing.json');
    safeWriteFileSync(usrPath, '{"source":"user"}');
    safeWriteFileSync(join(env.xdgConfigHome, 'hive-mind', 'pricing.json'), '{"source":"xdg"}');
    Reflect.deleteProperty(process.env, 'HIVE_CONFIG_DIR');
    Reflect.deleteProperty(process.env, 'HIVE_CONFIG_PRICING_JSON');
    applyEnv(env);
    expect(resolveConfigPath('pricing.json')).toBe(resolve(usrPath));
  });

  it('Priority 4: should prioritize XDG fallback ~/.config/hive-mind/ when unified user config is absent', () => {
    const env = createTempEnvironment(),
      xdgPath = join(env.xdgConfigHome, 'hive-mind', 'services_config.json');
    safeWriteFileSync(xdgPath, '{"source":"xdg"}');
    Reflect.deleteProperty(process.env, 'HIVE_CONFIG_DIR');
    Reflect.deleteProperty(process.env, 'HIVE_CONFIG_SERVICES_CONFIG_JSON');
    applyEnv(env);
    expect(resolveConfigPath('services_config.json')).toBe(resolve(xdgPath));
  });

  it('Priority 4.b: should fall back to legacy module directory with warning when project/user configs are absent', () => {
    const env = createTempEnvironment();
    for (const v of [
      'HIVE_CONFIG_DIR',
      'HIVE_CONFIG_CREDENTIALS_JSON',
      'HIVE_CONFIG_MODELS_CONFIG_JSON',
    ]) {
      Reflect.deleteProperty(process.env, v);
    }
    applyEnv(env);
    clearLegacyWarningsCache();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const creds = resolveConfigPath('credentials.json'),
        models = resolveConfigPath('models_config.json');
      expect(
        creds.endsWith(join('src', 'config', 'credentials.json')) && safeExistsSync(creds),
      ).toBe(true);
      expect(
        models.endsWith(join('src', 'config', 'models_config.json')) && safeExistsSync(models),
      ).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Legacy config location in use'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('Priority 5: should fall back to embedded defaults for template files without legacy override', () => {
    const env = createTempEnvironment(),
      probeName = `probe_default_${randomUUID()}.json`,
      probePath = join(env.defaultsDir, probeName);
    Reflect.deleteProperty(process.env, 'HIVE_CONFIG_DIR');
    process.env.HIVE_DEFAULTS_CONFIG_DIR = env.defaultsDir;
    applyEnv(env);
    safeWriteFileSync(probePath, '{"probe":"default"}');
    const resolved = resolveConfigPath(probeName);
    expect(resolved).toBe(resolve(probePath));
    expect(safeExistsSync(resolved)).toBe(true);
  });

  it('Fallback for completely non-existent files returns user config path', () => {
    const env = createTempEnvironment(),
      missingName = `unknown_${randomUUID()}.json`;
    Reflect.deleteProperty(process.env, 'HIVE_CONFIG_DIR');
    applyEnv(env);
    const resolved = resolveConfigPath(missingName);
    expect(resolved).toBe(resolve(join(env.userHome, '.hivemind', 'config', missingName)));
    expect(safeExistsSync(resolved)).toBe(false);
  });
});
