import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { BrowserService as BrowserServiceType } from '../../services/browser/BrowserService.js';

// ESM-safe mocking: MUST come before any dynamic import
jest.unstable_mockModule('child_process', () => ({
  execFile: jest.fn(
    (
      _file: unknown,
      _args: unknown,
      _options: unknown,
      cb: (error: unknown, result: { stdout: string; stderr: string }) => void,
    ) =>
      cb(null, {
        stdout: JSON.stringify({ success: true, data: {} }),
        stderr: '',
      }),
  ),
}));

const { BrowserService } = await import('../../services/browser/BrowserService.js');

describe('BrowserService', () => {
  // WHY: BrowserService has a private constructor (singleton). Cast through internals for test access.
  type BrowserServiceInternals = {
    instance: BrowserServiceType | null;
    getInstance: () => BrowserServiceType;
  };

  let browserService: BrowserServiceType;

  beforeEach(() => {
    jest.clearAllMocks();
    // WHY: Reset singleton to ensure clean state between tests
    const internals = BrowserService as unknown as BrowserServiceInternals;
    internals.instance = null;
    browserService = internals.getInstance();
  });

  describe('open', () => {
    it("cas nominal — autorise l'ouverture d'un site légitime", async () => {
      // Arrange
      const url = 'https://wikipedia.org';

      // Act
      const result = await browserService.open(url);

      // Assert
      expect(result.success).toBe(true);
    });

    it("cas d'erreur — refuse l'ouverture si le domaine appartient à la blacklist", async () => {
      // Arrange
      const url = 'https://pornhub.com';

      // Act
      const result = await browserService.open(url);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/blocked by security policy/);
    });
  });
});
