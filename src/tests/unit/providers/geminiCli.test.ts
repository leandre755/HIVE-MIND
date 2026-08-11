// tests/unit/providers/geminiCli.test.ts

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { chat as geminiCliChat } from '../../../providers/adapters/geminiCli.js';

// Mock du fetch global
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('Gemini CLI Provider Adapter', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    process.env.GEMINI_CLI_ACCESS_TOKEN = '';
    process.env.GEMINI_CLI_REFRESH_TOKEN = 'dummy_gemini_cli_refresh';
    process.env.GE_DEFAULT_PROJECT_ID = 'dummy_gemini_cli_project';
  });

  it('should successfully call chat with correct parameters and thought signature bypass', async () => {
    const mockAccessToken =
      'header.' +
      Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
        'base64',
      ) +
      '.signature';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: mockAccessToken,
        refresh_token: 'new_gemini_cli_refresh',
      }),
    } as Partial<Response> as Response);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: {
          candidates: [
            {
              content: {
                parts: [
                  { text: 'Hello from Gemini CLI!' },
                  { thought: 'Reasoning deep...' },
                  {
                    functionCall: {
                      name: 'test_tool_cli',
                      args: { val: 'cli_test' },
                    },
                    thoughtSignature: 'skip_thought_signature_validator',
                  },
                ],
              },
              finishReason: 'stop',
            },
          ],
          usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 25 },
        },
      }),
    } as Partial<Response> as Response);

    const messages = [
      { role: 'system', content: 'You are Gemini CLI.' },
      { role: 'user', content: 'Hello' },
    ];

    const options = {
      model: 'gemini-3.1-pro-preview',
      temperature: 0.7,
      tools: [
        {
          function: {
            name: 'test_tool_cli',
            description: 'A test tool for CLI',
            parameters: {
              type: 'object',
              properties: {
                val: { type: 'string', description: 'value' },
              },
              required: ['val'],
            },
          },
        },
      ],
    };

    const result = await geminiCliChat(messages, options);

    expect(result.content).toBe('Hello from Gemini CLI!');
    expect(result.thought).toBe('Reasoning deep...');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].function.name).toBe('test_tool_cli');

    // Validation que fetch a bien été appelé deux fois
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Validation des arguments de l'appel generateContent
    const lastCallArgs = mockFetch.mock.calls[1] as [string, RequestInit];
    const bodyParsed = JSON.parse(String(lastCallArgs[1].body));
    expect(bodyParsed.model).toBe('gemini-3.1-pro-preview');
    expect(bodyParsed.request.tools[0].functionDeclarations[0].parameters.type).toBe('OBJECT');
    expect(bodyParsed.request.tools[0].functionDeclarations[0].parameters.properties.val.type).toBe(
      'STRING',
    );
  });

  it('should throw an error when token refresh fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Invalid Grant',
    } as Partial<Response> as Response);

    await expect(
      geminiCliChat([{ role: 'user', content: 'Hello' }], {
        model: 'gemini-3.1-pro-preview',
      }),
    ).rejects.toThrow('Google OAuth refresh failed');

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
