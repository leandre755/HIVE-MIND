// tests/unit/providers/antigravity.test.ts

import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockImpersonatedRequest = jest.fn() as jest.MockedFunction<typeof fetch>;

jest.unstable_mockModule('../../../utils/TlsImpersonator.js', () => ({
  impersonatedRequest: mockImpersonatedRequest,
  getImpersonatedAgent: jest.fn(),
}));

// Mock du simulateur Clearcut pour éviter tout appel réseau d'analytics durant les tests
jest.unstable_mockModule('../../../services/telemetry/ClearcutSimulator.js', () => ({
  ClearcutSimulator: {
    trackStartSession: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
    trackNewPrompt: jest.fn<(promptId: string) => Promise<boolean>>().mockResolvedValue(true),
    trackToolCall: jest
      .fn<(toolName: string, success: boolean) => Promise<boolean>>()
      .mockResolvedValue(true),
  },
}));

const { default: antigravityAdapter } = await import('../../../providers/adapters/antigravity.js');

describe('Antigravity Provider Adapter', () => {
  beforeEach(() => {
    mockImpersonatedRequest.mockReset();
    process.env.ANTIGRAVITY_ACCESS_TOKEN = '';
    process.env.ANTIGRAVITY_REFRESH_TOKEN = 'dummy_refresh_token';
    process.env.ANTIGRAVITY_PROJECT_ID = 'dummy_project_id';
  });

  it('should successfully call chat with correct parameters and thought signature bypass', async () => {
    const mockAccessToken =
      'header.' +
      Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString(
        'base64',
      ) +
      '.signature';

    mockImpersonatedRequest.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: mockAccessToken, refresh_token: 'new_refresh' }),
    } as Partial<Response> as Response);

    mockImpersonatedRequest.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        response: {
          candidates: [
            {
              content: {
                parts: [
                  { text: 'Hello!' },
                  { thought: 'Reasoning...' },
                  {
                    functionCall: {
                      name: 'test_tool',
                      args: { val: 'test' },
                    },
                    thoughtSignature: 'skip_thought_signature_validator',
                  },
                ],
              },
              finishReason: 'stop',
            },
          ],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
        },
      }),
    } as Partial<Response> as Response);

    const messages = [
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi' },
    ];

    const options = {
      model: 'gemini-3.1-pro-high',
      temperature: 0.7,
      tools: [
        {
          function: {
            name: 'test_tool',
            description: 'A test tool',
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

    const result = await antigravityAdapter.chat(messages, options);

    expect(result.content).toBe('Hello!');
    expect(result.thought).toBe('Reasoning...');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].function.name).toBe('test_tool');

    // Validation que impersonatedRequest a bien été appelé deux fois
    expect(mockImpersonatedRequest).toHaveBeenCalledTimes(2);

    // Validation des arguments de l'appel generateContent
    const lastCallArgs = mockImpersonatedRequest.mock.calls[1] as [string, RequestInit];
    const bodyParsed = JSON.parse(String(lastCallArgs[1].body));
    expect(bodyParsed.model).toBe('gemini-3.1-pro-high');
    expect(bodyParsed.request.tools[0].functionDeclarations[0].parameters.type).toBe('OBJECT');
    expect(bodyParsed.request.tools[0].functionDeclarations[0].parameters.properties.val.type).toBe(
      'STRING',
    );
  });

  it('should throw an error when token refresh fails', async () => {
    mockImpersonatedRequest.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'Invalid Grant',
    } as Partial<Response> as Response);

    await expect(
      antigravityAdapter.chat([{ role: 'user', content: 'Hi' }], { model: 'gemini-3.1-pro-high' }),
    ).rejects.toThrow('Google OAuth refresh failed');

    expect(mockImpersonatedRequest).toHaveBeenCalledTimes(1);
  });
});
