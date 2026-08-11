import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { z } from 'zod';

import { defineZodTool, executeZodTool } from '../../../utils/toolExecution.js';

describe('toolExecution', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('defineZodTool', () => {
    it('should expose a complete native Zod JSON schema when defined from Zod', () => {
      // Arrange
      const inputSchema = z.object({
        command: z.string().describe('The command to run'),
      });

      // Act
      const tool = defineZodTool({
        name: 'execute_bash_command',
        description: 'Executes a bash command',
        schema: inputSchema,
        execute: async () => ({ success: true }),
      });

      // Assert
      expect(tool.type).toEqual('function');
      expect(Object.prototype.hasOwnProperty.call(tool.function, 'strict')).toEqual(false);
      expect(tool.function.parameters).toEqual({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The command to run',
          },
        },
        required: ['command'],
        additionalProperties: false,
      });
      expect(tool._zodSchema).toEqual(inputSchema);
    });
  });

  describe('executeZodTool', () => {
    it('should validate arguments with the original Zod schema when executing', async () => {
      // Arrange
      const execute = jest.fn(
        async (
          args: { readonly count: number },
          _context: unknown,
        ): Promise<{ readonly doubled: number }> => ({ doubled: args.count * 2 }),
      );
      const tool = defineZodTool({
        name: 'double_count',
        description: 'Doubles a count',
        schema: z.object({ count: z.number().int().positive() }),
        execute,
      });

      // Act
      const result = await executeZodTool(tool, JSON.stringify({ count: 3 }), {});

      // Assert
      expect(result).toEqual({ doubled: 6 });
      expect(execute).toHaveBeenCalledWith({ count: 3 }, {});
    });
  });
});
