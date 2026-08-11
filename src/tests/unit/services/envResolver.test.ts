// tests/unit/services/envResolver.test.ts
import { describe, it, beforeEach, expect, jest } from '@jest/globals';
import { envResolver } from '../../../services/envResolver.js';

describe('EnvResolver unit tests', () => {
  beforeEach(() => {
    envResolver.clearCache();
    for (const provider of ['GEMINI', 'GROQ']) {
      delete process.env[`${provider}_KEY`];
      for (let index = 1; index <= 7; index++) {
        delete process.env[`${provider}_KEY_${index}`];
      }
    }
    delete process.env.EXPLICIT_VAR;
  });

  it('should return null if value is null', () => {
    expect(envResolver.resolve(null)).toBeNull();
  });

  it('should return null when a value is no_key', () => {
    expect(envResolver.resolve('no_key')).toBeNull();
    expect(envResolver.resolve('NO_KEY')).toBeNull();
  });

  it('should resolve only provider key format for indexed API keys', () => {
    process.env.GEMINI_KEY = 'gemini_primary';
    process.env.GEMINI_KEY_1 = 'gemini_one';
    process.env.GEMINI_KEY_2 = 'gemini_two';

    expect(envResolver.resolveProviderKey('gemini')).toBe('gemini_primary');
    expect(envResolver.resolveProviderKey('gemini', 1)).toBe('gemini_one');
    expect(envResolver.resolveProviderKey('gemini', 2)).toBe('gemini_two');
  });

  it('should ignore unsupported legacy provider key aliases', () => {
    expect(envResolver.resolveProviderKey('gemini')).toBeNull();
    expect(envResolver.getAvailableKeysForProvider('gemini')).toEqual([]);
  });

  it('should ignore no_key provider variables in key rotation', () => {
    process.env.GEMINI_KEY = 'no_key';
    process.env.GEMINI_KEY_1 = 'NO_KEY';
    process.env.GEMINI_KEY_2 = 'gemini_two';

    expect(envResolver.resolveProviderKey('gemini')).toBe('gemini_two');
    expect(envResolver.resolveProviderKey('gemini', 1)).toBeNull();
    expect(envResolver.resolveProviderKey('gemini', 2)).toBe('gemini_two');
    expect(envResolver.getAvailableKeysForProvider('gemini')).toEqual([2]);
  });

  it('should return null without warning when provider key is missing', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(envResolver.resolveProviderKey('groq')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('should list unsuffixed provider key as key index 1', () => {
    process.env.GROQ_KEY = 'groq_primary';

    expect(envResolver.getAvailableKeysForProvider('groq')).toEqual([1]);
  });
});
