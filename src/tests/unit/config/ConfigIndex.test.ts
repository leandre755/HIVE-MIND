/**
 * src/tests/unit/config/ConfigIndex.test.ts
 *
 * Teste le chargement de config via src/config/index.ts et le bon fonctionnement
 * de resolveConfigPath intégré dans loadAndValidateConfig et loadJsonConfig.
 */

import { describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  config,
  loadAndValidateConfig,
  loadJsonConfig,
  resolveConfigPath,
  resolveDefaultsConfigDir,
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
    expect(config && config.env && config.models && config.app.version === '3.0.0').toBeTruthy();
    expect(
      typeof config.hasApiKey === 'function' &&
        typeof config.getFirstAvailableFamily === 'function',
    ).toBe(true);
    for (const fn of [
      resolveConfigPath,
      resolveDefaultsConfigDir,
      resolveUserConfigDir,
      resolveHiveHome,
    ]) {
      expect(typeof fn).toBe('function');
    }
    const resolved = resolveConfigPath('config.json');
    expect(typeof resolved === 'string' && resolved.endsWith('config.json')).toBe(true);
  });

  it('should load configuration files using HIVE_CONFIG_DIR override in loadAndValidateConfig and loadJsonConfig', () => {
    const tempDir = safeMkdtempSync(join(tmpdir(), `hive-cfg-idx-${randomUUID()}-`));
    const cfgPath = join(tempDir, 'config.json'),
      extraPath = join(tempDir, 'custom_extra.json');
    safeWriteFileSync(
      cfgPath,
      JSON.stringify({
        name: 'test-custom-app',
        backlog_protection: {
          enabled: true,
          message_stale_threshold_seconds: 42,
          cooldown_between_responses_ms: 1000,
          max_messages_on_startup: 5,
        },
        voice_transcription: { mode: 'restricted' as const },
      }),
    );
    safeWriteFileSync(extraPath, JSON.stringify({ customKey: 'customVal' }));
    const prevDir = process.env.HIVE_CONFIG_DIR;
    process.env.HIVE_CONFIG_DIR = tempDir;
    try {
      const loaded = loadAndValidateConfig('config.json', AppConfigSchema);
      expect(loaded.name).toBe('test-custom-app');
      expect(loaded.backlog_protection.message_stale_threshold_seconds).toBe(42);
      expect(loadJsonConfig('custom_extra.json').customKey).toBe('customVal');
    } finally {
      if (prevDir !== undefined) process.env.HIVE_CONFIG_DIR = prevDir;
      else delete process.env.HIVE_CONFIG_DIR;
      try {
        safeRemoveDirectorySync(tempDir);
      } catch {
        /* ignore */
      }
    }
  });
});
