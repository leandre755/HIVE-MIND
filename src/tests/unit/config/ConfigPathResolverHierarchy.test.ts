/**
 * src/tests/unit/config/ConfigPathResolverHierarchy.test.ts - Tests hiérarchie ConfigPathResolver (#133)
 */
import { describe, expect, it, beforeEach, afterEach, afterAll, jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { resolveConfigPath, clearLegacyWarningsCache } from '../../../config/ConfigPathResolver.js';
import * as safeFs from '../../../utils/safeFs.js';

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

  function createEnv() {
    if (!tempBaseDir) tempBaseDir = safeFs.safeMkdtempSync(join(tmpdir(), 'hive-cfg-h-'));
    const b = join(tempBaseDir, randomUUID());
    const env = {
      envDir: join(b, 'env'),
      prjDir: join(b, 'prj'),
      prjCfg: join(b, 'prj', 'config'),
      usrCfg: join(b, 'usr', '.hivemind', 'config'),
      defDir: join(b, 'def'),
    };
    [env.envDir, env.prjCfg, env.usrCfg, env.defDir].forEach((d) =>
      safeFs.safeMkdirSync(d, { recursive: true }),
    );
    process.env.HIVE_HOME_DIR = join(b, 'usr', '.hivemind');
    process.chdir(env.prjDir);
    return env;
  }

  it('Priority 1: should prioritize env vars (file-specific over HIVE_CONFIG_DIR)', () => {
    const e = createEnv(),
      spec = join(e.envDir, 'custom_models.json'),
      cfg = join(e.envDir, 'config.json');
    [spec, cfg].forEach((f) => safeFs.safeWriteFileSync(f, '{"s":1}'));
    process.env.HIVE_CONFIG_MODELS_CONFIG_JSON = spec;
    process.env.HIVE_CONFIG_DIR = e.envDir;
    expect(resolveConfigPath('models_config.json')).toBe(resolve(spec));
    expect(resolveConfigPath('config.json')).toBe(resolve(cfg));
  });

  it('Priority 2: should prioritize project ./config/ and enforce trust opt-in for sensitive configs', () => {
    const e = createEnv(),
      prjSched = join(e.prjCfg, 'scheduler.json'),
      prjCred = join(e.prjCfg, 'credentials.json'),
      prjMod = join(e.prjCfg, 'models_config.json'),
      prjServ = join(e.prjCfg, 'services_config.json');
    [prjSched, prjCred, prjMod, prjServ].forEach((f) => safeFs.safeWriteFileSync(f, '{"s":1}'));
    expect(resolveConfigPath('credentials.json')).toBe(resolve(prjCred));

    process.env.HIVE_LEGACY_CONFIG_DIR = e.envDir;
    process.env.HIVE_DEFAULTS_CONFIG_DIR = e.defDir;
    const sens = [
      ['models_config.json', prjMod],
      ['scheduler.json', prjSched],
      ['services_config.json', prjServ],
    ];
    sens.forEach(([n, p]) => expect(resolveConfigPath(n)).not.toBe(resolve(p)));
    process.env.HIVE_TRUST_PROJECT_CONFIG = 'true';
    sens.forEach(([n, p]) => expect(resolveConfigPath(n)).toBe(resolve(p)));
  });

  it('Priority 3 & 4: should prioritize user config then fallback to legacy with warning', () => {
    const e = createEnv();
    const usrPrice = join(e.usrCfg, 'pricing.json');
    safeFs.safeWriteFileSync(usrPrice, '{"p":1}');
    expect(resolveConfigPath('pricing.json')).toBe(resolve(usrPrice));

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

  it('Priority 5: should handle defaults overrides and reject credentials in defaults', () => {
    const e = createEnv(),
      custDef = join(e.defDir, 'config.json'),
      probe = join(e.defDir, `prb_${randomUUID()}.json`);
    safeFs.safeWriteFileSync(custDef, '{"def":1}');
    safeFs.safeWriteFileSync(join(e.envDir, 'config.json'), '{"leg":1}');
    safeFs.safeWriteFileSync(probe, '{"prb":1}');
    process.env.HIVE_DEFAULTS_CONFIG_DIR = e.defDir;
    process.env.HIVE_LEGACY_CONFIG_DIR = e.envDir;
    expect(resolveConfigPath('config.json')).toBe(resolve(custDef));
    expect(resolveConfigPath(basename(probe))).toBe(resolve(probe));
    expect(safeFs.safeExistsSync(resolveConfigPath('models_config.json'))).toBe(true);

    safeFs.safeWriteFileSync(join(e.defDir, 'credentials.json'), '{"fake":1}');
    expect(resolveConfigPath('credentials.json')).toBe(resolve(join(e.usrCfg, 'credentials.json')));
  });

  it('Fallback for completely non-existent files returns user config path', () => {
    const e = createEnv();
    const miss = `unknown_${randomUUID()}.json`;
    expect(resolveConfigPath(miss)).toBe(resolve(join(e.usrCfg, miss)));
  });
});
