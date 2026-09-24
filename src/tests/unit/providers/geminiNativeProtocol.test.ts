// tests/unit/providers/geminiNativeProtocol.test.ts
// Issue #37 — le dialecte `gemini-native` doit être résolu par le registre des
// familles (au lieu d'être rejeté par ExecutionLayer) et reproduire fidèlement
// l'API REST native Google : generateContent, contents/parts, systemInstruction,
// functionDeclarations, usageMetadata.
import { describe, it, expect } from '@jest/globals';
import { getHeaderFamily, getProtocolFamily } from '../../../providers/families/registry.js';
import { geminiNativeProtocol } from '../../../providers/families/protocols/GeminiNativeProtocol.js';
import type { ProtocolContext } from '../../../providers/families/types.js';

function makeCtx(overrides: Partial<ProtocolContext> = {}): ProtocolContext {
  return {
    model: 'gemini-2.5-flash',
    apiKey: 'test-key',
    messages: [{ role: 'user', content: 'Bonjour' }],
    options: { model: 'gemini-2.5-flash', apiKey: 'test-key' },
    familyConfig: { base_url: 'https://generativelanguage.googleapis.com/' },
    ...overrides,
  };
}

describe('registre — résolution gemini-native (#37)', () => {
  it('résout la famille de protocole sans la rejeter', () => {
    const protocol = getProtocolFamily('gemini-native');
    expect(protocol.name).toBe('gemini-native');
    expect(protocol).toBe(geminiNativeProtocol);
    expect(protocol.supportsTools).toBe(true);
  });

  it('résout le moteur d en-têtes natif Google', () => {
    const headers = getHeaderFamily('x-goog-api-key').buildHeaders('secret-key');
    expect(headers['x-goog-api-key']).toBe('secret-key');
    expect(headers['Content-Type']).toBe('application/json');
    expect(headers.Authorization).toBeUndefined();
  });
});

describe('GeminiNativeProtocol — construction de requête', () => {
  it('construit les URLs generateContent et streamGenerateContent?alt=sse', () => {
    const ctx = makeCtx();
    expect(geminiNativeProtocol.buildUrl(ctx)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
    );
    expect(geminiNativeProtocol.buildStreamUrl?.(ctx)).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
    );
    expect(geminiNativeProtocol.streamUsesBodyFlag).toBe(false);
  });

  it('lève une erreur explicite sans base_url (fail-closed)', () => {
    const ctx = makeCtx({ familyConfig: undefined });
    expect(() => geminiNativeProtocol.buildUrl(ctx)).toThrow(/base_url absente/);
  });

  it('projette system/user/assistant/tool en contents + systemInstruction', () => {
    const ctx = makeCtx({
      messages: [
        { role: 'system', content: 'Tu es Hive.' },
        { role: 'user', content: 'Salut' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"a"}' },
            },
          ],
        },
        { role: 'tool', name: 'read_file', tool_call_id: 'call_1', content: 'contenu du fichier' },
      ],
      options: {
        model: 'gemini-2.5-flash',
        apiKey: 'test-key',
        temperature: 0.4,
        max_tokens: 512,
        tools: [
          {
            type: 'function',
            function: {
              name: 'read_file',
              description: 'Lit un fichier',
              parameters: { type: 'object', properties: { path: { type: 'string' } } },
            },
          },
        ],
      },
      wireParams: { thinkingConfig: { thinkingBudget: 1024 } },
    });

    const body = geminiNativeProtocol.buildBody(ctx);

    expect(body.systemInstruction).toEqual({ parts: [{ text: 'Tu es Hive.' }] });
    const contents = body.contents as Array<{
      role: string;
      parts: Array<Record<string, unknown>>;
    }>;
    expect(contents).toHaveLength(3);
    expect(contents[0]).toEqual({ role: 'user', parts: [{ text: 'Salut' }] });
    expect(contents[1].role).toBe('model');
    expect(contents[1].parts[0].functionCall).toEqual({
      id: 'call_1',
      name: 'read_file',
      args: { path: 'a' },
    });
    expect(contents[2].parts[0].functionResponse).toEqual({
      id: 'call_1',
      name: 'read_file',
      response: { content: 'contenu du fichier' },
    });

    expect(body.generationConfig).toEqual({
      thinkingConfig: { thinkingBudget: 1024 },
      temperature: 0.4,
      maxOutputTokens: 512,
    });

    const tools = body.tools as Array<{ functionDeclarations: Array<{ name: string }> }>;
    expect(tools[0].functionDeclarations[0].name).toBe('read_file');
    expect(body.toolConfig).toEqual({ functionCallingConfig: { mode: 'AUTO' } });
  });

  it('mappe les data URI images en inlineData et les URLs en fileData', () => {
    const ctx = makeCtx({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Que vois-tu ?' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
            { type: 'image_url', image_url: { url: 'https://example.com/img.png' } },
          ],
        },
      ],
    });

    const contents = geminiNativeProtocol.buildBody(ctx).contents as Array<{
      parts: Array<Record<string, unknown>>;
    }>;
    expect(contents[0].parts).toEqual([
      { text: 'Que vois-tu ?' },
      { inlineData: { mimeType: 'image/png', data: 'QUJD' } },
      { fileData: { fileUri: 'https://example.com/img.png' } },
    ]);
  });
});

describe('GeminiNativeProtocol — lecture de réponse', () => {
  it('concatène les textes, convertit functionCall et mappe usageMetadata', () => {
    const result = geminiNativeProtocol.parseResponse(
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'Voici ' },
                { text: 'le résultat.' },
                { functionCall: { name: 'write_file', args: { path: 'out.md' } } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 34,
          totalTokenCount: 46,
        },
      },
      makeCtx(),
    );

    expect(result.content).toBe('Voici le résultat.');
    expect(result.finishReason).toBe('STOP');
    expect(result.usage).toEqual({
      prompt_tokens: 12,
      completion_tokens: 34,
      total_tokens: 46,
    });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls?.[0].function.name).toBe('write_file');
    expect(result.toolCalls?.[0].function.arguments).toBe('{"path":"out.md"}');
  });

  it('échoue explicitement sur charge invalide ou candidats absents', () => {
    expect(() => geminiNativeProtocol.parseResponse('pas un objet', makeCtx())).toThrow(
      /objet JSON attendu/,
    );
    expect(() => geminiNativeProtocol.parseResponse({ candidates: [] }, makeCtx())).toThrow(
      /aucun "candidate"/,
    );
    expect(() => geminiNativeProtocol.parseResponse({ candidates: [{}] }, makeCtx())).toThrow(
      /"content" absent/,
    );
  });

  it('relève le statut HTTP dans les erreurs (pattern quota 429)', () => {
    expect(() =>
      geminiNativeProtocol.parseError(
        { error: { code: 429, message: 'Quota exceeded', status: 'RESOURCE_EXHAUSTED' } },
        429,
      ),
    ).toThrow(/Erreur HTTP 429 : Quota exceeded/);
  });
});
