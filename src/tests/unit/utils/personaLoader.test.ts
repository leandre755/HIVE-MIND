import { jest } from '@jest/globals';

describe('personaLoader', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('should parse valid frontmatter with double quotes and unescape them', async () => {
    await jest.unstable_mockModule('../../../utils/safeFs.js', () => ({
      safeReadFileSync: jest.fn(
        () => `---
name: "Custom \\"Bot\\""
role: "Expert \\"AI\\""
---
Custom language style`,
      ),
    }));

    const { loadPersona } = await import('../../../utils/personaLoader.js');
    const config = loadPersona();

    expect(config.name).toBe('Custom "Bot"');
    expect(config.role).toBe('Expert "AI"');
    expect(config.languageStyle).toBe('Custom language style');
  });

  it('should parse valid frontmatter with single quotes and unescape them', async () => {
    await jest.unstable_mockModule('../../../utils/safeFs.js', () => ({
      safeReadFileSync: jest.fn(
        () => `---
name: 'Custom ''Bot'''
role: 'Expert \\"AI\\"'
---
Single quote style`,
      ),
    }));

    const { loadPersona } = await import('../../../utils/personaLoader.js');
    const config = loadPersona();

    expect(config.name).toBe("Custom 'Bot'");
    expect(config.role).toBe('Expert \\"AI\\"');
    expect(config.languageStyle).toBe('Single quote style');
  });

  it('should fallback to defaults when frontmatter is missing or invalid', async () => {
    await jest.unstable_mockModule('../../../utils/safeFs.js', () => ({
      safeReadFileSync: jest.fn(() => `Just markdown content without frontmatter`),
    }));

    const { loadPersona } = await import('../../../utils/personaLoader.js');
    const config = loadPersona();

    expect(config.name).toBe('HIVE-MIND');
    expect(config.role).toBe('Assistant');
    expect(config.languageStyle).toBe('Just markdown content without frontmatter');
  });

  it('should use default fallback when safeReadFileSync throws an error', async () => {
    await jest.unstable_mockModule('../../../utils/safeFs.js', () => ({
      safeReadFileSync: jest.fn(() => {
        throw new Error('File not found');
      }),
    }));

    const { loadPersona } = await import('../../../utils/personaLoader.js');
    const config = loadPersona();

    expect(config.name).toBe('HIVE-MIND');
    expect(config.role).toBe('Assistant');
    expect(config.languageStyle).toContain('You communicate in a neutral');
  });
});
