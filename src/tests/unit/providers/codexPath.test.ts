// tests/unit/providers/codexPath.test.ts
// Vérifie que l'adaptateur Codex résout le chemin auth.json de manière dynamique
// et portable via os.homedir() sans aucun chemin utilisateur en dur (#131, parent #96).
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';
import { getCodexAuthFilePath, AUTH_FILE_PATH } from '../../../providers/adapters/codex.js';

describe('Codex Auth File Path Resolution (#131)', () => {
  const originalEnv = process.env.CODEX_AUTH_PATH;

  beforeEach(() => {
    delete process.env.CODEX_AUTH_PATH;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CODEX_AUTH_PATH = originalEnv;
    } else {
      delete process.env.CODEX_AUTH_PATH;
    }
    jest.restoreAllMocks();
  });

  it('résout le chemin auth.json dynamiquement à partir de os.homedir()', () => {
    const mockHome = '/home/test-agent-user';
    jest.spyOn(os, 'homedir').mockReturnValue(mockHome);

    const resolved = getCodexAuthFilePath();
    expect(resolved).toBe(path.join(mockHome, '.codex', 'auth.json'));
    expect(resolved).not.toContain('/home/omni');
  });

  it('gère les chemins avec séparateurs système standards (POSIX ou Windows)', () => {
    const mockHome = path.sep === '\\' ? 'C:\\Users\\MockUser' : '/var/users/mockuser';
    jest.spyOn(os, 'homedir').mockReturnValue(mockHome);

    const resolved = getCodexAuthFilePath();
    expect(resolved).toBe(path.join(mockHome, '.codex', 'auth.json'));
    expect(resolved.endsWith(path.join('.codex', 'auth.json'))).toBe(true);
  });

  it('priorise la variable d environnement CODEX_AUTH_PATH si définie', () => {
    process.env.CODEX_AUTH_PATH = '/custom/isolated/codex-credentials.json';

    const resolved = getCodexAuthFilePath();
    expect(resolved).toBe('/custom/isolated/codex-credentials.json');
  });

  it('exporte AUTH_FILE_PATH cohérent avec la structure attendue (.codex/auth.json)', () => {
    expect(AUTH_FILE_PATH.endsWith(path.join('.codex', 'auth.json'))).toBe(true);
  });
});
