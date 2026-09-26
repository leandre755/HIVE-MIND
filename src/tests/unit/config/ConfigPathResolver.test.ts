/**
 * src/tests/unit/config/ConfigPathResolver.test.ts
 *
 * Tests unitaires pour ConfigPathResolver (#133 / #96.3) :
 * - Invariants de sécurité et intégrité des templates embarqués
 * - Sanitization des noms de fichiers
 * - Résolution des répertoires de données et bac à sable
 */

import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  resolveDefaultsConfigDir,
  resolveHiveHome,
  resolveUserConfigDir,
  resolveXdgConfigDir,
  resolveProjectConfigDir,
  resolveDataDir,
  resolveTempDir,
  resolveSandboxDir,
  sanitizeFilename,
} from '../../../config/ConfigPathResolver.js';
import { safeExistsSync } from '../../../utils/safeFs.js';

describe('ConfigPathResolver Security & Spaces (#133)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Security Invariants & Defaults Integrity', () => {
    it('should strictly exclude credentials.json from defaults and contain 5 templates', () => {
      const defaultsDir = resolveDefaultsConfigDir();
      expect(safeExistsSync(join(defaultsDir, 'credentials.json'))).toBe(false);

      const templates = [
        'config.json',
        'models_config.json',
        'scheduler.json',
        'services_config.json',
        'pricing.json',
      ];
      for (const t of templates) {
        expect(safeExistsSync(join(defaultsDir, t))).toBe(true);
      }
    });

    it('should sanitize filename and reject traversal attempts', () => {
      expect(sanitizeFilename('config.json')).toBe('config.json');
      expect(sanitizeFilename('../secret.json')).toBe('secret.json');
      expect(sanitizeFilename('/etc/passwd')).toBe('passwd');
      expect(() => sanitizeFilename('')).toThrow(/Invalid configuration filename/);
      expect(() => sanitizeFilename('   ')).toThrow(/Invalid configuration filename/);
      expect(() => sanitizeFilename('.')).toThrow(/Invalid configuration filename/);
      expect(() => sanitizeFilename('..')).toThrow(/Invalid configuration filename/);
    });
  });

  describe('Directory Resolvers & Data Spaces', () => {
    it('should resolve base directories and respect environment overrides', () => {
      delete process.env.HIVE_HOME_DIR;
      delete process.env.XDG_CONFIG_HOME;
      expect(resolveHiveHome()).toBe(join(homedir(), '.hivemind'));
      expect(resolveUserConfigDir()).toBe(join(homedir(), '.hivemind', 'config'));
      expect(resolveXdgConfigDir()).toBe(join(homedir(), '.config', 'hive-mind'));
      expect(resolveProjectConfigDir()).toBe(join(process.cwd(), 'config'));

      process.env.HIVE_HOME_DIR = '/custom/hive-home';
      process.env.XDG_CONFIG_HOME = '/custom/xdg';
      expect(resolveHiveHome()).toBe(resolve('/custom/hive-home'));
      expect(resolveXdgConfigDir()).toBe(join(resolve('/custom/xdg'), 'hive-mind'));
    });

    it('should resolve data and temp/sandbox directories with env overrides', () => {
      delete process.env.HIVE_HOME_DIR;
      delete process.env.HIVE_DATA_DIR;
      delete process.env.STORAGE_DIR;
      delete process.env.HIVE_TEMP_DIR;
      delete process.env.HIVE_SANDBOX_DIR;

      expect(resolveDataDir()).toBe(join(homedir(), '.hivemind', 'data'));
      expect(resolveDataDir('mediaDB')).toBe(join(homedir(), '.hivemind', 'data', 'mediaDB'));
      expect(resolveTempDir()).toBe(join(homedir(), '.sandbox1'));
      expect(resolveSandboxDir('downloads')).toBe(join(homedir(), '.sandbox1', 'downloads'));

      process.env.STORAGE_DIR = '/mnt/custom-storage';
      expect(resolveDataDir('storage')).toBe(resolve('/mnt/custom-storage'));

      process.env.HIVE_DATA_DIR = '/mnt/hive-data';
      expect(resolveDataDir('sub')).toBe(join(resolve('/mnt/hive-data'), 'sub'));

      process.env.HIVE_TEMP_DIR = join(homedir(), '.custom-sandbox');
      expect(resolveTempDir('test')).toBe(
        join(resolve(join(homedir(), '.custom-sandbox')), 'test'),
      );

      delete process.env.HIVE_TEMP_DIR;
      process.env.HIVE_SANDBOX_DIR = join(homedir(), '.sandbox-override');
      expect(resolveSandboxDir('test')).toBe(
        join(resolve(join(homedir(), '.sandbox-override')), 'test'),
      );
    });
  });
});
