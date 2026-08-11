import { beforeEach, describe, expect, it } from '@jest/globals';
import { resolveApiKey, resolveCredentials } from '../../../config/keyResolver.js';
import { envResolver } from '../../../services/envResolver.js';

describe('keyResolver', () => {
  beforeEach(() => {
    envResolver.clearCache();
    delete process.env.GEMINI_KEY;
    delete process.env.GEMINI_KEY_1;
    delete process.env.OPENAI_KEY;
  });

  describe('resolveApiKey', () => {
    it('should resolve GEMINI_KEY_1 when credentials use ${GEMINI_KEY}', () => {
      // Arrange
      process.env.GEMINI_KEY_1 = 'gemini_live_key';

      // Act
      const resolvedKey = resolveApiKey('${GEMINI_KEY}', 'gemini');

      // Assert
      expect(resolvedKey).toBe('gemini_live_key');
    });

    it('should return null when no provider key exists for an env reference', () => {
      // Arrange
      const placeholder = '${OPENAI_KEY}';

      // Act
      const resolvedKey = resolveApiKey(placeholder, 'openai');

      // Assert
      expect(resolvedKey).toBeNull();
    });
  });

  describe('resolveCredentials', () => {
    it('should resolve provider placeholders inside familles_ia', () => {
      // Arrange
      process.env.GEMINI_KEY_1 = 'gemini_live_key';
      const credentials = {
        familles_ia: {
          gemini: '${GEMINI_KEY}',
        },
      };

      // Act
      const resolvedCredentials = resolveCredentials(credentials);

      // Assert
      const familles = resolvedCredentials.familles_ia as Record<string, string>;
      expect(familles.gemini).toBe('gemini_live_key');
    });
  });
});
