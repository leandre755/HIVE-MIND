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
    it('should strictly exclude credentials.json from defaults directory', () => {
      const defaultsDir = resolveDefaultsConfigDir();
      const forbiddenCredentials = join(defaultsDir, 'credentials.json');

      expect(safeExistsSync(forbiddenCredentials)).toBe(false);
    });

    it('should verify defaults directory contains the 5 expected template configurations', () => {
      const defaultsDir = resolveDefaultsConfigDir();
      expect(safeExistsSync(defaultsDir)).toBe(true);

      const expectedTemplates = [
        'config.json',
        'models_config.json',
        'scheduler.json',
        'services_config.json',
        'pricing.json',
      ];

      for (const template of expectedTemplates) {
        const filePath = join(defaultsDir, template);
        expect(safeExistsSync(filePath)).toBe(true);
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
    it('resolveHiveHome should return ~/.hivemind by default and respect HIVE_HOME_DIR override', () => {
      delete process.env.HIVE_HOME_DIR;
      expect(resolveHiveHome()).toBe(join(homedir(), '.hivemind'));

      process.env.HIVE_HOME_DIR = '/custom/hive-home';
      expect(resolveHiveHome()).toBe(resolve('/custom/hive-home'));
    });

    it('resolveUserConfigDir should return ~/.hivemind/config', () => {
      delete process.env.HIVE_HOME_DIR;
      expect(resolveUserConfigDir()).toBe(join(homedir(), '.hivemind', 'config'));
    });

    it('resolveXdgConfigDir should return ~/.config/hive-mind or respect XDG_CONFIG_HOME', () => {
      delete process.env.XDG_CONFIG_HOME;
      expect(resolveXdgConfigDir()).toBe(join(homedir(), '.config', 'hive-mind'));

      process.env.XDG_CONFIG_HOME = '/custom/xdg';
      expect(resolveXdgConfigDir()).toBe(join(resolve('/custom/xdg'), 'hive-mind'));
    });

    it('resolveProjectConfigDir should return ./config from process.cwd()', () => {
      expect(resolveProjectConfigDir()).toBe(join(process.cwd(), 'config'));
    });

    it('resolveDataDir should return ~/.hivemind/data and respect STORAGE_DIR and HIVE_DATA_DIR', () => {
      delete process.env.HIVE_HOME_DIR;
      delete process.env.HIVE_DATA_DIR;
      delete process.env.STORAGE_DIR;

      expect(resolveDataDir()).toBe(join(homedir(), '.hivemind', 'data'));
      expect(resolveDataDir('mediaDB')).toBe(join(homedir(), '.hivemind', 'data', 'mediaDB'));

      process.env.STORAGE_DIR = '/mnt/custom-storage';
      expect(resolveDataDir('storage')).toBe(resolve('/mnt/custom-storage'));

      process.env.HIVE_DATA_DIR = '/mnt/hive-data';
      expect(resolveDataDir('sub')).toBe(join(resolve('/mnt/hive-data'), 'sub'));
    });

    it('resolveTempDir and resolveSandboxDir should return ~/.sandbox1 and respect env overrides', () => {
      delete process.env.HIVE_TEMP_DIR;
      delete process.env.HIVE_SANDBOX_DIR;

      expect(resolveTempDir()).toBe(join(homedir(), '.sandbox1'));
      expect(resolveTempDir('downloads')).toBe(join(homedir(), '.sandbox1', 'downloads'));
      expect(resolveSandboxDir('downloads')).toBe(join(homedir(), '.sandbox1', 'downloads'));

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
