import { jest, describe, beforeEach, it, expect } from '@jest/globals';

type ChatMessage = {
  readonly role: string;
  readonly content: string;
};

type ChatResponse = {
  readonly content: string;
};

type ChatFn = (
  messages: readonly ChatMessage[],
  options?: Record<string, unknown>,
) => Promise<ChatResponse>;

type StartActionFn = (chatId: string, payload: unknown) => Promise<string>;

const chatMock = jest.fn<ChatFn>();
const startActionMock = jest.fn<StartActionFn>();
type UpdateStepFn = (chatId: string, status: string) => Promise<boolean>;
const updateStepMock = jest.fn<UpdateStepFn>();

jest.unstable_mockModule('../../../providers/index.js', () => ({
  providerRouter: {
    chat: chatMock,
    callServiceRecipe: jest
      .fn<(typeof import('../../../providers/index.js'))['providerRouter']['callServiceRecipe']>()
      .mockResolvedValue({
        content:
          '{"target_url":"https://example.com/target-page","file_path":"/path/to/reconstructed/file.txt"}',
      }),
  },
}));

jest.unstable_mockModule('../../../services/memory/ActionMemory.js', () => ({
  actionMemory: {
    startAction: startActionMock,
    updateStep: updateStepMock,
  },
}));

jest.unstable_mockModule('../../../services/supabase.js', () => ({
  supabase: null,
}));

const { ExplicitPlanner } = await import('../../../services/agentic/Planner.js');

type StepInternals = {
  _executeStepWithRetry: (
    step: unknown,
    context: unknown,
    log: unknown,
    plan: unknown,
  ) => Promise<unknown>;
  _executeSingleStep: (
    step: unknown,
    context: unknown,
    log: unknown,
    plan: unknown,
  ) => Promise<void>;
};
const internals = (planner: InstanceType<typeof ExplicitPlanner>) =>
  planner as unknown as StepInternals;

describe('ExplicitPlanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    startActionMock.mockResolvedValue('plan_1');
    updateStepMock.mockResolvedValue(true);
  });

  describe('plan', () => {
    it('should instruct the model to use execute_bash_command when terminal npm or filesystem work is required', async () => {
      // Arrange
      chatMock.mockResolvedValue({
        content: JSON.stringify({
          steps: [
            {
              id: 1,
              action: 'Run a Node script that reads a PDF and writes markdown',
              tool: 'execute_bash_command',
              params: { command: 'node extract_pdf.js' },
              estimated_time: 10,
              depends_on: [],
            },
          ],
          total_time_estimate: 10,
          complexity: 'medium',
        }),
      });
      const planner = new ExplicitPlanner();
      const context = {
        chatId: 'chat_1',
        tools: [
          createToolDefinition('execute_bash_command', 'Execute terminal commands'),
          createToolDefinition('code_execution', 'Execute sandboxed JavaScript'),
        ],
      };

      // Act
      await planner.plan('Install pdf-parse, extract a PDF, write test_document.md', context);

      // Assert
      const prompt = getPlannerPrompt();
      expect(prompt).toContain(
        'Use `execute_bash_command` for terminal actions, running Node scripts, and creating files in the filesystem.',
      );
      expect(prompt).not.toContain("do NOT use 'execute_bash_command'");
    });
  });

  describe('execute with variable interpolation', () => {
    it('should correctly interpolate nested object properties like url and filePath instead of returning [object Object]', async () => {
      const planner = new ExplicitPlanner();
      const executeToolMock = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ success: true, llmOutput: 'Done' });

      const plan = {
        id: 'plan_123',
        goal: 'Test interpolation',
        totalTime: 10,
        complexity: 'low',
        status: 'pending',
        steps: [
          {
            id: 3,
            action: 'Navigate to target',
            tool: 'test_tool',
            estimated_time: 5,
            params: {
              target_url: '{{step_2_url}}',
              file_path: '{{step_2_filePath}}',
            },
            depends_on: [],
          },
        ],
      };

      const initialExecutionLog = {
        startTime: Date.now(),
        completed: [],
        failed: [],
        results: {
          2: {
            llmOutput: {
              success: true,
              data: {
                result: {
                  title: 'Test Page',
                  url: 'https://example.com/target-page',
                  filePath: '/path/to/reconstructed/file.txt',
                },
              },
            },
          },
        },
      };

      const context = {
        chatId: 'chat_123',
        executeToolFn: executeToolMock as (
          toolCall: { id: string; function: { name: string; arguments: string } },
          message: unknown,
        ) => Promise<{ success: boolean; llmOutput: string }>,
        tools: [createToolDefinition('test_tool', 'A test tool')],
        message: { role: 'user', content: 'test' },
      };

      // Act
      const result = await planner.execute(plan, context, initialExecutionLog);

      // Assert
      expect(result.completed).toContain(3);
      expect(executeToolMock).toHaveBeenCalled();
      const callArgs = executeToolMock.mock.calls[0] as unknown as [
        { function: { arguments: string } },
      ];
      const toolCall = callArgs[0];
      const parsedArgs = JSON.parse(toolCall.function.arguments);

      expect(parsedArgs.target_url).toBe('https://example.com/target-page');
      expect(parsedArgs.file_path).toBe('/path/to/reconstructed/file.txt');
    });

    it('handles step failure and marks executionLog as failed without adding to completed', async () => {
      const planner = new ExplicitPlanner();
      const executeToolMock = jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue({ success: false, error: 'Step execution failed permanently' });

      const plan = {
        id: 'plan_failed',
        goal: 'Test failure',
        totalTime: 5,
        complexity: 'low',
        status: 'pending',
        steps: [
          {
            id: 99,
            action: 'Failing action',
            tool: 'test_tool',
            estimated_time: 5,
            params: {},
            depends_on: [],
          },
        ],
      };

      const context = {
        chatId: 'chat_fail',
        executeToolFn: executeToolMock as unknown as (
          toolCall: { id: string; function: { name: string; arguments: string } },
          message: unknown,
        ) => Promise<{ success: boolean; llmOutput: string }>,
        tools: [createToolDefinition('test_tool', 'A test tool')],
        message: { role: 'user', content: 'test' },
      };

      const result = await planner.execute(plan, context);
      expect(result.failed).toContain(99);
      expect(result.completed).not.toContain(99);
    });
  });
});

describe('execute - échecs et replanification', () => {
  it('gère une étape déjà marquée en échec sans lever d exception critique', async () => {
    const planner = new ExplicitPlanner();
    const step = { id: 1, action: 'test action', tool: 'test_tool', params: {} };
    const context = { chatId: 'chat_123', userId: 'user_1' };
    const executionLog = { completed: [] as number[], failed: [1], results: {} };
    const plan = { id: 'plan_1', steps: [step], goal: 'test goal' };
    internals(planner)._executeStepWithRetry = jest
      .fn<StepInternals['_executeStepWithRetry']>()
      .mockImplementation(async (_s, _c, log) => {
        (log as { failed: number[] }).failed.push(1);
        return null;
      });
    await internals(planner)._executeSingleStep(step, context, executionLog, plan);
    expect(executionLog.failed).toContain(1);
    expect(executionLog.completed).not.toContain(1);
  });

  it('réhabilite une étape replanifiée dont l identifiant figure déjà dans les échecs antérieurs', async () => {
    const planner = new ExplicitPlanner();
    const step = { id: 1, action: 'test action', tool: 'test_tool', params: {} };
    const context = { chatId: 'chat_123', userId: 'user_1' };
    const executionLog = {
      completed: [] as number[],
      failed: [1],
      results: {} as Record<string, unknown>,
    };
    const plan = { id: 'plan_1', steps: [step], goal: 'test goal' };
    internals(planner)._executeStepWithRetry = jest
      .fn<StepInternals['_executeStepWithRetry']>()
      .mockResolvedValue({ success: true });
    await internals(planner)._executeSingleStep(step, context, executionLog, plan);
    expect(executionLog.completed).toContain(1);
    expect(executionLog.failed).not.toContain(1);
    expect(executionLog.results[1]).toBeDefined();
  });
});

function createToolDefinition(name: string, description: string) {
  return {
    function: {
      name,
      description,
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          target_url: { type: 'string' },
          file_path: { type: 'string' },
        },
      },
    },
  };
}

function getPlannerPrompt(): string {
  const firstCall = chatMock.mock.calls[0];
  const messages = firstCall?.[0] as
    readonly { readonly role: string; readonly content: string }[] | undefined;
  const userMessage = messages?.find((message) => message.role === 'user');
  return userMessage?.content ?? '';
}
