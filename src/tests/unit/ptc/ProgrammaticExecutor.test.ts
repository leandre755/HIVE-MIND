import { describe, it, expect } from '@jest/globals';

import { ProgrammaticExecutor } from '../../../services/ptc/ProgrammaticExecutor.js';
import type { OpenAIToolDefinition } from '../../../services/ptc/types.js';

describe('ProgrammaticExecutor', () => {
  describe('buildCodeExecutionToolDef', () => {
    it('should warn the model to avoid code_execution for terminal npm and filesystem tasks', () => {
      // Arrange
      const executor = new ProgrammaticExecutor();
      const availableTools: readonly OpenAIToolDefinition[] = [
        createToolDefinition('execute_bash_command', 'Execute terminal commands'),
        createToolDefinition('read_file', 'Read a file'),
      ];

      // Act
      const definition = executor.buildCodeExecutionToolDef(availableTools);

      // Assert
      expect(definition.function.description).toContain(
        'NPM, Node scripts, file creation, or filesystem writes',
      );
      expect(definition.function.description).toContain('use execute_bash_command directly');
    });
  });
});

function createToolDefinition(name: string, description: string): OpenAIToolDefinition {
  return {
    type: 'function',
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  };
}
