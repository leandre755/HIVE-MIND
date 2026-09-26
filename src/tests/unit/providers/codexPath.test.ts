// tests/unit/providers/codexPath.test.ts
// Vérifie que l'adaptateur Codex résout le chemin auth.json de manière dynamique
// et portable via os.homedir() sans aucun chemin utilisateur en dur (#131, parent #96),
// et garantit une couverture complète de la résolution de credentials et de la persistance.
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import os from 'node:os';
import path from 'node:path';
import {
  getCodexAuthFilePath,
  AUTH_FILE_PATH,
  loadCredentials,
  persistTokens,
  type CodexAuthFile,
  type CodexAuthTokens,
} from '../../../providers/adapters/codex.js';
import {
  safeWriteFileSync,
  safeExistsSync,
  safeUnlinkSync,
  safeReadFileSync,
  safeMkdirSync,
} from '../../../utils/safeFs.js';

describe('Codex Auth File Path Resolution & Credentials (#131)', () => {
  const originalAuthPath = process.env.CODEX_AUTH_PATH;
  const originalRefreshToken = process.env.CODEX_REFRESH_TOKEN;
  const originalAccessToken = process.env.CODEX_ACCESS_TOKEN;
  const originalAccountId = process.env.CODEX_ACCOUNT_ID;

  const testDir = path.join(process.cwd(), 'hm_storage', 'tmp_test_codex');
  const testAuthFile = path.join(testDir, 'test_auth.json');

  beforeEach(() => {
    delete process.env.CODEX_AUTH_PATH;
    delete process.env.CODEX_REFRESH_TOKEN;
    delete process.env.CODEX_ACCESS_TOKEN;
    delete process.env.CODEX_ACCOUNT_ID;

    if (!safeExistsSync(testDir)) {
      safeMkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (originalAuthPath !== undefined) {
      process.env.CODEX_AUTH_PATH = originalAuthPath;
    } else {
      delete process.env.CODEX_AUTH_PATH;
    }
    if (originalRefreshToken !== undefined) {
      process.env.CODEX_REFRESH_TOKEN = originalRefreshToken;
    } else {
      delete process.env.CODEX_REFRESH_TOKEN;
    }
    if (originalAccessToken !== undefined) {
      process.env.CODEX_ACCESS_TOKEN = originalAccessToken;
    } else {
      delete process.env.CODEX_ACCESS_TOKEN;
    }
    if (originalAccountId !== undefined) {
      process.env.CODEX_ACCOUNT_ID = originalAccountId;
    } else {
      delete process.env.CODEX_ACCOUNT_ID;
    }

    if (safeExistsSync(testAuthFile)) {
      try {
        safeUnlinkSync(testAuthFile);
      } catch {
        /* ignore cleanup errors */
      }
    }

    jest.restoreAllMocks();
  });

  describe('Path resolution', () => {
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

    it('exporte AUTH_FILE_PATH résolu lors du chargement du module', () => {
      expect(AUTH_FILE_PATH).toBe(
        originalAuthPath || path.join(os.homedir(), '.codex', 'auth.json'),
      );
    });
  });

  describe('loadCredentials()', () => {
    it('retourne directement fromEnv si CODEX_REFRESH_TOKEN est défini', () => {
      process.env.CODEX_REFRESH_TOKEN = 'env-refresh-token';
      process.env.CODEX_ACCESS_TOKEN = 'env-access-token';
      process.env.CODEX_ACCOUNT_ID = 'env-account-id';
      process.env.CODEX_AUTH_PATH = testAuthFile;

      // Écrire un fichier différent pour s'assurer qu'il n'est pas lu
      safeWriteFileSync(
        testAuthFile,
        JSON.stringify({ tokens: { refresh_token: 'file-refresh' } }),
      );

      const creds = loadCredentials();
      expect(creds.refreshToken).toBe('env-refresh-token');
      expect(creds.accessToken).toBe('env-access-token');
      expect(creds.accountId).toBe('env-account-id');
      expect(creds.authData).toBeNull();
    });

    it('retourne fromEnv si le fichier auth.json n existe pas', () => {
      process.env.CODEX_AUTH_PATH = path.join(testDir, 'non_existent_auth.json');

      const creds = loadCredentials();
      expect(creds.refreshToken).toBeUndefined();
      expect(creds.authData).toBeNull();
    });

    it('charge les tokens depuis auth.json lorsque le fichier existe', () => {
      process.env.CODEX_AUTH_PATH = testAuthFile;
      const sampleAuth: CodexAuthFile = {
        tokens: {
          access_token: 'file-access-123',
          refresh_token: 'file-refresh-456',
          account_id: 'file-account-789',
        },
        other_metadata: 'preserved',
      };
      safeWriteFileSync(testAuthFile, JSON.stringify(sampleAuth));

      const creds = loadCredentials();
      expect(creds.accessToken).toBe('file-access-123');
      expect(creds.refreshToken).toBe('file-refresh-456');
      expect(creds.accountId).toBe('file-account-789');
      expect(creds.authData?.other_metadata).toBe('preserved');
    });

    it('retourne fromEnv avec authData si auth.json ne contient pas de tokens', () => {
      process.env.CODEX_AUTH_PATH = testAuthFile;
      const sampleAuth: CodexAuthFile = {
        other_metadata: 'no-tokens-here',
      };
      safeWriteFileSync(testAuthFile, JSON.stringify(sampleAuth));

      const creds = loadCredentials();
      expect(creds.accessToken).toBeUndefined();
      expect(creds.authData?.other_metadata).toBe('no-tokens-here');
    });

    it('capture l erreur et retourne fromEnv si auth.json contient du JSON invalide', () => {
      process.env.CODEX_AUTH_PATH = testAuthFile;
      safeWriteFileSync(testAuthFile, '{ corrupt-json: invalid');

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const creds = loadCredentials();

      expect(creds.authData).toBeNull();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Codex] Erreur lors de la lecture du fichier auth.json:'),
        expect.anything(),
      );
    });
  });

  describe('persistTokens()', () => {
    it('retourne sans écrire si authData est null et le fichier n existe pas', () => {
      process.env.CODEX_AUTH_PATH = path.join(testDir, 'non_existent_persist.json');

      const tokens: CodexAuthTokens = {
        access_token: 'acc-new',
        refresh_token: 'ref-new',
        account_id: 'act-new',
      };

      persistTokens(null, tokens);
      expect(safeExistsSync(process.env.CODEX_AUTH_PATH)).toBe(false);
    });

    it('sauvegarde les tokens mis à jour dans auth.json en préservant les métadonnées', () => {
      process.env.CODEX_AUTH_PATH = testAuthFile;
      const initialAuth: CodexAuthFile = {
        tokens: {
          access_token: 'old-acc',
          refresh_token: 'old-ref',
          account_id: 'old-act',
        },
        client_version: '1.2.3',
      };
      safeWriteFileSync(testAuthFile, JSON.stringify(initialAuth));

      const newTokens: CodexAuthTokens = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        account_id: 'new-account-id',
      };

      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      persistTokens(initialAuth, newTokens);

      expect(safeExistsSync(testAuthFile)).toBe(true);
      const content = JSON.parse(safeReadFileSync(testAuthFile, 'utf8')) as CodexAuthFile;
      expect(content.tokens?.access_token).toBe('new-access-token');
      expect(content.tokens?.refresh_token).toBe('new-refresh-token');
      expect(content.tokens?.account_id).toBe('new-account-id');
      expect(content.client_version).toBe('1.2.3');
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[Codex] Tokens mis à jour sauvegardés dans auth.json.',
      );
    });

    it('capture l erreur d écriture sans lever d exception si writeFileSync échoue', () => {
      process.env.CODEX_AUTH_PATH = '/dev/null/impossible_file_path.json';

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const tokens: CodexAuthTokens = {
        access_token: 'acc',
        refresh_token: 'ref',
      };
      const authData: CodexAuthFile = { tokens };

      expect(() => persistTokens(authData, tokens)).not.toThrow();
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[Codex] Échec d'écriture de auth.json"),
        expect.anything(),
      );
    });
  });
});
