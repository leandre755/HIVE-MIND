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
    expect(typeof config.hasApiKey).toBe('function');
    expect(typeof config.hasApiKey('gemini')).toBe('boolean');
    expect(config.getFirstAvailableFamily() ?? 'none').toBeDefined();
    [
      resolveConfigPath,
      cfgIndex.resolveDefaultsConfigDir,
      cfgIndex.resolveLegacyConfigDir,
      cfgIndex.resolveUserConfigDir,
      cfgIndex.resolveHiveHome,
    ].forEach((fn) => expect(typeof fn).toBe('function'));
    expect(resolveConfigPath('config.json').endsWith('config.json')).toBe(true);
  });

  const cleanupTemp = (dir: string, prev?: string) => {
    if (prev !== undefined) process.env.HIVE_CONFIG_DIR = prev;
    else Reflect.deleteProperty(process.env, 'HIVE_CONFIG_DIR');
    try {
      safeRemoveDirectorySync(dir);
    } catch {
      /* ignore */
    }
  };

  it('should load configurations, overrides, and handle missing or invalid schemas', () => {
    const missing = `missing_${randomUUID()}.json`;
    expect(loadJsonConfig(missing)).toEqual({});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const tempDir = safeMkdtempSync(join(tmpdir(), `hive-cfg-all-${randomUUID()}-`));
    const appCfg = {
      name: 'test-custom-app',
      backlog_protection: {
        enabled: true,
        message_stale_threshold_seconds: 42,
        cooldown_between_responses_ms: 1000,
        max_messages_on_startup: 5,
      },
      voice_transcription: { mode: 'restricted' as const },
    };
    safeWriteFileSync(join(tempDir, 'config.json'), JSON.stringify(appCfg));
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
      cleanupTemp(tempDir, prev);
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
    const userCreds = {
      default_provider: 'gemini',
      shared_token: 'user-token',
      familles_ia: { gemini: 'u-gemini', openai: 'u-openai' },
    };
    const prjCreds = {
      project_id: 'prj-123',
      shared_token: 'prj-token',
      familles_ia: { openai: 'p-openai', anthropic: 'p-anthropic' },
    };
    safeWriteFileSync(join(userCfgDir, 'credentials.json'), JSON.stringify(userCreds));
    safeWriteFileSync(join(prjCfgDir, 'credentials.json'), JSON.stringify(prjCreds));
    process.env.HIVE_HOME_DIR = join(tempBase, 'user', '.hivemind');
    process.chdir(join(tempBase, 'project'));
    try {
      expect(loadJsonConfig('credentials.json')).toMatchObject({
        default_provider: 'gemini',
        project_id: 'prj-123',
        shared_token: 'prj-token',
        familles_ia: { gemini: 'u-gemini', openai: 'p-openai', anthropic: 'p-anthropic' },
      });
      safeWriteFileSync(join(prjCfgDir, 'credentials.json'), '{ corrupted');
      expect(loadJsonConfig('credentials.json')).toMatchObject({
        default_provider: 'gemini',
        familles_ia: userCreds.familles_ia,
      });
    } finally {
      process.chdir(originalCwd);
      if (prevHome !== undefined) process.env.HIVE_HOME_DIR = prevHome;
      else Reflect.deleteProperty(process.env, 'HIVE_HOME_DIR');
      try {
        safeRemoveDirectorySync(tempBase);
      } catch {
        /* ignore */
      }
    }
  });
});
