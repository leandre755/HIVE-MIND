import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  getAccountStatus,
  areAllAccountsConnected,
  updateEnvVariable,
  disconnectWhatsApp,
  disconnectTelegram,
  disconnectDiscord,
} from '../../../cli/authSessionManager.js';
import { runStartupMenu } from '../../../cli/startupMenu.js';

describe('Startup Options Menu CLI & Session Manager', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('authSessionManager', () => {
    it('should correctly evaluate account status', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'test-token-12345';
      process.env.DISCORD_TOKEN = 'test-discord-token-67890';

      const status = getAccountStatus();
      expect(status.telegram).toBe(true);
      expect(status.discord).toBe(true);
    });

    it('should evaluate areAllAccountsConnected correctly', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'token';
      process.env.DISCORD_TOKEN = 'token';
      expect(typeof areAllAccountsConnected()).toBe('boolean');
    });

    it('should update and remove env variables via updateEnvVariable', () => {
      updateEnvVariable('TEST_CLI_VAR', 'value123');
      expect(process.env.TEST_CLI_VAR).toBe('value123');

      updateEnvVariable('TEST_CLI_VAR', null);
      expect(process.env.TEST_CLI_VAR).toBeUndefined();
    });

    it('should sanitize newlines in updateEnvVariable to prevent env injection', () => {
      updateEnvVariable('TEST_INJECT_VAR', 'validtoken\nINJECTED_VAR=hacked');
      expect(process.env.TEST_INJECT_VAR).toBe('validtokenINJECTED_VAR=hacked');
      expect(process.env.INJECTED_VAR).toBeUndefined();
      updateEnvVariable('TEST_INJECT_VAR', null);
    });

    it('should disconnect Telegram and Discord correctly', () => {
      process.env.TELEGRAM_BOT_TOKEN = 'token_tg';
      process.env.DISCORD_TOKEN = 'token_dc';

      disconnectTelegram();
      expect(process.env.TELEGRAM_BOT_TOKEN).toBeUndefined();

      disconnectDiscord();
      expect(process.env.DISCORD_TOKEN).toBeUndefined();
    });

    it('should execute disconnectWhatsApp without throwing', () => {
      expect(() => disconnectWhatsApp()).not.toThrow();
    });
  });

  describe('startupMenu auto-skip', () => {
    it('should skip immediately when running in CI or headless mode', async () => {
      process.env.CI = 'true';
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

      await runStartupMenu();

      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('🤖 HIVE-MIND'));
      consoleSpy.mockRestore();
    });
  });
});
