import { describe, it, expect, jest } from '@jest/globals';
import { buildToolFunctions } from '../../../services/ptc/ToolBridge.js';
import type { OpenAIToolDefinition } from '../../../services/ptc/types.js';

describe('ToolBridge', () => {
  const mockContext = {
    transport: {},
    message: {},
    chatId: '123',
    sender: 'test-sender',
  };

  const makeExecuteFn = (): jest.MockedFunction<
    (toolName: string, args: Record<string, unknown>, context: unknown) => Promise<unknown>
  > => jest.fn(async () => 'success result');

  it('should build functions map correctly for standard tools', async () => {
    const executeFn = makeExecuteFn();
    const toolDefs: OpenAIToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'tool_a',
          description: 'Tool A',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'tool_b',
          description: 'Tool B',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];

    const fns = buildToolFunctions(toolDefs, executeFn, mockContext);

    expect(fns.size).toBe(2);
    expect(fns.has('tool_a')).toBe(true);
    expect(fns.has('tool_b')).toBe(true);

    const toolAFn = fns.get('tool_a');
    expect(toolAFn).toBeDefined();

    if (toolAFn) {
      const args = { param1: 'value1' };
      const result = await toolAFn(args);

      expect(result).toBe('success result');
      expect(executeFn).toHaveBeenCalledTimes(1);
      expect(executeFn).toHaveBeenCalledWith('tool_a', args, mockContext);
    }
  });

  it('should exclude the code_execution meta-tool', () => {
    const executeFn = makeExecuteFn();
    const toolDefs: OpenAIToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'code_execution',
          description: 'Meta tool',
          parameters: { type: 'object', properties: {} },
        },
      },
      {
        type: 'function',
        function: {
          name: 'standard_tool',
          description: 'Standard tool',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];

    const fns = buildToolFunctions(toolDefs, executeFn, mockContext);

    expect(fns.size).toBe(1);
    expect(fns.has('code_execution')).toBe(false);
    expect(fns.has('standard_tool')).toBe(true);
  });

  it('should return empty map for empty tool list', () => {
    const executeFn = makeExecuteFn();
    const fns = buildToolFunctions([], executeFn, mockContext);
    expect(fns.size).toBe(0);
  });

  it('should pass error upward if executeFn rejects', async () => {
    const testError = new Error('Execute failed');
    const executeFn = jest
      .fn<(toolName: string, args: Record<string, unknown>, context: unknown) => Promise<unknown>>()
      .mockRejectedValue(testError);
    const toolDefs: OpenAIToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'tool_error',
          description: 'Tool Error',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];

    const fns = buildToolFunctions(toolDefs, executeFn, mockContext);
    const toolFn = fns.get('tool_error');

    expect(toolFn).toBeDefined();

    if (toolFn) {
      await expect(toolFn({})).rejects.toThrow('Execute failed');
    }
  });
});
