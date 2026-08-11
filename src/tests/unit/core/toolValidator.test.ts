/**
 * tests/unit/core/toolValidator.test.ts
 *
 * Unit tests for the Global Tool Retry System's pre-execution
 * argument validation logic. Tests the validateToolArgs helper
 * that checks required parameters against JSON Schema before
 * allowing tool execution.
 */

import { describe, it, expect } from '@jest/globals';

import { validateToolArgs } from '../../../utils/toolValidator.js';

// ─── Test Data ───

const TEST_GENERIC_DEF = {
  function: {
    name: 'test_generic',
    description: 'A generic test tool with required parameters',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Some name' },
        value: { type: 'string', description: 'Some value' },
      },
      required: ['name'],
    },
  },
};

const BROWSER_SCREENSHOT_DEF = {
  function: {
    name: 'browser_screenshot',
    description: 'Takes a screenshot of the current browser page',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Descriptive filename for the screenshot' },
        url: { type: 'string', description: 'Optional URL to navigate to' },
      },
      required: ['name'],
    },
  },
};

const DB_DOCUMENT_SAVE_DEF = {
  function: {
    name: 'db_document_save',
    description: 'Save to Epistemic Memory',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Memory key' },
        content: { type: 'string', description: 'Content to store' },
      },
      required: ['key', 'content'],
    },
  },
};

const SEND_MESSAGE_DEF = {
  function: {
    name: 'send_message',
    description: 'Send a message',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Message text' },
      },
      // No required array — all params optional
    },
  },
};

const CODE_EXECUTION_DEF = {
  function: {
    name: 'code_execution',
    description: 'Execute code in sandbox',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to execute' },
      },
      required: ['code'],
    },
  },
};

const ALL_TOOLS = [
  TEST_GENERIC_DEF,
  BROWSER_SCREENSHOT_DEF,
  DB_DOCUMENT_SAVE_DEF,
  SEND_MESSAGE_DEF,
  CODE_EXECUTION_DEF,
];

// ─── Tests ───

describe('validateToolArgs', () => {
  describe('valid calls', () => {
    it('should return valid when all required params are present', () => {
      // Arrange
      const toolCall = {
        function: {
          name: 'test_generic',
          arguments: JSON.stringify({ name: 'homepage_capture' }),
        },
      };

      // Act
      const result = validateToolArgs(
        toolCall.function.name,
        toolCall.function.arguments,
        ALL_TOOLS,
      );

      // Assert
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('should return invalid when unexpected parameters are provided (strict mode)', () => {
      // Arrange
      const toolCall = {
        function: {
          name: 'db_document_save',
          arguments: JSON.stringify({ key: 'notes', content: 'hello', extra: true }),
        },
      };

      // Act
      const result = validateToolArgs(
        toolCall.function.name,
        toolCall.function.arguments,
        ALL_TOOLS,
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual([]);
      expect(result.formattedError).toContain("An unexpected parameter 'extra' was provided");
    });

    it('should return valid when tool has no required array', () => {
      // Arrange
      const toolCall = {
        function: {
          name: 'send_message',
          arguments: JSON.stringify({}),
        },
      };

      // Act
      const result = validateToolArgs(
        toolCall.function.name,
        toolCall.function.arguments,
        ALL_TOOLS,
      );

      // Assert
      expect(result.valid).toBe(true);
      expect(result.schema).toEqual({
        ...SEND_MESSAGE_DEF.function.parameters,
        additionalProperties: false,
      });
    });

    it('should return valid when tool is not found in definitions', () => {
      // Arrange
      const toolCall = {
        function: {
          name: 'unknown_tool',
          arguments: JSON.stringify({ foo: 'bar' }),
        },
      };

      // Act
      const result = validateToolArgs(
        toolCall.function.name,
        toolCall.function.arguments,
        ALL_TOOLS,
      );

      // Assert
      expect(result.valid).toBe(true);
      expect(result.schema).toBeNull();
    });
  });
});

describe('validateToolArgs missing/edge', () => {
  describe('missing required params', () => {
    it('should detect single missing required param', () => {
      // Arrange
      const toolCall = {
        function: {
          name: 'test_generic',
          arguments: JSON.stringify({ value: 'some value' }),
        },
      };

      // Act
      const result = validateToolArgs(
        toolCall.function.name,
        toolCall.function.arguments,
        ALL_TOOLS,
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['name']);
      expect(result.schema).toEqual({
        ...TEST_GENERIC_DEF.function.parameters,
        additionalProperties: false,
      });
    });

    it('should detect multiple missing required params', () => {
      // Arrange
      const toolCall = {
        function: {
          name: 'db_document_save',
          arguments: JSON.stringify({}),
        },
      };

      // Act
      const result = validateToolArgs(
        toolCall.function.name,
        toolCall.function.arguments,
        ALL_TOOLS,
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['key', 'content']);
    });

    it('should detect partial missing required params', () => {
      // Arrange
      const toolCall = {
        function: {
          name: 'db_document_save',
          arguments: JSON.stringify({ key: 'my_key' }),
        },
      };

      // Act
      const result = validateToolArgs(
        toolCall.function.name,
        toolCall.function.arguments,
        ALL_TOOLS,
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['content']);
    });
  });

  describe('empty string treated as missing', () => {
    it('should treat empty string as missing for required param', () => {
      // Arrange
      const toolCall = {
        function: {
          name: 'test_generic',
          arguments: JSON.stringify({ name: '' }),
        },
      };

      // Act
      const result = validateToolArgs(
        toolCall.function.name,
        toolCall.function.arguments,
        ALL_TOOLS,
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['name']);
    });

    it('should treat null as missing for required param', () => {
      // Arrange
      const toolCall = {
        function: {
          name: 'code_execution',
          arguments: JSON.stringify({ code: null }),
        },
      };

      // Act
      const result = validateToolArgs(
        toolCall.function.name,
        toolCall.function.arguments,
        ALL_TOOLS,
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['code']);
    });
  });

  describe('unparseable JSON', () => {
    it('should return invalid with unparseable marker when JSON is malformed', () => {
      // Arrange
      const toolCall = {
        function: {
          name: 'browser_screenshot',
          arguments: '{invalid json',
        },
      };

      // Act
      const result = validateToolArgs(
        toolCall.function.name,
        toolCall.function.arguments,
        ALL_TOOLS,
      );

      // Assert
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['(unparseable JSON)']);
      expect(result.schema).toEqual(BROWSER_SCREENSHOT_DEF.function.parameters);
    });

    it('should return invalid when arguments is empty string', () => {
      // Arrange
      const toolCall = {
        function: {
          name: 'code_execution',
          arguments: '',
        },
      };

      // Act
      const result = validateToolArgs(
        toolCall.function.name,
        toolCall.function.arguments,
        ALL_TOOLS,
      );

      // Assert
      // Empty string -> JSON.parse('{}') -> missing 'code'
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['code']);
    });
  });

  describe('edge cases', () => {
    it('should accept boolean false as a present value', () => {
      // Arrange: a hypothetical tool with a boolean required param
      const boolToolDef = {
        function: {
          name: 'test_bool',
          parameters: {
            type: 'object',
            properties: { enabled: { type: 'boolean' } },
            required: ['enabled'],
          },
        },
      };
      const toolCall = {
        function: {
          name: 'test_bool',
          arguments: JSON.stringify({ enabled: false }),
        },
      };

      // Act
      const result = validateToolArgs(toolCall.function.name, toolCall.function.arguments, [
        boolToolDef,
      ]);

      // Assert — false is a valid value, not missing
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('should accept zero as a present value', () => {
      // Arrange
      const numToolDef = {
        function: {
          name: 'test_num',
          parameters: {
            type: 'object',
            properties: { count: { type: 'number' } },
            required: ['count'],
          },
        },
      };
      const toolCall = {
        function: {
          name: 'test_num',
          arguments: JSON.stringify({ count: 0 }),
        },
      };

      // Act
      const result = validateToolArgs(toolCall.function.name, toolCall.function.arguments, [
        numToolDef,
      ]);

      // Assert — 0 is a valid value, not missing
      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });
  });
});
