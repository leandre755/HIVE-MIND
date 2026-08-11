import { SubAgentEngine } from '../../services/agentic/SubAgentEngine.js';
import { pluginLoader } from '../../plugins/loader.js';
import { providerRouter } from '../../providers/index.js';
import { describe, it, expect, beforeAll, jest } from '@jest/globals';

describe('LLM Harness Integration', () => {
  beforeAll(async () => {
    jest.spyOn(pluginLoader, 'getToolDefinitions').mockImplementation(() => {
      return [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Reads a file',
            parameters: {
              type: 'object',
              properties: { file_path: { type: 'string' } },
              required: ['file_path'],
            },
          },
        },
      ];
    });

    jest
      .spyOn(pluginLoader, 'execute')
      .mockImplementation(async (_name: string, _args: unknown, _context: unknown) => {
        return { success: true, content: 'mocked content', message: 'ok' };
      });
  });

  it('should catch validation errors and feed them back without crashing', async () => {
    // We create a mocked prompt that explicitly calls a tool with BAD parameters
    // The real subagent engine will attempt to run it, and should intercept the Zod/Ajv error
    // and return a clear <tool_use_error>

    let callCount = 0;

    // Mock providerRouter to simulate ReAct loop
    jest.spyOn(providerRouter, 'chat').mockImplementation(async (history: unknown[]) => {
      callCount++;
      if (callCount === 1) {
        // First call: LLM hallucinates an unexpected parameter
        return {
          content: '',
          toolCalls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'read_file',
                arguments: JSON.stringify({ file_path: 'test.txt', hallucinated_param: true }),
              },
            },
          ],
        };
      } else {
        // Second call: LLM receives the error and fixes it, returning a final response
        const lastMsg = history[history.length - 1] as { role?: string; content?: string };
        expect(lastMsg.role).toBe('tool');
        expect(lastMsg.content).toContain('InputValidationError');
        expect(lastMsg.content).toContain('hallucinated_param');

        return {
          content: 'I have corrected my mistake.',
          toolCalls: [],
        };
      }
    });

    const engine = new SubAgentEngine({
      name: 'HarnessTester',
      systemPrompt: 'You must call read_file with an unexpected parameter hallucinated_param=true',
      allowedTools: ['read_file'],
      maxIterations: 3,
    });

    const result = await engine.run('Test the read_file validation error', {
      chatId: 'test_123',
      sender: 'test_user',
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('I have corrected my mistake.');
    expect(callCount).toBe(2);

    // Clean up mock
    jest.restoreAllMocks();
  });
});
