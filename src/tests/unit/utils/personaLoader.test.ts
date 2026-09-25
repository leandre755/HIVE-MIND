import { jest, describe, it, expect, beforeEach } from '@jest/globals';

describe('personaLoader', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  const setupMockAndLoad = async (contentOrError: string | Error) => {
    await jest.unstable_mockModule('../../../utils/safeFs.js', () => ({
      safeReadFileSync: jest.fn(() => {
        if (contentOrError instanceof Error) throw contentOrError;
        return contentOrError;
      }),
    }));
    const { loadPersona } = await import('../../../utils/personaLoader.js');
    return loadPersona();
  };

  it.each([
    [
      'double-quotes',
      '---\nname: "Custom \\"Bot\\""\nrole: "Expert \\"AI\\""\n---\nStyle A',
      'Custom "Bot"',
      'Expert "AI"',
      'Style A',
    ],
    [
      'single-quotes',
      "---\nname: 'Custom ''Bot'''\nrole: 'Expert \\\"AI\\\"'\n---\nStyle B",
      "Custom 'Bot'",
      'Expert \\"AI\\"',
      'Style B',
    ],
    ['no-frontmatter', 'Plain body style', 'HIVE-MIND', 'Assistant', 'Plain body style'],
  ])('handles %s properly', async (_desc, rawYaml, expName, expRole, expStyle) => {
    const config = await setupMockAndLoad(rawYaml);
    expect(config.name).toBe(expName);
    expect(config.role).toBe(expRole);
    expect(config.languageStyle).toBe(expStyle);
  });

  it('uses default fallback on file read error', async () => {
    const config = await setupMockAndLoad(new Error('File not found'));
    expect(config.name).toBe('HIVE-MIND');
    expect(config.role).toBe('Assistant');
    expect(config.languageStyle).toContain('You communicate in a neutral');
  });
});
