import { describe, it, expect, jest } from '@jest/globals';

import { ProgrammaticExecutor } from '../../../services/ptc/ProgrammaticExecutor.js';
import type { OpenAIToolDefinition, ToolFunction } from '../../../services/ptc/types.js';

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

  describe('execute - orchestration and data handling', () => {
    it('executes valid multi-tool scripts and aggregates results', async () => {
      const executor = new ProgrammaticExecutor();
      const mockToolA = jest.fn<ToolFunction>().mockImplementation(async () => ({ val: 42 }));
      const mockToolB = jest.fn<ToolFunction>().mockImplementation(async () => ({ success: true }));
      const tools = new Map<string, ToolFunction>([
        ['tool_a', mockToolA],
        ['tool_b', mockToolB],
      ]);

      const script = `
        const resA = await tool_a({ x: 1 });
        const resB = await tool_b({ y: resA.val });
        return { combined: resA.val, ok: resB.success };
      `;

      const result = await executor.execute(script, tools);

      expect(result.result).toEqual({ combined: 42, ok: true });
      expect(mockToolA).toHaveBeenCalledWith({ x: 1 });
      expect(mockToolB).toHaveBeenCalledWith({ y: 42 });
      expect(result.metadata.toolCallCount).toBe(2);
    });

    it('gracefully degrades when a tool returns an executable function', async () => {
      const executor = new ProgrammaticExecutor();
      const mockTool = jest
        .fn<ToolFunction>()
        .mockImplementation(async () => (() => 'malicious') as unknown as Record<string, unknown>);
      const tools = new Map<string, ToolFunction>([['fn_tool', mockTool]]);

      const script = `
        const res = await fn_tool({});
        return res;
      `;

      const result = await executor.execute(script, tools);
      expect(result.result).toEqual({
        success: false,
        error: expect.stringContaining('fonctions exécutables'),
        gracefulDegradation: true,
      });
    });

    it('gracefully degrades when a tool returns a non-serializable circular structure', async () => {
      const executor = new ProgrammaticExecutor();
      const circular: Record<string, unknown> = { a: 1 };
      circular.self = circular;
      const mockTool = jest.fn<ToolFunction>().mockImplementation(async () => circular);
      const tools = new Map<string, ToolFunction>([['circular_tool', mockTool]]);

      const script = `
        const res = await circular_tool({});
        return res;
      `;

      const result = await executor.execute(script, tools);
      expect(result.result).toEqual({
        success: false,
        error: expect.stringContaining('non sérialisable'),
        gracefulDegradation: true,
      });
    });

    it('preserves Array methods (.map, .filter) and iterability on tool collection returns', async () => {
      const executor = new ProgrammaticExecutor();
      const mockTool = jest.fn<ToolFunction>().mockImplementation(async () => ({
        items: [
          { id: 1, name: 'alpha' },
          { id: 2, name: 'beta' },
        ],
      }));
      const tools = new Map<string, ToolFunction>([['list_items', mockTool]]);

      const script = `
        const res = await list_items({});
        const mapped = res.items.map(x => x.name.toUpperCase());
        const filtered = res.items.filter(x => x.id > 1);
        let count = 0;
        for (const it of res.items) count++;
        return { mapped, filteredCount: filtered.length, count };
      `;

      const result = await executor.execute(script, tools);
      expect(result.result).toEqual({
        mapped: ['ALPHA', 'BETA'],
        filteredCount: 1,
        count: 2,
      });
    });
  });

  describe('execute - sandbox isolation and prototype hardening', () => {
    it('returns a primitive number from setTimeout preventing host prototype leak', async () => {
      const executor = new ProgrammaticExecutor();
      const tools = new Map<string, ToolFunction>();

      const script = `
        const t = setTimeout(() => {}, 50);
        clearTimeout(t);
        return { type: typeof t, isNumber: typeof t === 'number' };
      `;

      const result = await executor.execute(script, tools);
      expect(result.result).toEqual({ type: 'number', isNumber: true });
    });

    it('blocks prototype escape attacks via Array.constructor inside the sandbox', async () => {
      const executor = new ProgrammaticExecutor();
      const tools = new Map<string, ToolFunction>();

      const script = `
        const kC = String.fromCharCode(99,111,110,115,116,114,117,99,116,111,114);
        const arr = [1, 2];
        const attack = arr[kC][kC];
        return attack;
      `;

      await expect(executor.execute(script, tools)).rejects.toThrow(
        /Accès prototype ou constructeur interdit/,
      );
    });

    it('blocks prototype escape attacks on arrays returned by tools', async () => {
      const executor = new ProgrammaticExecutor();
      const mockListTool = jest
        .fn<ToolFunction>()
        .mockImplementation(async () => ['itemA', 'itemB']);
      const tools = new Map<string, ToolFunction>([['list_items', mockListTool]]);

      const script = `
        const items = await list_items({});
        const kC = String.fromCharCode(99,111,110,115,116,114,117,99,116,111,114);
        const attack = items[kC][kC];
        return attack;
      `;

      await expect(executor.execute(script, tools)).rejects.toThrow(
        /Accès prototype ou constructeur interdit/,
      );
    });

    it('cleans up active timers and prevents uncaught exceptions from leaking to host', async () => {
      const executor = new ProgrammaticExecutor();
      const tools = new Map<string, ToolFunction>();

      const script = `
        let timerFired = false;
        setTimeout(() => {
          timerFired = true;
          throw new Error('Async error inside sandbox timer');
        }, 10);
        await new Promise((r) => setTimeout(r, 25));
        return { scheduled: true, timerFired };
      `;

      const result = await executor.execute(script, tools);
      expect(result.result).toEqual({ scheduled: true, timerFired: true });
    });

    it('catches async promise rejections in setTimeout callback without crashing process', async () => {
      const executor = new ProgrammaticExecutor();
      const tools = new Map<string, ToolFunction>();

      const script = `
        let asyncTimerFired = false;
        setTimeout(async () => {
          asyncTimerFired = true;
          throw new Error('Async DoS in timer');
        }, 10);
        await new Promise((r) => setTimeout(r, 25));
        return { started: true, asyncTimerFired };
      `;

      const result = await executor.execute(script, tools);
      expect(result.result).toEqual({ started: true, asyncTimerFired: true });
    });

    it('locks Promise constructor and prototype inside sandbox', async () => {
      const executor = new ProgrammaticExecutor();
      const tools = new Map<string, ToolFunction>();

      const script = `
        const kC = String.fromCharCode(99,111,110,115,116,114,117,99,116,111,114);
        const p = Promise[kC];
        return p;
      `;

      await expect(executor.execute(script, tools)).rejects.toThrow(
        /Accès prototype ou constructeur interdit/,
      );
    });

    it('blocks Function constructor execution in the sandbox', async () => {
      const executor = new ProgrammaticExecutor();
      const tools = new Map<string, ToolFunction>();

      const script = `
        const f = Function('return 1');
        return f();
      `;

      await expect(executor.execute(script, tools)).rejects.toThrow(/Function\(\)|interdit/i);
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
