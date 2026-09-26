/**
 * src/tests/unit/config/ConfigPathResolverHierarchy.test.ts - Tests hiérarchie ConfigPathResolver (#133)
 */
import { describe, expect, it, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
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
    ['HIVE_DEFAULTS_CONFIG_DIR', 'HIVE_LEGACY_CONFIG_DIR', 'HIVE_TRUST_PROJECT_CONFIG'].forEach(
      (k) => Reflect.deleteProperty(process.env, k),
    );
    Object.keys(process.env)
      .filter((k) => k.startsWith('HIVE_CONFIG_'))
      .forEach((k) => Reflect.deleteProperty(process.env, k));
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    if (process.cwd() !== originalCwd) process.chdir(originalCwd);
  });
  afterAll(() => {
    if (tempBaseDir && safeExistsSync(tempBaseDir)) safeRemoveDirectorySync(tempBaseDir);
  });

  function createTempEnvironment(): TempFixtureEnv {
    if (!tempBaseDir) tempBaseDir = safeMkdtempSync(join(tmpdir(), 'hive-mind-cfg-hierarchy-'));
    const runDir = join(tempBaseDir, randomUUID());
    const env: TempFixtureEnv = {
      baseDir: runDir,
      envDir: join(runDir, 'env-config'),
      projectDir: join(runDir, 'project'),
      userHome: join(runDir, 'user-home'),
      xdgConfigHome: join(runDir, 'xdg-config'),
      defaultsDir: join(runDir, 'defaults'),
    };
    [
      env.envDir,
      join(env.projectDir, 'config'),
      join(env.userHome, '.hivemind', 'config'),
      join(env.xdgConfigHome, 'hive-mind'),
      env.defaultsDir,
    ].forEach((p) => safeMkdirSync(p, { recursive: true }));
    return env;
  }

  function seedFiles(env: TempFixtureEnv, fn: string) {
    const res = {
      fileSpec: join(env.envDir, `custom_${fn}`),
      envPath: join(env.envDir, fn),
      prjPath: join(env.projectDir, 'config', fn),
      usrPath: join(env.userHome, '.hivemind', 'config', fn),
      xdgPath: join(env.xdgConfigHome, 'hive-mind', fn),
    };
    Object.values(res).forEach((p) => safeWriteFileSync(p, '{"source":"test"}'));
    return res;
  }

  function applyEnv(env: TempFixtureEnv) {
    process.env.HIVE_HOME_DIR = join(env.userHome, '.hivemind');
    process.env.XDG_CONFIG_HOME = env.xdgConfigHome;
    process.chdir(env.projectDir);
  }

  it('Priority 1.a: should prioritize file-specific env var over all others', () => {
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
    process.env.HIVE_CONFIG_DIR = env.envDir;
    applyEnv(env);
    expect(resolveConfigPath('config.json')).toBe(resolve(envPath));
  });

  it('Priority 2: should prioritize project ./config/ when env vars are unset', () => {
    const env = createTempEnvironment(),
      { prjPath } = seedFiles(env, 'scheduler.json');
    applyEnv(env);
    expect(resolveConfigPath('scheduler.json')).toBe(resolve(prjPath));
  });

  it('Priority 2: should reject project ./config/ for models_config.json without trust opt-in', () => {
    const env = createTempEnvironment();
    const malicious = resolve(join(env.projectDir, 'config', 'models_config.json'));
    safeWriteFileSync(malicious, '{"malicious":true}');
    process.env.HIVE_LEGACY_CONFIG_DIR = env.envDir;
    process.env.HIVE_DEFAULTS_CONFIG_DIR = env.defaultsDir;
    applyEnv(env);
    expect(resolveConfigPath('models_config.json')).not.toBe(malicious);
    process.env.HIVE_TRUST_PROJECT_CONFIG = 'true';
    expect(resolveConfigPath('models_config.json')).toBe(malicious);
  });

  it('Priority 3: should prioritize user unified ~/.hivemind/config/ when project config is absent', () => {
    const env = createTempEnvironment(),
      usrPath = join(env.userHome, '.hivemind', 'config', 'pricing.json');
    safeWriteFileSync(usrPath, '{"source":"user"}');
    safeWriteFileSync(join(env.xdgConfigHome, 'hive-mind', 'pricing.json'), '{"source":"xdg"}');
    applyEnv(env);
    expect(resolveConfigPath('pricing.json')).toBe(resolve(usrPath));
  });

  it('Priority 4: should prioritize XDG fallback when unified user config is absent', () => {
    const env = createTempEnvironment(),
      xdgPath = join(env.xdgConfigHome, 'hive-mind', 'services_config.json');
    safeWriteFileSync(xdgPath, '{"source":"xdg"}');
    applyEnv(env);
    expect(resolveConfigPath('services_config.json')).toBe(resolve(xdgPath));
  });

  it('Priority 4.b: should fall back to legacy module directory with warning', () => {
    const env = createTempEnvironment();
    applyEnv(env);
    clearLegacyWarningsCache();
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const isLegacy = (f: string) => resolveConfigPath(f).endsWith(join('src', 'config', f));
      expect(isLegacy('credentials.json') && isLegacy('models_config.json')).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Legacy config location in use'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('Priority 5: should prioritize overridden HIVE_DEFAULTS_CONFIG_DIR over legacy fallback', () => {
    const env = createTempEnvironment();
    const customDefaultsFile = join(env.defaultsDir, 'config.json');
    safeWriteFileSync(customDefaultsFile, '{"source":"overridden_defaults"}');
    safeWriteFileSync(join(env.envDir, 'config.json'), '{"source":"legacy"}');
    process.env.HIVE_DEFAULTS_CONFIG_DIR = env.defaultsDir;
    process.env.HIVE_LEGACY_CONFIG_DIR = env.envDir;
    applyEnv(env);
    expect(resolveConfigPath('config.json')).toBe(resolve(customDefaultsFile));
  });

  it('Priority 5: should fall back to embedded defaults for template files without legacy override', () => {
    const env = createTempEnvironment(),
      probe = join(env.defaultsDir, `probe_default_${randomUUID()}.json`);
    Reflect.deleteProperty(process.env, 'HIVE_CONFIG_DIR');
    process.env.HIVE_DEFAULTS_CONFIG_DIR = env.defaultsDir;
    applyEnv(env);
    safeWriteFileSync(probe, '{"probe":"default"}');
    expect(resolveConfigPath(basename(probe))).toBe(resolve(probe));
  });

  it('Priority 5: should strictly reject falling back to defaults for credentials.json', () => {
    const env = createTempEnvironment();
    process.env.HIVE_DEFAULTS_CONFIG_DIR = env.defaultsDir;
    process.env.HIVE_LEGACY_CONFIG_DIR = env.envDir;
    applyEnv(env);
    safeWriteFileSync(join(env.defaultsDir, 'credentials.json'), '{"apiKey":"fake"}');
    const expected = resolve(join(env.userHome, '.hivemind', 'config', 'credentials.json'));
    expect(resolveConfigPath('credentials.json')).toBe(expected);
  });

  it('Priority 5: should fall back to embedded defaults when custom defaults are incomplete', () => {
    const env = createTempEnvironment();
    process.env.HIVE_DEFAULTS_CONFIG_DIR = env.defaultsDir;
    process.env.HIVE_LEGACY_CONFIG_DIR = env.envDir;
    applyEnv(env);
    const resolved = resolveConfigPath('models_config.json');
    expect(safeExistsSync(resolved) && resolved.endsWith('models_config.json')).toBe(true);
  });

  it('Fallback for completely non-existent files returns user config path', () => {
    const env = createTempEnvironment(),
      missingName = `unknown_${randomUUID()}.json`;
    applyEnv(env);
    const expected = resolve(join(env.userHome, '.hivemind', 'config', missingName));
    expect(resolveConfigPath(missingName)).toBe(expected);
  });
});
