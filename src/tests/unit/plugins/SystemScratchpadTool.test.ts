// tests/unit/plugins/SystemScratchpadTool.test.ts
// MOD 2 — SystemScratchpadTool (run_scratchpad)
import { describe, it, beforeEach, afterEach, jest, expect, beforeAll } from '@jest/globals';

// Mock loader BEFORE import
jest.unstable_mockModule('../../../plugins/loader.js', () => ({
  pluginLoader: {
    getToolDefinitions: jest.fn(() => [
      { function: { name: 'list_directory' } },
      { function: { name: 'grep_search' } },
      { function: { name: 'read_file' } },
      { function: { name: 'duckduck_search' } },
      { function: { name: 'execute_bash_command' } }, // must be filtered out
    ]),
    execute: jest.fn(async () => ({ success: true, message: 'mock result' })),
  },
}));

describe('SystemScratchpadTool (run_scratchpad)', () => {
  type ScratchpadModule = typeof import('../../../plugins/base/dev_tools/SystemScratchpadTool.js');
  type LoaderModule = typeof import('../../../plugins/loader.js');

  let SystemScratchpadTool: ScratchpadModule['default'];
  let pluginLoader: LoaderModule['pluginLoader'];
  let providersModule: typeof import('../../../providers/index.js');
  let chatSpy: jest.SpiedFunction<typeof providersModule.providerRouter.chat>;

  beforeAll(async () => {
    // Dynamic import AFTER mock registration
    const mod1 = await import('../../../plugins/base/dev_tools/SystemScratchpadTool.js');
    SystemScratchpadTool = mod1.default;

    const mod2 = await import('../../../plugins/loader.js');
    pluginLoader = mod2.pluginLoader;

    providersModule = await import('../../../providers/index.js');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    // Use spyOn since ESM module exports are live bindings
    chatSpy = jest.spyOn(providersModule.providerRouter, 'chat').mockResolvedValue({
      content: 'Scratchpad report: found 5 TS files.',
      toolCalls: null,
    });
  });

  afterEach(() => {
    chatSpy?.mockRestore();
  });

  it('returns null for wrong toolName', async () => {
    const result = await SystemScratchpadTool.execute(
      { instructions: 'ignored' },
      {},
      'wrong_tool',
    );
    expect(result).toBeNull();
  });

  it('returns a report with success=true on normal completion', async () => {
    const result = await SystemScratchpadTool.execute(
      { instructions: 'Find all TS files in services/' },
      {},
      'run_scratchpad',
    );

    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
    expect(result!.message).toContain('Rapport de SystemScratchpad');
    expect(result!.message).toContain('found 5 TS files');
  });

  it('filters tools to READ-ONLY whitelist only', async () => {
    await SystemScratchpadTool.execute({ instructions: 'test' }, {}, 'run_scratchpad');

    expect(chatSpy).toHaveBeenCalled();
    const options = chatSpy.mock.calls[0][1] as { tools?: Array<{ function: { name: string } }> };
    expect(options.tools).toBeDefined();

    const toolNames = options.tools!.map((t) => t.function.name);
    expect(toolNames).toContain('list_directory');
    expect(toolNames).toContain('grep_search');
    expect(toolNames).toContain('read_file');
    expect(toolNames).not.toContain('execute_bash_command');
  });

  it('blocks forbidden tools during execution without calling pluginLoader', async () => {
    // First call: LLM requests a forbidden tool
    const forbiddenToolCall = {
      id: 'tc1',
      type: 'function' as const,
      function: { name: 'execute_bash_command', arguments: '{}' },
    };
    chatSpy
      .mockResolvedValueOnce({
        content: null,
        toolCalls: [forbiddenToolCall],
      })
      // Second call: LLM produces final text
      .mockResolvedValueOnce({ content: 'Done.', toolCalls: null });

    await SystemScratchpadTool.execute({ instructions: 'test' }, {}, 'run_scratchpad');

    const executeCalls = (pluginLoader.execute as jest.Mock).mock.calls as unknown[][];
    const bashCalls = executeCalls.filter((c) => c[0] === 'execute_bash_command');
    expect(bashCalls).toHaveLength(0);
  });

  it('respects MAX_ITERATIONS (5) limit', async () => {
    // LLM always returns tool calls (infinite loop scenario)
    const readFileToolCall = {
      id: 'tc',
      type: 'function' as const,
      function: { name: 'read_file', arguments: '{"file_path":"test"}' },
    };
    chatSpy.mockResolvedValue({
      content: null,
      toolCalls: [readFileToolCall],
    });

    await SystemScratchpadTool.execute({ instructions: 'loop forever' }, {}, 'run_scratchpad');

    expect(chatSpy.mock.calls.length).toBeLessThanOrEqual(6); // 5 iterations + 1 forced conclusion
  });

  it('returns error on LLM failure', async () => {
    chatSpy.mockRejectedValueOnce(new Error('API timeout') as never);

    const result = await SystemScratchpadTool.execute(
      { instructions: 'fail' },
      {},
      'run_scratchpad',
    );

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.message).toContain('Impossible de terminer la tâche');
    expect(result!.message).toContain('API timeout');
  });

  it('uses isolated history starting with system role', async () => {
    await SystemScratchpadTool.execute({ instructions: 'Explore services/' }, {}, 'run_scratchpad');

    expect(chatSpy).toHaveBeenCalled();
    const history = chatSpy.mock.calls[0][0] as Array<{ role: string; content: string }>;

    expect(history[0].role).toBe('system');
    expect(history[0].content).toContain('Scratchpad');
  });
});
