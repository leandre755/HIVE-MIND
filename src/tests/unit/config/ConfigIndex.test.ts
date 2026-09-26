/**
 * src/tests/unit/config/ConfigIndex.test.ts - Intégration src/config/index.ts (#133)
 */
import { describe, expect, it, jest } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  config,
  loadAndValidateConfig,
  loadJsonConfig,
  resolveConfigPath,
  resolveDefaultsConfigDir,
  resolveLegacyConfigDir,
  resolveUserConfigDir,
  resolveHiveHome,
} from '../../../config/index.js';
import { AppConfigSchema } from '../../../config/config.schema.js';
import {
  safeMkdtempSync,
  safeWriteFileSync,
  safeRemoveDirectorySync,
} from '../../../utils/safeFs.js';

describe('src/config/index.ts Integration', () => {
  it('should expose valid config singleton and re-export resolver utilities', () => {
    expect(config?.env && config?.models && config?.app?.version === '3.0.0').toBeTruthy();
    expect(typeof config.hasApiKey).toBe('function');
    expect(typeof config.hasApiKey('gemini')).toBe('boolean');
    expect(config.getFirstAvailableFamily() ?? 'none').toBeDefined();
    [
      resolveConfigPath,
      resolveDefaultsConfigDir,
      resolveLegacyConfigDir,
      resolveUserConfigDir,
      resolveHiveHome,
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

  it('should load configuration files using HIVE_CONFIG_DIR override in loadAndValidateConfig and loadJsonConfig', () => {
    const tempDir = safeMkdtempSync(join(tmpdir(), `hive-cfg-idx-${randomUUID()}-`));
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
    const prevDir = process.env.HIVE_CONFIG_DIR;
    process.env.HIVE_CONFIG_DIR = tempDir;
    try {
      expect(loadAndValidateConfig('config.json', AppConfigSchema).name).toBe('test-custom-app');
      expect(loadJsonConfig('custom.json').customKey).toBe('customVal');
    } finally {
      cleanupTemp(tempDir, prevDir);
    }
  });

  it('should handle missing and corrupted files in loadAndValidateConfig and loadJsonConfig', () => {
    const missing = `missing_${randomUUID()}.json`;
    expect(loadJsonConfig(missing)).toEqual({});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const tempDir = safeMkdtempSync(join(tmpdir(), `hive-cfg-err-${randomUUID()}-`));
    safeWriteFileSync(join(tempDir, 'corrupted.json'), '{ invalid: json');
    safeWriteFileSync(join(tempDir, 'invalid_schema.json'), '{"name": 123}');
    const prev = process.env.HIVE_CONFIG_DIR;
    process.env.HIVE_CONFIG_DIR = tempDir;
    try {
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
});
