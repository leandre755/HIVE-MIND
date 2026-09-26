/**
 * src/tests/unit/config/ConfigPathResolverHierarchy.test.ts - Tests hiérarchie ConfigPathResolver (#133)
 */
import { describe, expect, it, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { resolveConfigPath, clearLegacyWarningsCache } from '../../../config/ConfigPathResolver.js';
import * as safeFs from '../../../utils/safeFs.js';

interface TempFixtureEnv {
  baseDir: string;
  envDir: string;
  projectDir: string;
  userHome: string;
  defaultsDir: string;
}

describe('ConfigPathResolver Hierarchy (#133)', () => {
  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();
  let tempBaseDir: string | null = null;

  beforeEach(() => {
    process.env = { ...originalEnv };
    'HIVE_DEFAULTS_CONFIG_DIR HIVE_LEGACY_CONFIG_DIR HIVE_TRUST_PROJECT_CONFIG'
      .split(' ')
      .concat(Object.keys(process.env).filter((k) => k.startsWith('HIVE_CONFIG_')))
      .forEach((k) => Reflect.deleteProperty(process.env, k));
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    if (process.cwd() !== originalCwd) process.chdir(originalCwd);
  });
  afterAll(() => {
    if (tempBaseDir && safeFs.safeExistsSync(tempBaseDir))
      safeFs.safeRemoveDirectorySync(tempBaseDir);
  });

  function createTempEnvironment(): TempFixtureEnv {
    if (!tempBaseDir)
      tempBaseDir = safeFs.safeMkdtempSync(join(tmpdir(), 'hive-mind-cfg-hierarchy-'));
    const runDir = join(tempBaseDir, randomUUID());
    const env: TempFixtureEnv = {
      baseDir: runDir,
      envDir: join(runDir, 'env-config'),
      projectDir: join(runDir, 'project'),
      userHome: join(runDir, 'user-home'),
      defaultsDir: join(runDir, 'defaults'),
    };
    [
      env.envDir,
      join(env.projectDir, 'config'),
      join(env.userHome, '.hivemind', 'config'),
      env.defaultsDir,
    ].forEach((p) => safeFs.safeMkdirSync(p, { recursive: true }));
    return env;
  }

  function seedFiles(env: TempFixtureEnv, fn: string) {
    const res = {
      fileSpec: join(env.envDir, `custom_${fn}`),
      envPath: join(env.envDir, fn),
      prjPath: join(env.projectDir, 'config', fn),
      usrPath: join(env.userHome, '.hivemind', 'config', fn),
    };
    Object.values(res).forEach((p) => safeFs.safeWriteFileSync(p, '{"source":"test"}'));
    return res;
  }

  function applyEnv(env: TempFixtureEnv) {
    process.env.HIVE_HOME_DIR = join(env.userHome, '.hivemind');
    process.chdir(env.projectDir);
  }

  it('Priority 1: should prioritize env vars (file-specific over HIVE_CONFIG_DIR)', () => {
    const env = createTempEnvironment(),
      { fileSpec } = seedFiles(env, 'models_config.json'),
      { envPath } = seedFiles(env, 'config.json');
    process.env.HIVE_CONFIG_MODELS_CONFIG_JSON = fileSpec;
    process.env.HIVE_CONFIG_DIR = env.envDir;
    applyEnv(env);
    expect(resolveConfigPath('models_config.json')).toBe(resolve(fileSpec));
    expect(resolveConfigPath('config.json')).toBe(resolve(envPath));
  });

  it('Priority 2: should prioritize project ./config/ when env vars are unset', () => {
    const env = createTempEnvironment(),
      { prjPath } = seedFiles(env, 'scheduler.json');
    applyEnv(env);
    expect(resolveConfigPath('scheduler.json')).toBe(resolve(prjPath));
    const cred = join(env.projectDir, 'config', 'credentials.json');
    safeFs.safeWriteFileSync(cred, '{"key":"secret"}');
    expect(resolveConfigPath('credentials.json')).toBe(resolve(cred));
  });

  it('Priority 2: should reject project ./config/ for models_config.json without trust opt-in', () => {
    const env = createTempEnvironment(),
      malicious = resolve(join(env.projectDir, 'config', 'models_config.json'));
    safeFs.safeWriteFileSync(malicious, '{"malicious":true}');
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
    safeFs.safeWriteFileSync(usrPath, '{"source":"user"}');
    applyEnv(env);
    expect(resolveConfigPath('pricing.json')).toBe(resolve(usrPath));
  });

  it('Priority 4: should fall back to legacy module directory with warning', () => {
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

  function applyDefaultsTestEnv(env: TempFixtureEnv) {
    process.env.HIVE_DEFAULTS_CONFIG_DIR = env.defaultsDir;
    process.env.HIVE_LEGACY_CONFIG_DIR = env.envDir;
    applyEnv(env);
  }

  it('Priority 5: should handle defaults overrides, template probes, and fallback when incomplete', () => {
    const env = createTempEnvironment(),
      customDefaults = join(env.defaultsDir, 'config.json');
    safeFs.safeWriteFileSync(customDefaults, '{"source":"overridden_defaults"}');
    safeFs.safeWriteFileSync(join(env.envDir, 'config.json'), '{"source":"legacy"}');
    const probe = join(env.defaultsDir, `probe_default_${randomUUID()}.json`);
    safeFs.safeWriteFileSync(probe, '{"probe":"default"}');
    applyDefaultsTestEnv(env);
    expect(resolveConfigPath('config.json')).toBe(resolve(customDefaults));
    expect(resolveConfigPath(basename(probe))).toBe(resolve(probe));
    const resolved = resolveConfigPath('models_config.json');
    expect(safeFs.safeExistsSync(resolved) && resolved.endsWith('models_config.json')).toBe(true);
  });

  it('Priority 5: should strictly reject falling back to defaults for credentials.json', () => {
    const env = createTempEnvironment();
    applyDefaultsTestEnv(env);
    safeFs.safeWriteFileSync(join(env.defaultsDir, 'credentials.json'), '{"apiKey":"fake"}');
    expect(resolveConfigPath('credentials.json')).toBe(
      resolve(join(env.userHome, '.hivemind', 'config', 'credentials.json')),
    );
  });

  it('Fallback for completely non-existent files returns user config path', () => {
    const env = createTempEnvironment(),
      missing = `unknown_${randomUUID()}.json`;
    applyEnv(env);
    expect(resolveConfigPath(missing)).toBe(
      resolve(join(env.userHome, '.hivemind', 'config', missing)),
    );
  });
});
