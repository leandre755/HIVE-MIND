/**
 * src/tests/unit/config/ConfigPathResolver.test.ts - Tests ConfigPathResolver (#133)
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
import { safeExistsSync, safeReadFileSync } from '../../../utils/safeFs.js';

describe('ConfigPathResolver Security & Spaces (#133)', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Security Invariants & Defaults Integrity', () => {
    it('should strictly exclude credentials.json from defaults and contain 5 matching templates', () => {
      const defaultsDir = resolveDefaultsConfigDir();
      expect(safeExistsSync(join(defaultsDir, 'credentials.json'))).toBe(false);

      const list = [
        'config.json',
        'models_config.json',
        'scheduler.json',
        'services_config.json',
        'pricing.json',
      ];
      for (const t of list) {
        const def = join(defaultsDir, t);
        const orig = join(defaultsDir, '..', t);
        expect(safeExistsSync(def)).toBe(true);
        if (safeExistsSync(orig))
          expect(safeReadFileSync(def, 'utf-8')).toBe(safeReadFileSync(orig, 'utf-8'));
      }
    });

    it('should sanitize filename and reject traversal attempts', () => {
      expect(sanitizeFilename('config.json')).toBe('config.json');
      expect(sanitizeFilename('../secret.json')).toBe('secret.json');
      expect(sanitizeFilename('/etc/passwd')).toBe('passwd');
      ['', '   ', '.', '..'].forEach((inv) =>
        expect(() => sanitizeFilename(inv)).toThrow(/Invalid configuration filename/),
      );
    });
  });

  describe('Directory Resolvers & Data Spaces', () => {
    it('should resolve base directories and respect environment overrides', () => {
      ['HIVE_HOME_DIR', 'XDG_CONFIG_HOME', 'HIVE_DEFAULTS_CONFIG_DIR'].forEach((k) =>
        Reflect.deleteProperty(process.env, k),
      );
      expect(resolveHiveHome()).toBe(join(homedir(), '.hivemind'));
      expect(resolveUserConfigDir()).toBe(join(homedir(), '.hivemind', 'config'));
      expect(resolveXdgConfigDir()).toBe(join(homedir(), '.config', 'hive-mind'));
      expect(resolveProjectConfigDir()).toBe(join(process.cwd(), 'config'));
      expect(resolveDefaultsConfigDir()).toMatch(/defaults$/);

      process.env.HIVE_DEFAULTS_CONFIG_DIR = '/custom/defaults';
      expect(resolveDefaultsConfigDir()).toBe(resolve('/custom/defaults'));
      process.env.HIVE_HOME_DIR = '/custom/hive-home';
      process.env.XDG_CONFIG_HOME = '/custom/xdg';
      expect(resolveHiveHome()).toBe(resolve('/custom/hive-home'));
      expect(resolveXdgConfigDir()).toBe(join(resolve('/custom/xdg'), 'hive-mind'));
    });

    it('should prevent path traversal outside root in data and sandbox resolvers', () => {
      expect(() => resolveDataDir('../outside')).toThrow(/outside allowed root/);
      expect(() => resolveSandboxDir('../../etc/passwd')).toThrow(/outside allowed root/);
    });

    it('should ignore whitespace-only HIVE_TEMP_DIR and choose HIVE_SANDBOX_DIR', () => {
      process.env.HIVE_TEMP_DIR = '   ';
      process.env.HIVE_SANDBOX_DIR = '/custom/sandbox';
      expect(resolveSandboxDir()).toBe(resolve('/custom/sandbox'));
    });

    it('should resolve data and temp/sandbox directories with env overrides', () => {
      const vars = [
        'HIVE_HOME_DIR',
        'HIVE_DATA_DIR',
        'STORAGE_DIR',
        'HIVE_TEMP_DIR',
        'HIVE_SANDBOX_DIR',
      ];
      vars.forEach((v) => Reflect.deleteProperty(process.env, v));
      expect(resolveDataDir()).toBe(join(homedir(), '.hivemind', 'data'));
      expect(resolveDataDir('mediaDB')).toBe(join(homedir(), '.hivemind', 'data', 'mediaDB'));
      expect(resolveTempDir()).toBe(join(homedir(), '.sandbox1'));
      expect(resolveSandboxDir('downloads')).toBe(join(homedir(), '.sandbox1', 'downloads'));
      process.env.STORAGE_DIR = '/mnt/custom-storage';
      expect(resolveDataDir('storage')).toBe(resolve('/mnt/custom-storage'));
      process.env.HIVE_DATA_DIR = '/mnt/hive-data';
      expect(resolveDataDir('sub')).toBe(join(resolve('/mnt/hive-data'), 'sub'));
      const customSandbox = join(homedir(), '.custom-sandbox');
      process.env.HIVE_TEMP_DIR = customSandbox;
      expect(resolveTempDir('test')).toBe(join(customSandbox, 'test'));
      Reflect.deleteProperty(process.env, 'HIVE_TEMP_DIR');
      const customOverride = join(homedir(), '.sandbox-override');
      process.env.HIVE_SANDBOX_DIR = customOverride;
      expect(resolveSandboxDir('test')).toBe(join(customOverride, 'test'));
    });
  });
});
