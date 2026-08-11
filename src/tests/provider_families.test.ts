// src/tests/provider_families.test.ts
//
// Garde-fou filaire de l'epic « provider families » (Step 4) : fige le
// comportement URL + en-têtes + corps des familles exécutées par le
// GenericProviderAdapter (composition ProtocolFamily x HeaderFamily pilotée
// par models_config.json) AVANT la suppression des 22 adapters historiques.
//
// Les deux écarts réels identifiés lors de la rédaction de cette suite ont été
// RÉSOLUS dans le code avant la suppression des adapters historiques :
//  1. `protocol_options.extra_headers` (codestral, nvidia, openrouter) est
//     fusionné par `GenericProviderAdapter` entre `headers_extra` (niveau
//     famille) et `ProtocolFamily.extraHeaders` : les en-têtes Accept /
//     HTTP-Referer / X-OpenRouter-Title sont émis en parité filaire exacte —
//     les assertions d'en-têtes reflètent cette réalité résolue.
//  2. `familles.mistral` déclare désormais sa `base_url` historique
//     (`https://api.mistral.ai/v1`) dans models_config.json : plus aucune
//     injection de configuration dans les tests.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { GenericProviderAdapter } from '../providers/GenericProviderAdapter.js';
import { claudeCodeHeaders } from '../providers/families/headers/ClaudeCodeHeaders.js';
import { standardBearerHeaders } from '../providers/families/headers/StandardBearerHeaders.js';
import { tokenAuthHeaders } from '../providers/families/headers/TokenAuthHeaders.js';
import { xApiKeyHeaders } from '../providers/families/headers/XApiKeyHeaders.js';
import { anthropicCompatibleProtocol } from '../providers/families/protocols/AnthropicCompatibleProtocol.js';
import { openAICompatibleProtocol } from '../providers/families/protocols/OpenAICompatibleProtocol.js';
import {
  getHeaderFamily,
  getProtocolFamily,
  listHeaderFamilies,
  listProtocolFamilies,
} from '../providers/families/registry.js';
import type { AdapterChatOptions, FamilyConfig } from '../providers/types.js';

const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

const DUMMY_API_KEY = 'DUMMY_KEY';

/** Configuration réelle, lue comme le fait le chargeur du routeur. */
const HERE = dirname(fileURLToPath(import.meta.url));
const modelsConfig = JSON.parse(
  readFileSync(join(HERE, '..', 'config', 'models_config.json'), 'utf-8'),
) as { familles: Record<string, Record<string, unknown>> };

/**
 * Construit la `FamilyConfig` de test depuis `familles.<nom>` RÉEL du JSON,
 * augmentée des surcharges éventuelles propres à un scénario donné.
 */
function realFamilyConfig(name: string, overrides?: Record<string, unknown>): FamilyConfig {
  if (!Object.hasOwn(modelsConfig.familles, name)) {
    throw new Error(`famille inconnue dans models_config.json: ${name}`);
  }
  const entry = Reflect.get(modelsConfig.familles, name) as Record<string, unknown>;
  return { ...entry, ...overrides } as FamilyConfig;
}

/** Réponse HTTP 200 standard du dialecte openai-compatible. */
function okJsonResponse(data: unknown): Response {
  return { ok: true, json: async () => data } as Partial<Response> as Response;
}

function okOpenAIResponse(
  message: Record<string, unknown>,
  finishReason: string = 'stop',
): Response {
  return okJsonResponse({ choices: [{ message, finish_reason: finishReason }] });
}

interface CapturedCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** Relit le dernier appel fetch capturé (URL, en-têtes, corps désérialisé). */
function capturedCall(index: number = 0): CapturedCall {
  const call = mockFetch.mock.calls.at(index);
  if (call === undefined) {
    throw new Error('Assertion impossible : mockFetch n a pas été appelé.');
  }
  const init = call[1] as { headers: Record<string, string>; body: string };
  return {
    url: String(call[0]),
    headers: init.headers,
    body: JSON.parse(init.body) as Record<string, unknown>,
  };
}

describe('A. Moteur openai-compatible via GenericProviderAdapter (cerebras/codestral/mistral)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(okOpenAIResponse({ content: 'ok' }));
  });

  it('A.1 cerebras (clone pur) : URL, en-têtes Bearer, corps minimal sans temperature/max_tokens', async () => {
    const adapter = new GenericProviderAdapter('cerebras', realFamilyConfig('cerebras'));
    const result = await adapter.chat([{ role: 'user', content: 'bonjour cerebras' }], {
      model: 'llama-3.3-70b',
      apiKey: DUMMY_API_KEY,
    });

    const call = capturedCall();
    expect(call.url).toBe('https://api.cerebras.ai/v1/chat/completions');
    expect(call.headers).toEqual({
      Authorization: `Bearer ${DUMMY_API_KEY}`,
      'Content-Type': 'application/json',
    });
    expect(call.body).toEqual({
      model: 'llama-3.3-70b',
      messages: [{ role: 'user', content: 'bonjour cerebras' }],
    });
    expect(call.body).not.toHaveProperty('temperature');
    expect(call.body).not.toHaveProperty('max_tokens');
    expect(result.content).toBe('ok');
  });

  it('A.2 codestral : safe_prompt:false, défaut 8192, en-têtes Bearer + Accept (extra_headers fusionné)', async () => {
    const adapter = new GenericProviderAdapter('codestral', realFamilyConfig('codestral'));
    const result = await adapter.chat([{ role: 'user', content: 'écris une fonction' }], {
      model: 'codestral-latest',
      apiKey: DUMMY_API_KEY,
    });

    const call = capturedCall();
    expect(call.url).toBe('https://codestral.mistral.ai/v1/chat/completions');
    // Parité filaire de l'adapter historique : `protocol_options.extra_headers`
    // .Accept est fusionné entre headers_extra et l'empreinte du protocole.
    expect(call.headers).toEqual({
      Authorization: `Bearer ${DUMMY_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    expect(call.body['safe_prompt']).toBe(false);
    expect(call.body['max_tokens']).toBe(8192);
    expect(call.body).not.toHaveProperty('temperature');
    expect(result.content).toBe('ok');
  });

  it('A.3 codestral : sanitisation — message assistant contenu+tool_calls éclaté, ID réécrit 9 alphanum', async () => {
    const adapter = new GenericProviderAdapter('codestral', realFamilyConfig('codestral'));
    await adapter.chat(
      [
        {
          role: 'assistant',
          content: 'je calcule',
          tool_calls: [
            {
              id: 'call_abc_123',
              type: 'function',
              function: { name: 'add', arguments: '{"a":1}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call_abc_123', name: 'add', content: '2' },
      ],
      { model: 'codestral-latest', apiKey: DUMMY_API_KEY },
    );

    const call = capturedCall();
    const messages = call.body['messages'] as Record<string, unknown>[];
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({ role: 'assistant', content: 'je calcule' });

    expect(messages[1]?.['role']).toBe('assistant');
    expect(messages[1]?.['content']).toBeNull();
    const toolCalls = messages[1]?.['tool_calls'] as Record<string, unknown>[];
    expect(toolCalls).toHaveLength(1);
    const rewrittenId = toolCalls[0]?.['id'] as string;
    expect(rewrittenId).toHaveLength(9);
    expect(rewrittenId).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(rewrittenId).not.toBe('call_abc_123');
    expect(toolCalls[0]?.['type']).toBe('function');
    expect(toolCalls[0]?.['function']).toEqual({ name: 'add', arguments: '{"a":1}' });

    // La réponse outil est réalignée sur l'ID réécrit.
    expect(messages[2]?.['role']).toBe('tool');
    expect(messages[2]?.['tool_call_id']).toBe(rewrittenId);
  });

  it('A.4 mistral : safe_prompt:true, défaut 1000 (base_url native du JSON)', async () => {
    const adapter = new GenericProviderAdapter('mistral', realFamilyConfig('mistral'));
    const result = await adapter.chat([{ role: 'user', content: 'bonjour mistral' }], {
      model: 'mistral-large-latest',
      apiKey: DUMMY_API_KEY,
    });

    const call = capturedCall();
    expect(call.url).toBe('https://api.mistral.ai/v1/chat/completions');
    expect(call.headers).toEqual({
      Authorization: `Bearer ${DUMMY_API_KEY}`,
      'Content-Type': 'application/json',
    });
    expect(call.body['safe_prompt']).toBe(true);
    expect(call.body['max_tokens']).toBe(1000);
    expect(result.content).toBe('ok');
  });

  it('A.5 mistral : sanitisation identique à codestral (éclatement + ID conforme)', async () => {
    const adapter = new GenericProviderAdapter('mistral', realFamilyConfig('mistral'));
    await adapter.chat(
      [
        {
          role: 'assistant',
          content: 'je regarde',
          tool_calls: [
            {
              id: 'toolu-long-non-conforme',
              type: 'function',
              function: { name: 'lookup', arguments: '{}' },
            },
          ],
        },
      ],
      { model: 'mistral-large-latest', apiKey: DUMMY_API_KEY },
    );

    const call = capturedCall();
    const messages = call.body['messages'] as Record<string, unknown>[];
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: 'assistant', content: 'je regarde' });
    expect(messages[1]?.['content']).toBeNull();
    const toolCalls = messages[1]?.['tool_calls'] as Record<string, unknown>[];
    expect(toolCalls[0]?.['id']).toMatch(/^[a-zA-Z0-9]{9}$/);
    expect(toolCalls[0]?.['id']).not.toBe('toolu-long-non-conforme');
  });
});

describe('A (suite). Moteur openai-compatible via GenericProviderAdapter (kimi/moonshot/github/novita)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(okOpenAIResponse({ content: 'ok' }));
  });

  it('A.6 kimi : empreinte claude-code via headers_extra, stream:false, retransmission reasoning_content', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      okOpenAIResponse({ content: 'ok', reasoning_content: 'chaîne sortante' }),
    );

    const adapter = new GenericProviderAdapter('kimi', realFamilyConfig('kimi'));
    const result = await adapter.chat(
      [
        { role: 'user', content: 'continue' },
        { role: 'assistant', content: 'réponse partielle', reasoning_content: 'chaîne entrante' },
      ],
      { model: 'kimi-for-coding', apiKey: DUMMY_API_KEY },
    );

    const call = capturedCall();
    expect(call.url).toBe('https://api.kimi.com/coding/v1/chat/completions');
    expect(call.headers).toEqual({
      Authorization: `Bearer ${DUMMY_API_KEY}`,
      'Content-Type': 'application/json',
      'User-Agent': 'claude-code/1.0.0',
      'X-Client-Name': 'claude-code',
    });
    expect(call.body['stream']).toBe(false);
    expect(call.body['max_tokens']).toBe(8192);
    expect(call.body['messages']).toEqual([
      { role: 'user', content: 'continue' },
      { role: 'assistant', content: 'réponse partielle', reasoning_content: 'chaîne entrante' },
    ]);
    expect(result.reasoningContent).toBe('chaîne sortante');
  });

  it('A.7 moonshot : messages réduits à {role, content} (tool_calls entrants perdus), tool_choice auto', async () => {
    const adapter = new GenericProviderAdapter('moonshot', realFamilyConfig('moonshot'));
    await adapter.chat(
      [
        { role: 'user', content: 'salut' },
        {
          role: 'assistant',
          content: 'réponse précédente',
          tool_calls: [
            {
              id: 'call_perdu',
              type: 'function',
              function: { name: 'perdu', arguments: '{}' },
            },
          ],
        },
      ],
      { model: 'moonshot-v1-8k', apiKey: DUMMY_API_KEY },
    );

    const call = capturedCall();
    expect(call.url).toBe('https://api.moonshot.ai/v1/chat/completions');
    expect(call.body['messages']).toEqual([
      { role: 'user', content: 'salut' },
      { role: 'assistant', content: 'réponse précédente' },
    ]);
    expect(call.body['stream']).toBe(false);
    expect(call.body['tool_choice']).toBe('auto');
    expect(call.body['max_tokens']).toBe(8192);
  });

  it('A.8 github : tool_choice "auto" émis AVEC tools quand le modèle débute par gpt', async () => {
    const adapter = new GenericProviderAdapter('github', realFamilyConfig('github'));
    await adapter.chat([{ role: 'user', content: 'ping' }], {
      model: 'gpt-x',
      apiKey: DUMMY_API_KEY,
      tools: [
        {
          type: 'function',
          function: { name: 'ping', description: 'Ping', parameters: { type: 'object' } },
        },
      ],
    });

    const call = capturedCall();
    expect(call.body['tools']).toEqual([
      {
        type: 'function',
        function: { name: 'ping', description: 'Ping', parameters: { type: 'object' } },
      },
    ]);
    expect(call.body['tool_choice']).toBe('auto');
    expect(call.body['messages']).toEqual([{ role: 'user', content: 'ping' }]);
  });

  it('A.9 github : tool_choice absent pour un modèle phi (politique gpt-only)', async () => {
    const adapter = new GenericProviderAdapter('github', realFamilyConfig('github'));
    await adapter.chat([{ role: 'user', content: 'ping' }], {
      model: 'phi',
      apiKey: DUMMY_API_KEY,
      tools: [
        {
          type: 'function',
          function: { name: 'ping', description: 'Ping', parameters: { type: 'object' } },
        },
      ],
    });

    const call = capturedCall();
    expect(call.body['tools']).toBeDefined();
    expect(call.body).not.toHaveProperty('tool_choice');
  });

  it('A.10 novita : URL api.novita.ai/v3/openai/chat/completions exacte', async () => {
    const adapter = new GenericProviderAdapter('novita', realFamilyConfig('novita'));
    const result = await adapter.chat([{ role: 'user', content: 'salut' }], {
      model: 'deepseek/deepseek-v4-pro',
      apiKey: DUMMY_API_KEY,
    });

    const call = capturedCall();
    expect(call.url).toBe('https://api.novita.ai/v3/openai/chat/completions');
    expect(result.content).toBe('ok');
  });
});

describe('A (fin). Moteur openai-compatible via GenericProviderAdapter (nvidia/openrouter/nlpcloud/opencodezen)', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(okOpenAIResponse({ content: 'ok' }));
  });

  it('A.11 nvidia : temperature 1.0 par défaut, passthrough top_p + chat_template_kwargs, stream:false, reasoning exposé', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      okOpenAIResponse({ content: 'ok', reasoning_content: 'raison nvidia' }),
    );

    const adapter = new GenericProviderAdapter('nvidia', realFamilyConfig('nvidia'));
    const result = await adapter.chat([{ role: 'user', content: 'salut' }], {
      model: 'moonshotai/kimi-k2.6',
      apiKey: DUMMY_API_KEY,
      top_p: 0.9,
      chat_template_kwargs: { enable_thinking: true },
    });

    const call = capturedCall();
    expect(call.url).toBe('https://integrate.api.nvidia.com/v1/chat/completions');
    expect(call.headers).toEqual({
      Authorization: `Bearer ${DUMMY_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
    expect(call.body).toEqual({
      model: 'moonshotai/kimi-k2.6',
      messages: [{ role: 'user', content: 'salut' }],
      temperature: 1.0,
      stream: false,
      top_p: 0.9,
      chat_template_kwargs: { enable_thinking: true },
    });
    expect(result.reasoningContent).toBe('raison nvidia');
  });

  it('A.12 openrouter : passthrough reasoning, extraction reasoning, triplet extra_headers émis', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      okOpenAIResponse({ content: 'ok', reasoning: 'raison openrouter' }),
    );

    const adapter = new GenericProviderAdapter('openrouter', realFamilyConfig('openrouter'));
    const result = await adapter.chat([{ role: 'user', content: 'salut' }], {
      model: 'minimax/minimax-m2.5:free',
      apiKey: DUMMY_API_KEY,
      reasoning: { effort: 'high' },
    });

    const call = capturedCall();
    expect(call.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    // Accept + HTTP-Referer + X-OpenRouter-Title de l'adapter historique sont
    // déclarés sous `protocol_options.extra_headers` et fusionnés par
    // l'adapter générique (parité filaire exacte).
    expect(call.headers).toEqual({
      Authorization: `Bearer ${DUMMY_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'HTTP-Referer': 'https://hive-mind.app',
      'X-OpenRouter-Title': 'HIVE-MIND Agent',
    });
    expect(call.body['reasoning']).toEqual({ effort: 'high' });
    expect(call.body['stream']).toBe(false);
    expect(result.reasoningContent).toBe('raison openrouter');
  });

  it('A.13 nlpcloud : Authorization "Token" (header_family standard-token, PAS Bearer)', async () => {
    const adapter = new GenericProviderAdapter('nlpcloud', realFamilyConfig('nlpcloud'));
    await adapter.chat([{ role: 'user', content: 'salut' }], {
      model: 'meta-llama/llama-3.3-70b-instruct',
      apiKey: DUMMY_API_KEY,
    });

    const call = capturedCall();
    expect(call.url).toBe('https://api.nlpcloud.io/v1/chat/completions');
    expect(call.headers).toEqual({
      Authorization: `Token ${DUMMY_API_KEY}`,
      'Content-Type': 'application/json',
    });
  });

  it('A.14 opencodezen : URL api.opencode.ai/v1/chat/completions exacte', async () => {
    const adapter = new GenericProviderAdapter('opencodezen', realFamilyConfig('opencodezen'));
    const result = await adapter.chat([{ role: 'user', content: 'salut' }], {
      model: 'deepseek-v4-flash-free',
      apiKey: DUMMY_API_KEY,
    });

    const call = capturedCall();
    expect(call.url).toBe('https://api.opencode.ai/v1/chat/completions');
    expect(result.content).toBe('ok');
  });
});

describe('B. Moteur anthropic-compatible via GenericProviderAdapter', () => {
  const anthropicFamilyConfig = {
    base_url: 'https://api.anthropic.example/v1',
    protocol_family: 'anthropic-compatible',
    header_family: 'x-api-key',
  } as FamilyConfig;

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      okJsonResponse({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 2 },
      }),
    );
  });

  it('B.1 en-têtes : x-api-key + anthropic-version 2023-06-01 + Content-Type, AUCUN Authorization', async () => {
    const adapter = new GenericProviderAdapter('anthropic-test', anthropicFamilyConfig);
    await adapter.chat([{ role: 'user', content: 'bonjour' }], {
      model: 'claude-test',
      apiKey: DUMMY_API_KEY,
    });

    const call = capturedCall();
    expect(call.url).toBe('https://api.anthropic.example/v1/messages');
    expect(call.headers).toEqual({
      'x-api-key': DUMMY_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    });
  });

  it('B.2 corps : system extrait (retiré de messages), max_tokens 4096 par défaut puis explicite, tools en input_schema', async () => {
    const adapter = new GenericProviderAdapter('anthropic-test', anthropicFamilyConfig);
    await adapter.chat(
      [
        { role: 'system', content: 'Tu es utile.' },
        { role: 'user', content: 'Bonjour' },
      ],
      {
        model: 'claude-test',
        apiKey: DUMMY_API_KEY,
        tools: [
          {
            type: 'function',
            function: {
              name: 'get_time',
              description: 'Donne l heure',
              parameters: { type: 'object', properties: { tz: { type: 'string' } } },
            },
          },
        ],
      },
    );

    const first = capturedCall(0);
    expect(first.body['system']).toBe('Tu es utile.');
    expect(first.body['messages']).toEqual([{ role: 'user', content: 'Bonjour' }]);
    expect(first.body['max_tokens']).toBe(4096);
    expect(first.body['tools']).toEqual([
      {
        name: 'get_time',
        description: 'Donne l heure',
        input_schema: { type: 'object', properties: { tz: { type: 'string' } } },
      },
    ]);

    await adapter.chat([{ role: 'user', content: 'Bonjour' }], {
      model: 'claude-test',
      apiKey: DUMMY_API_KEY,
      max_tokens: 123,
    });
    expect(capturedCall(1).body['max_tokens']).toBe(123);
    // Sans message system, le champ system est la chaîne vide (comportement historique).
    expect(capturedCall(1).body['system']).toBe('');
  });

  it('B.3 réponse : blocs text + tool_use -> AdapterChatResult (arguments JSON, usage dérivé, finishReason)', async () => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(
      okJsonResponse({
        content: [
          { type: 'text', text: 'je vais appeler un outil' },
          { type: 'tool_use', id: 'toolu_1', name: 'get_time', input: { tz: 'UTC' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 12, output_tokens: 7 },
      }),
    );

    const adapter = new GenericProviderAdapter('anthropic-test', anthropicFamilyConfig);
    const result = await adapter.chat([{ role: 'user', content: 'bonjour' }], {
      model: 'claude-test',
      apiKey: DUMMY_API_KEY,
    });

    expect(result.content).toBe('je vais appeler un outil');
    expect(result.toolCalls).toEqual([
      {
        id: 'toolu_1',
        type: 'function',
        function: { name: 'get_time', arguments: '{"tz":"UTC"}' },
      },
    ]);
    expect(result.usage).toEqual({ prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 });
    expect(result.finishReason).toBe('tool_use');
  });

  it('B.4 wireParams thinking {type: enabled, budget_tokens: 1024} fusionné dans le corps', async () => {
    const adapter = new GenericProviderAdapter('anthropic-test', anthropicFamilyConfig);
    await adapter.chat([{ role: 'user', content: 'réfléchis' }], {
      model: 'claude-test',
      apiKey: DUMMY_API_KEY,
      wireParams: { thinking: { type: 'enabled', budget_tokens: 1024 } },
    });

    const call = capturedCall();
    expect(call.body['thinking']).toEqual({ type: 'enabled', budget_tokens: 1024 });
    expect(call.url).toBe('https://api.anthropic.example/v1/messages');
  });
});

describe('C. HeaderFamily unitaires', () => {
  it('C.1 standard-bearer : Bearer + Content-Type, fusion headers_extra de familyConfig', () => {
    expect(standardBearerHeaders.buildHeaders('KEY')).toEqual({
      Authorization: 'Bearer KEY',
      'Content-Type': 'application/json',
    });
    expect(
      standardBearerHeaders.buildHeaders('KEY', {
        familyConfig: { headers_extra: { 'X-Famille': 'oui' } } as FamilyConfig,
      }),
    ).toEqual({
      Authorization: 'Bearer KEY',
      'Content-Type': 'application/json',
      'X-Famille': 'oui',
    });
  });

  it('C.2 standard-token : schéma Token (nlpcloud)', () => {
    expect(tokenAuthHeaders.buildHeaders('KEY')).toEqual({
      Authorization: 'Token KEY',
      'Content-Type': 'application/json',
    });
  });

  it('C.3 x-api-key : schéma natif Anthropic sans Authorization', () => {
    expect(xApiKeyHeaders.buildHeaders('KEY')).toEqual({
      'x-api-key': 'KEY',
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    });
  });

  it('C.4 claude-code : version via ctx.options.version, en-têtes Stainless, anthropic-beta joint', () => {
    const headers = claudeCodeHeaders.buildHeaders('KEY', {
      options: {
        version: '1.2.3',
        anthropic_beta: [
          'interleaved-thinking-2025-05-14',
          'fine-grained-tool-streaming-2025-05-14',
        ],
      } as AdapterChatOptions,
    });
    expect(headers).toEqual({
      Authorization: 'Bearer KEY',
      'Content-Type': 'application/json',
      'User-Agent': 'claude-cli/1.2.3 (external, cli)',
      'x-app': 'cli',
      'X-Stainless-Lang': 'js',
      'X-Stainless-Package-Version': '1.2.3',
      'X-Stainless-OS': process.platform,
      'X-Stainless-Arch': process.arch,
      'X-Stainless-Runtime': 'node',
      'X-Stainless-Runtime-Version': process.version,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
    });
  });

  it('C.5 claude-code : défauts (version 1.0.0, anthropic-beta omis)', () => {
    const headers = claudeCodeHeaders.buildHeaders('KEY');
    expect(headers['User-Agent']).toBe('claude-cli/1.0.0 (external, cli)');
    expect(headers['X-Stainless-Package-Version']).toBe('1.0.0');
    expect(headers['X-Stainless-OS']).toBe(process.platform);
    expect(headers['X-Stainless-Runtime']).toBe('node');
    expect(headers).not.toHaveProperty('anthropic-beta');
  });
});

describe('D. Registry fail-closed', () => {
  it('D.1 getProtocolFamily(inconnu) lève une erreur nommée', () => {
    expect(() => getProtocolFamily('inconnu')).toThrow('ProtocolFamily inconnue: inconnu');
  });

  it('D.2 getHeaderFamily(inconnu) lève une erreur nommée', () => {
    expect(() => getHeaderFamily('inconnu')).toThrow('HeaderFamily inconnue: inconnu');
  });

  it('D.3 listProtocolFamilies : contenu exact (2 moteurs, ordre d enregistrement)', () => {
    expect(listProtocolFamilies()).toEqual(['openai-compatible', 'anthropic-compatible']);
    expect(getProtocolFamily('openai-compatible')).toBe(openAICompatibleProtocol);
    expect(getProtocolFamily('anthropic-compatible')).toBe(anthropicCompatibleProtocol);
  });

  it('D.4 listHeaderFamilies : contenu exact (4 moteurs, ordre d enregistrement)', () => {
    expect(listHeaderFamilies()).toEqual([
      'standard-bearer',
      'standard-token',
      'x-api-key',
      'claude-code',
    ]);
    expect(getHeaderFamily('standard-bearer')).toBe(standardBearerHeaders);
    expect(getHeaderFamily('standard-token')).toBe(tokenAuthHeaders);
    expect(getHeaderFamily('x-api-key')).toBe(xApiKeyHeaders);
    expect(getHeaderFamily('claude-code')).toBe(claudeCodeHeaders);
  });
});

describe('E. GenericProviderAdapter défensif', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('E.1 familyConfig sans protocol_family : rejet nommé, aucune requête émise', async () => {
    const adapter = new GenericProviderAdapter('sans-proto', {
      base_url: 'https://api.exemple.test/v1',
    } as FamilyConfig);
    await expect(
      adapter.chat([{ role: 'user', content: 'x' }], { model: 'm', apiKey: DUMMY_API_KEY }),
    ).rejects.toThrow('protocol_family manquant');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('E.2 apiKey vide : rejet explicite, aucune requête émise', async () => {
    const adapter = new GenericProviderAdapter('cerebras', realFamilyConfig('cerebras'));
    await expect(
      adapter.chat([{ role: 'user', content: 'x' }], { model: 'llama-3.3-70b', apiKey: '' }),
    ).rejects.toThrow('API key manquante');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('E.3 HTTP 429 : erreur rejetée contenant le statut (classification quota routeur)', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: 'too many requests' } }),
    } as Partial<Response> as Response);

    const adapter = new GenericProviderAdapter('cerebras', realFamilyConfig('cerebras'));
    await expect(
      adapter.chat([{ role: 'user', content: 'x' }], {
        model: 'llama-3.3-70b',
        apiKey: DUMMY_API_KEY,
      }),
    ).rejects.toThrow(/429/);
    await expect(
      adapter.chat([{ role: 'user', content: 'x' }], {
        model: 'llama-3.3-70b',
        apiKey: DUMMY_API_KEY,
      }),
    ).rejects.toThrow(/too many requests/);
  });

  it('E.4 timeout : protocol_options.timeout_ms 5 + fetch jamais résolu -> rejet "Délai dépassé"', async () => {
    mockFetch.mockImplementation(
      (...args: Parameters<typeof fetch>) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = args[1]?.signal;
          signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        }),
    );

    const config = realFamilyConfig('cerebras', {
      protocol_options: { timeout_ms: 5 },
    });
    const adapter = new GenericProviderAdapter('cerebras-timeout', config);
    await expect(
      adapter.chat([{ role: 'user', content: 'x' }], {
        model: 'llama-3.3-70b',
        apiKey: DUMMY_API_KEY,
      }),
    ).rejects.toThrow('Délai dépassé');
  });
});

describe('F. wireParams : précédence et allowlist', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(okOpenAIResponse({ content: 'ok' }));
  });

  it('F.1 le wire gagne en dernier sur une clé allowlistée (temperature)', async () => {
    const config = {
      base_url: 'https://api.wire.example/v1',
      protocol_family: 'openai-compatible',
      protocol_options: { extra_body: { temperature: 0.9 } },
    } as FamilyConfig;
    const adapter = new GenericProviderAdapter('wire-temperature', config);
    await adapter.chat([{ role: 'user', content: 'x' }], {
      model: 'm',
      apiKey: DUMMY_API_KEY,
      wireParams: { temperature: 0.123 },
    });

    expect(capturedCall().body['temperature']).toBeCloseTo(0.123, 5);
  });

  it('F.2 cas littéral du plan (stream) : clé hors allowlist wireParamKeys -> extra_body conservé (figé)', async () => {
    const config = {
      base_url: 'https://api.wire.example/v1',
      protocol_family: 'openai-compatible',
      protocol_options: { extra_body: { stream: true } },
    } as FamilyConfig;
    const adapter = new GenericProviderAdapter('wire-stream', config);
    await adapter.chat([{ role: 'user', content: 'x' }], {
      model: 'm',
      apiKey: DUMMY_API_KEY,
      wireParams: { stream: false },
    });

    // 'stream' n'est pas dans wireParamKeys de l'openai-compatible
    // (temperature, max_tokens, max_completion_tokens, reasoning_effort) :
    // mergeWireParams la filtre, extra_body fait foi.
    expect(capturedCall().body['stream']).toBe(true);
  });
});
