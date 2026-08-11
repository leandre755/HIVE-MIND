import { describe, beforeEach, it, expect, jest } from '@jest/globals';

// Store deep-copied call arguments to prevent post-call mutation references
const chatCalls: unknown[][] = [];

jest.unstable_mockModule('../../../core/blueprint/AgentBlueprint.js', () => ({
  blueprintManager: {
    registerEphemeral: jest.fn(),
    cleanupEphemeral: jest.fn(),
  },
}));

jest.unstable_mockModule('../../../providers/index.js', () => ({
  providerRouter: {
    chat: jest.fn().mockImplementation(async (...args: unknown[]) => {
      const history = args[0] as unknown[];
      chatCalls.push(JSON.parse(JSON.stringify(history)));
      return {
        content: `Report based on history size: ${history.length}`,
        toolCalls: [],
      };
    }),
  },
}));

jest.unstable_mockModule('../../../plugins/loader.js', () => ({
  pluginLoader: {
    getToolDefinitions: jest
      .fn()
      .mockReturnValue([{ type: 'function', function: { name: 'duckduck_search' } }]),
    execute: jest.fn(),
  },
}));

const { SubAgentEngine } = await import('../../../services/agentic/SubAgentEngine.js');
const SpawnSubAgentTool = (await import('../../../plugins/base/dev_tools/SpawnSubAgentTool.js'))
  .default;

describe('SubAgentEngine Fork & Caching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chatCalls.length = 0; // Reset captured calls array
  });

  it('should initialize with "fresh" mode and start with minimal context', async () => {
    const engine = new SubAgentEngine({
      name: 'TestFresh',
      systemPrompt: 'You are a coder helper.',
      allowedTools: ['duckduck_search'],
    });

    const result = await engine.run('Test mission', {});
    expect(result.success).toBe(true);
    expect(chatCalls[0]).toHaveLength(2); // System + User mission
  });

  it('should clone parent history in "fork" mode to maximize prompt caching', async () => {
    const parentHistory = [
      { role: 'user', content: 'What is the speed of light?' },
      { role: 'assistant', content: 'It is 299,792,458 m/s.' },
    ];

    const engine = new SubAgentEngine({
      name: 'TestFork',
      systemPrompt: 'You are a research analyst.',
      allowedTools: ['duckduck_search'],
      parentHistory,
    });

    const result = await engine.run('Verify this speed', {});
    expect(result.success).toBe(true);
    expect(chatCalls).toHaveLength(1);

    // Retrieve the captured call history
    const sentHistory = chatCalls[0] as Array<{ role: string; content: string }>;
    expect(sentHistory).toHaveLength(3); // 2 parent messages + 1 fork mission message
    expect(sentHistory[0]).toEqual(parentHistory[0]);
    expect(sentHistory[1]).toEqual(parentHistory[1]);
    expect(sentHistory[2].content).toContain('[FORK MISSION - TestFork]');
  });

  it('should support SpawnSubAgentTool delegation in fork mode', async () => {
    const context = {
      conversationHistory: [{ role: 'user', content: 'Parent conversation message' }],
    };

    const executeResult = await SpawnSubAgentTool.execute(
      {
        name: 'DelegatedHelper',
        persona: 'You are an assistant',
        tools: ['duckduck_search'],
        mission: 'Complete sub task',
        mode: 'fork',
      },
      context,
      'spawn_sub_agent',
    );

    expect(executeResult?.success).toBe(true);
    expect(chatCalls).toHaveLength(1);

    const sentHistory = chatCalls[0] as Array<{ role: string; content: string }>;
    expect(sentHistory).toHaveLength(2); // 1 parent message + 1 fork mission
    expect(sentHistory[0].content).toBe('Parent conversation message');
    expect(sentHistory[1].content).toContain('[FORK MISSION - DelegatedHelper]');
  });
});
