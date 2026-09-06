import { describe, it, afterEach, jest, expect } from '@jest/globals';
import { EmbeddingsService } from '../../../services/ai/EmbeddingsService.js';

describe('EmbeddingsService unit tests', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('should return null when text is empty or only whitespace', async () => {
    const service = new EmbeddingsService({ geminiKey: 'fake-gemini-key' });
    const resEmpty = await service.embed('');
    const resWhitespace = await service.embed('   \n\t  ');

    expect(resEmpty).toBeNull();
    expect(resWhitespace).toBeNull();
  });

  it('should embed using Gemini and never log the API key in console', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const mockVector = [0.1, 0.2, 0.3];

    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: true,
      json: async () => ({
        embedding: { values: mockVector },
      }),
    } as unknown as Response);
    global.fetch = mockFetch;

    const service = new EmbeddingsService({
      geminiKey: 'mock-gemini-test-key',
      model: 'custom-model',
      dimensions: 768,
    });

    const result = await service.embed('hello\nworld');

    expect(result).toEqual(mockVector);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const fetchCall = mockFetch.mock.calls[0];
    if (!fetchCall) throw new Error('fetchCall undefined');

    expect(String(fetchCall[0])).toContain('custom-model:embedContent');
    expect(String(fetchCall[0])).toContain('key=mock-gemini-test-key');

    const requestBody = JSON.parse(fetchCall[1]?.body as string);
    expect(requestBody.content.parts[0].text).toBe('hello world');
    expect(requestBody.outputDimensionality).toBe(768);

    // Verify console.log does NOT contain the API key (clear-text or obfuscated)
    expect(logSpy).toHaveBeenCalled();
    for (const callArgs of logSpy.mock.calls) {
      const loggedStr = callArgs.join(' ');
      expect(loggedStr).not.toContain('mock-gemini-test-key');
      expect(loggedStr).not.toContain('2345');
      expect(loggedStr).not.toContain('Key:');
    }
  });

  it('should fallback to OpenAI if Gemini fails', async () => {
    const mockOpenAiVector = [0.4, 0.5, 0.6];
    let callCount = 0;

    const mockFetch = jest
      .fn<typeof fetch>()
      .mockImplementation(async (input: RequestInfo | URL) => {
        callCount++;
        const parsed = new URL(String(input));
        if (parsed.hostname === 'generativelanguage.googleapis.com') {
          return {
            ok: false,
            json: async () => ({ error: { message: 'Gemini rate limited' } }),
          } as unknown as Response;
        }
        if (parsed.hostname === 'api.openai.com') {
          return {
            ok: true,
            json: async () => ({
              data: [{ embedding: mockOpenAiVector }],
            }),
          } as unknown as Response;
        }
        throw new Error(`Unexpected hostname: ${parsed.hostname}`);
      });
    global.fetch = mockFetch;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const service = new EmbeddingsService({
      geminiKey: 'gemini-key',
      openaiKey: 'openai-key',
      dimensions: 512,
    });

    const result = await service.embed('fallback test');

    expect(result).toEqual(mockOpenAiVector);
    expect(callCount).toBe(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Embeddings] Gemini failed, attempting OpenAI fallback...'),
      'Gemini rate limited',
    );
  });

  it('should return null when Gemini fails and OpenAI key is not provided', async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Gemini error' } }),
    } as unknown as Response);
    global.fetch = mockFetch;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const service = new EmbeddingsService({
      geminiKey: 'gemini-key',
    });

    const result = await service.embed('test fallback missing openai');

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Embeddings] OpenAI API key missing, skipping fallback'),
    );
  });

  it('should handle fatal exceptions from fallback and return null without crashing', async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockImplementation(async (input: RequestInfo | URL) => {
        const parsed = new URL(String(input));
        if (parsed.hostname === 'generativelanguage.googleapis.com') {
          throw new Error('Gemini offline');
        }
        if (parsed.hostname === 'api.openai.com') {
          throw new Error('OpenAI socket hang up');
        }
        throw new Error(`Unexpected hostname: ${parsed.hostname}`);
      });
    global.fetch = mockFetch;

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const service = new EmbeddingsService({
      geminiKey: 'gemini-key',
      openaiKey: 'openai-key',
    });

    const result = await service.embed('network test');

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[Embeddings] Gemini failed, attempting OpenAI fallback...'),
      'Gemini offline',
    );
    expect(errorSpy).toHaveBeenCalledWith('[Embeddings] Fatal error:', 'OpenAI socket hang up');
  });

  it('should handle malformed or empty OpenAI response during fallback and return null', async () => {
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockImplementation(async (input: RequestInfo | URL) => {
        const parsed = new URL(String(input));
        if (parsed.hostname === 'generativelanguage.googleapis.com') {
          return {
            ok: false,
            json: async () => ({ error: { message: 'Gemini rate limited' } }),
          } as unknown as Response;
        }
        if (parsed.hostname === 'api.openai.com') {
          return {
            ok: true,
            json: async () => ({ data: [] }),
          } as unknown as Response;
        }
        throw new Error(`Unexpected hostname: ${parsed.hostname}`);
      });
    global.fetch = mockFetch;

    const service = new EmbeddingsService({
      geminiKey: 'gemini-key',
      openaiKey: 'openai-key',
    });

    const result = await service.embed('empty payload test');
    expect(result).toBeNull();
  });
});
