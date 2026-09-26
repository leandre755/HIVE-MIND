/**
 * src/tests/unit/config/ConfigIndex.test.ts
 *
 * Teste le chargement de config via src/config/index.ts et le bon fonctionnement
 * de resolveConfigPath intégré dans loadAndValidateConfig et loadJsonConfig.
 */

import { describe, expect, it } from '@jest/globals';
import {
  config,
  resolveConfigPath,
  resolveDefaultsConfigDir,
  resolveUserConfigDir,
  resolveHiveHome,
} from '../../../config/index.js';

describe('src/config/index.ts Integration', () => {
  it('should successfully load and expose valid config singleton', () => {
    expect(config).toBeDefined();
    expect(config.env).toBeDefined();
    expect(typeof config.timezone).toBe('string');
    expect(config.models).toBeDefined();
    expect(config.scheduler).toBeDefined();
    expect(config.app).toBeDefined();
    expect(config.app.version).toBe('3.0.0');
    expect(Array.isArray(config.priorityFamilies)).toBe(true);
    expect(typeof config.hasApiKey).toBe('function');
    expect(typeof config.getFirstAvailableFamily).toBe('function');
  });

  it('should re-export ConfigPathResolver utilities correctly', () => {
    expect(typeof resolveConfigPath).toBe('function');
    expect(typeof resolveDefaultsConfigDir).toBe('function');
    expect(typeof resolveUserConfigDir).toBe('function');
    expect(typeof resolveHiveHome).toBe('function');

    const resolved = resolveConfigPath('config.json');
    expect(typeof resolved).toBe('string');
    expect(resolved.endsWith('config.json')).toBe(true);
  });
});
