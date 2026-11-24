/**
 * src/tests/unit/config/ConfigIndex.test.ts - Intégration src/config/index.ts (#133)
 */
import { describe, expect, it, jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as cfgIndex from '../../../config/index.js';
import { AppConfigSchema } from '../../../config/config.schema.js';
import * as safeFs from '../../../utils/safeFs.js';

const { config, loadAndValidateConfig, loadJsonConfig, resolveConfigPath } = cfgIndex;
const { safeMkdtempSync, safeWriteFileSync, safeMkdirSync, safeRemoveDirectorySync } = safeFs;

describe('src/config/index.ts Integration', () => {
  it('should expose valid config singleton and re-export resolver utilities', () => {
    expect(config?.env && config?.models && config?.app?.version === '3.0.0').toBeTruthy();
    expect(typeof config.hasApiKey('gemini')).toBe('boolean');
    expect(config.getFirstAvailableFamily() ?? 'none').toBeDefined();
    expect(typeof resolveConfigPath).toBe('function');
    expect(resolveConfigPath('config.json').endsWith('config.json')).toBe(true);
  });

  it('should load configurations, overrides, and handle missing or invalid schemas', () => {
    const missing = `missing_${randomUUID()}.json`;
    expect(loadJsonConfig(missing)).toEqual({});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const tempDir = safeMkdtempSync(join(tmpdir(), `hive-cfg-all-${randomUUID()}-`));
    const validCfg =
      '{"name":"test-custom-app","backlog_protection":{"enabled":true,"message_stale_threshold_seconds":42,"cooldown_between_responses_ms":1000,"max_messages_on_startup":5},"voice_transcription":{"mode":"restricted"}}';
    safeWriteFileSync(join(tempDir, 'config.json'), validCfg);
    safeWriteFileSync(join(tempDir, 'custom.json'), JSON.stringify({ customKey: 'customVal' }));
    safeWriteFileSync(join(tempDir, 'corrupted.json'), '{ invalid: json');
    safeWriteFileSync(join(tempDir, 'invalid_schema.json'), '{"name": 123}');
    const prev = process.env.HIVE_CONFIG_DIR;
    process.env.HIVE_CONFIG_DIR = tempDir;
    try {
      expect(loadAndValidateConfig('config.json', AppConfigSchema).name).toBe('test-custom-app');
      expect(loadJsonConfig('custom.json').customKey).toBe('customVal');
      expect(loadAndValidateConfig(missing, AppConfigSchema)).toEqual({});
      expect(loadJsonConfig('corrupted.json')).toEqual({});
      expect(() => loadAndValidateConfig('corrupted.json', AppConfigSchema)).toThrow();
      expect(() => loadAndValidateConfig('invalid_schema.json', AppConfigSchema)).toThrow(
        /Invalid configuration/,
      );
    } finally {
      warnSpy.mockRestore();
      errSpy.mockRestore();
      if (prev !== undefined) Reflect.set(process.env, 'HIVE_CONFIG_DIR', prev);
      else Reflect.deleteProperty(process.env, 'HIVE_CONFIG_DIR');
      try {
        safeRemoveDirectorySync(tempDir);
      } catch {
        /* ignore */
      }
    }
  });

  it('should merge project credentials over user credentials and fallback gracefully on corrupted project file', () => {
    const originalCwd = process.cwd(),
      tempBase = safeMkdtempSync(join(tmpdir(), `hive-creds-merge-${randomUUID()}-`)),
      userCfgDir = join(tempBase, 'user', '.hivemind', 'config'),
      prjCfgDir = join(tempBase, 'project', 'config'),
      prevHome = process.env.HIVE_HOME_DIR;
    safeMkdirSync(userCfgDir, { recursive: true });
    safeMkdirSync(prjCfgDir, { recursive: true });
    const userCreds = { default_provider: 'gemini', familles_ia: { gemini: 'u-gemini' } },
      prjCreds = { project_id: 'p1', familles_ia: { openai: 'p-openai' } },
      prevTrust = process.env.HIVE_TRUST_PROJECT_CONFIG;
    safeWriteFileSync(join(userCfgDir, 'credentials.json'), JSON.stringify(userCreds));
    safeWriteFileSync(join(prjCfgDir, 'credentials.json'), JSON.stringify(prjCreds));
    process.env.HIVE_HOME_DIR = join(tempBase, 'user', '.hivemind');
    process.env.HIVE_TRUST_PROJECT_CONFIG = 'true';
    process.chdir(join(tempBase, 'project'));
    try {
      const chk = (c: object) => expect(loadJsonConfig('credentials.json')).toMatchObject(c);
      const fam1 = { gemini: 'u-gemini', openai: 'p-openai' };
      chk({ default_provider: 'gemini', project_id: 'p1', familles_ia: fam1 });
      safeWriteFileSync(join(prjCfgDir, 'credentials.json'), '{ corrupted');
      chk({ default_provider: 'gemini', familles_ia: userCreds.familles_ia });
      safeWriteFileSync(join(userCfgDir, 'credentials.json'), 'null');
      safeWriteFileSync(join(prjCfgDir, 'credentials.json'), JSON.stringify(prjCreds));
      chk({ project_id: 'p1', familles_ia: prjCreds.familles_ia });
      const isoPath = join(tempBase, 'isolated.json'),
        iso = { isolated: true, familles_ia: { c: '1' } };
      safeWriteFileSync(isoPath, JSON.stringify(iso));
      process.env.HIVE_CONFIG_CREDENTIALS_JSON = isoPath;
      expect(loadJsonConfig('credentials.json')).toEqual(iso);
      safeWriteFileSync(join(userCfgDir, 'credentials.json'), JSON.stringify(userCreds));
      process.env.HIVE_CONFIG_CREDENTIALS_JSON = join(tempBase, 'unmounted.json');
      expect(loadJsonConfig('credentials.json')).toEqual(prjCreds);
      Reflect.deleteProperty(process.env, 'HIVE_CONFIG_CREDENTIALS_JSON');
      process.env.HIVE_CONFIG_DIR = prjCfgDir;
      expect(loadJsonConfig('credentials.json')).toEqual(prjCreds);
      process.env.HIVE_CONFIG_DIR = join(tempBase, 'empty');
      chk({ project_id: 'p1', familles_ia: fam1, default_provider: 'gemini' });
      Reflect.deleteProperty(process.env, 'HIVE_CONFIG_DIR');
    } finally {
      process.chdir(originalCwd);
      if (prevHome !== undefined) Reflect.set(process.env, 'HIVE_HOME_DIR', prevHome);
      else Reflect.deleteProperty(process.env, 'HIVE_HOME_DIR');
      if (prevTrust !== undefined) Reflect.set(process.env, 'HIVE_TRUST_PROJECT_CONFIG', prevTrust);
      else Reflect.deleteProperty(process.env, 'HIVE_TRUST_PROJECT_CONFIG');
      try {
        safeRemoveDirectorySync(tempBase);
      } catch {
        /* ignore */
      }
    }
  });
});
