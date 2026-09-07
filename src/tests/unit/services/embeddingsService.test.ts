import { describe, it, afterEach, jest, expect } from '@jest/globals';
import { EmbeddingsService } from '../../../services/ai/EmbeddingsService.js';

describe('EmbeddingsService - Core Generation and Fallback', () => {
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
            status: 429,
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
      '[Embeddings] Gemini provider failed, attempting OpenAI fallback',
    );
    for (const callArgs of warnSpy.mock.calls) {
      expect(callArgs.join(' ')).not.toContain('Gemini rate limited');
    }
  });

  it('should return null when Gemini fails and OpenAI key is not provided', async () => {
    const mockFetch = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 500,
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
      '[Embeddings] Gemini provider failed, attempting OpenAI fallback',
    );
    expect(errorSpy).toHaveBeenCalledWith('[Embeddings] Fatal error during embedding generation');
    for (const callArgs of warnSpy.mock.calls) {
      expect(callArgs.join(' ')).not.toContain('Gemini offline');
    }
    for (const callArgs of errorSpy.mock.calls) {
      expect(callArgs.join(' ')).not.toContain('OpenAI socket hang up');
    }
  });

  it('should handle malformed or empty OpenAI response during fallback and return null', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const mockFetch = jest
      .fn<typeof fetch>()
      .mockImplementation(async (input: RequestInfo | URL) => {
        const parsed = new URL(String(input));
        if (parsed.hostname === 'generativelanguage.googleapis.com') {
          return {
            ok: false,
            status: 429,
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
    expect(warnSpy).toHaveBeenCalledWith(
      '[Embeddings] Gemini provider failed, attempting OpenAI fallback',
    );
  });
});

describe('EmbeddingsService - Secret Leakage Prevention', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('should never emit synthetic provider secrets in console when provider responses contain secrets', async () => {
    const syntheticSecret = 'SYNTHETIC_PROVIDER_SECRET_7c91b4';
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const mockFetch = jest
      .fn<typeof fetch>()
      .mockImplementation(async (input: RequestInfo | URL) => {
        const parsed = new URL(String(input));
        if (parsed.hostname === 'generativelanguage.googleapis.com') {
          return {
            ok: false,
            status: 400,
            json: async () => ({
              error: {
                message: `Gemini error containing ${syntheticSecret}`,
                code: 400,
              },
            }),
          } as unknown as Response;
        }
        if (parsed.hostname === 'api.openai.com') {
          return {
            ok: false,
            status: 401,
            json: async () => ({
              error: {
                message: `OpenAI error containing ${syntheticSecret}`,
                code: 401,
              },
            }),
          } as unknown as Response;
        }
        throw new Error(`Unexpected hostname: ${parsed.hostname}`);
      });
    global.fetch = mockFetch;

    const service = new EmbeddingsService({
      geminiKey: 'mock-gemini-key',
      openaiKey: 'mock-openai-key',
    });

    const result = await service.embed('test payload with potential secret leakage');

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    expect(warnSpy).toHaveBeenCalledWith(
      '[Embeddings] Gemini provider failed, attempting OpenAI fallback',
    );
    expect(errorSpy).toHaveBeenCalledWith('[Embeddings] Fatal error during embedding generation');

    const allLoggedArgs = [
      ...logSpy.mock.calls.flat(),
      ...warnSpy.mock.calls.flat(),
      ...errorSpy.mock.calls.flat(),
    ];

    for (const arg of allLoggedArgs) {
      const serialized = typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
      expect(serialized).not.toContain(syntheticSecret);
    }
  });

  it('should never emit synthetic secrets in console when network exceptions contain secrets', async () => {
    const syntheticSecret = 'SYNTHETIC_PROVIDER_SECRET_7c91b4';
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const mockFetch = jest
      .fn<typeof fetch>()
      .mockImplementation(async (input: RequestInfo | URL) => {
        const parsed = new URL(String(input));
        if (parsed.hostname === 'generativelanguage.googleapis.com') {
          throw new Error(`Gemini network failure: ${syntheticSecret}`);
        }
        if (parsed.hostname === 'api.openai.com') {
          throw new Error(`OpenAI socket failure: ${syntheticSecret}`);
        }
        throw new Error(`Unexpected hostname: ${parsed.hostname}`);
      });
    global.fetch = mockFetch;

    const service = new EmbeddingsService({
      geminiKey: 'mock-gemini-key',
      openaiKey: 'mock-openai-key',
    });

    const result = await service.embed('network failure test');

    expect(result).toBeNull();
    expect(mockFetch).toHaveBeenCalledTimes(2);

    expect(warnSpy).toHaveBeenCalledWith(
      '[Embeddings] Gemini provider failed, attempting OpenAI fallback',
    );
    expect(errorSpy).toHaveBeenCalledWith('[Embeddings] Fatal error during embedding generation');

    const allLoggedArgs = [
      ...logSpy.mock.calls.flat(),
      ...warnSpy.mock.calls.flat(),
      ...errorSpy.mock.calls.flat(),
    ];

    for (const arg of allLoggedArgs) {
      const serialized = typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
      expect(serialized).not.toContain(syntheticSecret);
    }
  });
});
