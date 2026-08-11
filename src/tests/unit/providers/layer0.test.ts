// src/tests/unit/providers/layer0.test.ts

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { ModelRegistry, getModelConfig } from '../../../providers/layer0/ModelRegistry.js';
import {
  execute,
  executeStream,
  executionLayer,
  ExecutionLayer,
} from '../../../providers/layer0/ExecutionLayer.js';
import { classifyError } from '../../../providers/layer0/classifyError.js';
import {
  Layer0Error,
  AuthError,
  InvalidRequestError,
  NetworkError,
  RateLimitError,
  ServerError,
  ContentFilterError,
} from '../../../providers/layer0/errors.js';

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

const DUMMY_API_KEY = 'test_api_key_123';

beforeEach(() => {
  mockFetch.mockReset();
  ModelRegistry.resetInstance();
});

describe('Layer 0 - Domain Errors (errors.ts)', () => {
  it('instantiates Layer0Error sub-classes with correct properties', () => {
    const invalidErr = new InvalidRequestError('Bad request param');
    expect(invalidErr.code).toBe('INVALID_REQUEST');
    expect(invalidErr.retriable).toBe(false);
    expect(invalidErr.malusWeight).toBe(0);

    const authErr = new AuthError('Unauthorized', { status: 401 });
    expect(authErr.code).toBe('AUTH_ERROR');
    expect(authErr.retriable).toBe(false);
    expect(authErr.malusWeight).toBe(10);
    expect(authErr.status).toBe(401);

    const rateErr = new RateLimitError('Too many requests', { status: 429, retryAfterMs: 5000 });
    expect(rateErr.code).toBe('RATE_LIMIT');
    expect(rateErr.retriable).toBe(true);
    expect(rateErr.malusWeight).toBe(2);
    expect(rateErr.retryAfterMs).toBe(5000);

    const serverErr = new ServerError('Internal server error', { status: 500 });
    expect(serverErr.code).toBe('SERVER_ERROR');
    expect(serverErr.retriable).toBe(true);
    expect(serverErr.malusWeight).toBe(8);

    const netErr = new NetworkError('Connection reset');
    expect(netErr.code).toBe('NETWORK_ERROR');
    expect(netErr.retriable).toBe(true);
    expect(netErr.malusWeight).toBe(8);

    const filterErr = new ContentFilterError('Inappropriate content');
    expect(filterErr.code).toBe('CONTENT_FILTER');
    expect(filterErr.retriable).toBe(false);
    expect(filterErr.malusWeight).toBe(0);
  });
});

describe('Layer 0 - Error Classification (classifyError.ts)', () => {
  it('classifies network / timeout errors when status is 0 or undefined', () => {
    const err1 = classifyError({ status: 0, message: 'Timed out' });
    expect(err1).toBeInstanceOf(NetworkError);

    const err2 = classifyError({ status: undefined, message: 'Offline' });
    expect(err2).toBeInstanceOf(NetworkError);
  });

  it('classifies 401 and 403 as AuthError', () => {
    const err401 = classifyError({ status: 401 });
    expect(err401).toBeInstanceOf(AuthError);

    const err403 = classifyError({ status: 403 });
    expect(err403).toBeInstanceOf(AuthError);
  });

  it('classifies 429 as RateLimitError and parses retryAfterHeader', () => {
    const errInSec = classifyError({ status: 429, retryAfterHeader: '10' });
    expect(errInSec).toBeInstanceOf(RateLimitError);
    expect((errInSec as RateLimitError).retryAfterMs).toBe(10000);

    const errInMs = classifyError({ status: 429, retryAfterHeader: '5000' });
    expect((errInMs as RateLimitError).retryAfterMs).toBe(5000);
  });

  it('classifies content filter / safety responses as ContentFilterError', () => {
    const err = classifyError({
      status: 200,
      body: { code: 'content_filter' },
      message: 'Moderation triggered',
    });
    expect(err).toBeInstanceOf(ContentFilterError);
  });

  it('classifies 400 and 422 as InvalidRequestError', () => {
    const err400 = classifyError({ status: 400 });
    expect(err400).toBeInstanceOf(InvalidRequestError);

    const err422 = classifyError({ status: 422 });
    expect(err422).toBeInstanceOf(InvalidRequestError);
  });

  it('classifies 5xx as ServerError', () => {
    const err500 = classifyError({ status: 500 });
    expect(err500).toBeInstanceOf(ServerError);

    const err503 = classifyError({ status: 503 });
    expect(err503).toBeInstanceOf(ServerError);
  });

  it('falls back to ServerError for unhandled HTTP status codes', () => {
    const err418 = classifyError({ status: 418, message: "I'm a teapot" });
    expect(err418).toBeInstanceOf(ServerError);
  });
});

describe('Layer 0 - ModelRegistry', () => {
  it('loads models_config.json and resolves existing model configs', () => {
    const registry = ModelRegistry.getInstance();
    expect(registry.hasModel('gemini-3.5-flash')).toBe(true);

    const config = getModelConfig('gemini-3.5-flash');
    expect(config.modelId).toBe('gemini-3.5-flash');
    expect(config.provider).toBe('gemini');
    expect(config.protocol_family).toBe('gemini-native');
    expect(config.capabilities).toBeDefined();
  });

  it('resolves anthropic model config correctly', () => {
    const config = getModelConfig('claude-4-5-sonnet-20250929');
    expect(config.modelId).toBe('claude-4-5-sonnet-20250929');
    expect(config.provider).toBe('anthropic');
    expect(config.protocol_family).toBe('anthropic-compatible');
    expect(config.header_family).toBe('x-api-key');
    expect(config.capabilities.thinking).toBe('anthropic-budget');
  });

  it('throws InvalidRequestError for unknown models', () => {
    expect(() => getModelConfig('unknown-nonexistent-model-xyz')).toThrow(InvalidRequestError);
  });

  it('lists models and gets raw config', () => {
    const registry = ModelRegistry.getInstance();
    const models = registry.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain('gemini-3.5-flash');

    const rawConfig = registry.getRawConfig();
    expect(rawConfig).toBeDefined();
    expect(typeof rawConfig).toBe('object');
  });
});

describe('Layer 0 - ExecutionLayer', () => {
  it('executes a valid request and parses response successfully', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: { content: 'Hello world from Layer 0!' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    } as Response);

    const result = await execute(
      'codestral-latest',
      {
        messages: [{ role: 'user', content: 'Hello' }],
      },
      { apiKey: DUMMY_API_KEY },
    );

    expect(result.content).toBe('Hello world from Layer 0!');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws AuthError when API key is missing', async () => {
    await expect(
      execute(
        'unknown-key-provider-test',
        { messages: [{ role: 'user', content: 'Hi' }] },
        { apiKey: '' },
      ),
    ).rejects.toThrow(Layer0Error);
  });

  it('classifies 401 error as AuthError', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid API key' } }),
    } as Response);

    await expect(
      execute(
        'codestral-latest',
        { messages: [{ role: 'user', content: 'Hi' }] },
        { apiKey: 'bad_key' },
      ),
    ).rejects.toThrow(AuthError);
  });

  it('classifies 429 error as RateLimitError', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '30' }),
      json: async () => ({ error: { message: 'Rate limit reached' } }),
    } as Response);

    try {
      await execute(
        'codestral-latest',
        { messages: [{ role: 'user', content: 'Hi' }] },
        { apiKey: DUMMY_API_KEY },
      );
      expect(true).toBe(false);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(RateLimitError);
      expect((err as RateLimitError).retryAfterMs).toBe(30000);
    }
  });

  it('classifies 500 error as ServerError', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'Internal server failure' } }),
    } as Response);

    await expect(
      execute(
        'codestral-latest',
        { messages: [{ role: 'user', content: 'Hi' }] },
        { apiKey: DUMMY_API_KEY },
      ),
    ).rejects.toThrow(ServerError);
  });

  it('classifies invalid JSON response as ServerError', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token');
      },
    } as unknown as Response);

    await expect(
      execute(
        'codestral-latest',
        { messages: [{ role: 'user', content: 'Hi' }] },
        { apiKey: DUMMY_API_KEY },
      ),
    ).rejects.toThrow(ServerError);
  });

  it('classifies timeout network error via AbortController', async () => {
    mockFetch.mockImplementation(
      (_url, init) =>
        new Promise((_, reject) => {
          const signal = (init as { signal?: AbortSignal })?.signal;
          if (signal) {
            signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        }),
    );

    await expect(
      execute(
        'codestral-latest',
        { messages: [{ role: 'user', content: 'Slow request' }] },
        { apiKey: DUMMY_API_KEY, timeoutMs: 50 },
      ),
    ).rejects.toThrow(NetworkError);
  });

  it('handles external AbortSignal pre-aborted or aborted during call', async () => {
    const externalController = new AbortController();
    externalController.abort(new Error('User cancelled request'));

    await expect(
      execute(
        'codestral-latest',
        { messages: [{ role: 'user', content: 'Cancelled' }] },
        { apiKey: DUMMY_API_KEY, signal: externalController.signal },
      ),
    ).rejects.toThrow(NetworkError);
  });
});

describe('Layer 0 - ExecutionLayer Streaming', () => {
  it('supports streaming via executeStream', async () => {
    const sseBody = new ReadableStream({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode(
            'data: {"choices":[{"delta":{"content":"Chunk 1"}}]}\n\ndata: {"choices":[{"delta":{"content":"Chunk 2"}}]}\n\ndata: [DONE]\n\n',
          ),
        );
        controller.close();
      },
    });

    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: sseBody,
    } as unknown as Response);

    const chunks: string[] = [];
    for await (const chunk of executeStream(
      'codestral-latest',
      { messages: [{ role: 'user', content: 'Stream request' }] },
      { apiKey: DUMMY_API_KEY },
    )) {
      if (chunk.content) {
        chunks.push(chunk.content);
      }
    }

    expect(chunks).toEqual(['Chunk 1', 'Chunk 2']);
  });

  it('handles streaming with empty response body', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      body: null,
    } as unknown as Response);

    const chunks = [];
    for await (const chunk of executeStream(
      'codestral-latest',
      { messages: [{ role: 'user', content: 'Empty stream' }] },
      { apiKey: DUMMY_API_KEY },
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ done: true }]);
  });

  it('handles streaming error response (non-ok HTTP status)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'Stream rate limit' } }),
    } as Response);

    const stream = executeStream(
      'codestral-latest',
      { messages: [{ role: 'user', content: 'Stream err' }] },
      { apiKey: DUMMY_API_KEY },
    );

    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).rejects.toThrow(RateLimitError);
  });

  it('delegates execution via ExecutionLayer class instance', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: 'Class instance response' }, finish_reason: 'stop' }],
      }),
    } as Response);

    const layer = new ExecutionLayer();
    const res = await layer.execute(
      'codestral-latest',
      { messages: [{ role: 'user', content: 'Hello' }] },
      { apiKey: DUMMY_API_KEY },
    );
    expect(res.content).toBe('Class instance response');

    const expRes = await executionLayer.execute(
      'codestral-latest',
      { messages: [{ role: 'user', content: 'Hello' }] },
      { apiKey: DUMMY_API_KEY },
    );
    expect(expRes.content).toBe('Class instance response');
  });
});
