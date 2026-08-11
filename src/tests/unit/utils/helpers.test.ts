import { describe, it, expect } from '@jest/globals';
import { parseDelayRange, sanitizeForWhatsApp, truncate } from '../../../utils/helpers.js';

describe('helpers module', () => {
  describe('parseDelayRange', () => {
    it('should parse valid min-max range string', () => {
      const range = parseDelayRange('500-1500');
      expect(range).toEqual({ min: 500, max: 1500 });
    });

    it('should fallback to default values when input is null or empty', () => {
      expect(parseDelayRange(null)).toEqual({ min: 1000, max: 2000 });
      expect(parseDelayRange('')).toEqual({ min: 1000, max: 2000 });
    });

    it('should handle single number string', () => {
      const range = parseDelayRange('3000');
      expect(range).toEqual({ min: 3000, max: 3000 });
    });
  });

  describe('sanitizeForWhatsApp', () => {
    it('should mask home directory file paths', () => {
      const input = 'Reading file /home/omni/Code/HIVE-MIND-RAILWAY/package.json';
      const output = sanitizeForWhatsApp(input);
      expect(output).toContain('~/Code/HIVE-MIND-RAILWAY/package.json');
      expect(output).not.toContain('/home/omni/');
    });

    it('should mask sensitive environment variables', () => {
      const input = 'Setting API_KEY=secret_key_123 and SUPABASE_KEY=sb_key_456';
      const output = sanitizeForWhatsApp(input);
      expect(output).toContain('API_KEY=********');
      expect(output).toContain('SUPABASE_KEY=********');
      expect(output).not.toContain('secret_key_123');
    });

    it('should return empty string for null input', () => {
      expect(sanitizeForWhatsApp(null)).toBe('');
    });
  });

  describe('truncate', () => {
    it('should truncate text longer than max length', () => {
      expect(truncate('Hello World!', 8)).toBe('Hello...');
    });

    it('should leave short text untouched', () => {
      expect(truncate('Short', 10)).toBe('Short');
    });
  });
});
