// Plugin for managing autonomous goals

interface GoalsContext {
  chatId?: string;
  [key: string]: unknown;
}

interface CreateGoalArgs {
  title: string;
  description: string;
  executeIn?: string;
  waitForUser?: string;
  waitForKeyword?: string;
}

interface ListGoalsArgs {
  status?: 'pending' | 'in_progress' | 'completed' | 'all';
}

interface CompleteGoalArgs {
  goalId: string;
  result?: string;
}

interface CancelGoalArgs {
  goalId: string;
}

interface GoalListItem {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly execute_at: string;
}

interface GoalsServiceLike {
  parseDuration(duration: string): Date;
  createGoal(params: Record<string, unknown>): Promise<{ id: string }>;
  getChatGoals(chatId: string): Promise<GoalListItem[]>;
  completeGoal(goalId: string, result?: string): Promise<void>;
  cancelGoal(goalId: string): Promise<void>;
}

export default {
  name: 'goals',
  description: 'Autonomous goal management',
  version: '1.0.0',

  toolDefinitions: [
    {
      type: 'function',
      function: {
        name: 'create_goal',
        description:
          'Creates an autonomous goal for a future action (research, reminder, scheduled task). Useful for remembering to do something later.',
        parameters: {
          type: 'object',
          properties: {
            title: {
              type: 'string',
              description: 'Short and descriptive title of the goal',
            },
            description: {
              type: 'string',
              description: 'Detailed description of what needs to be done',
            },
            executeIn: {
              type: 'string',
              description:
                'For a time-based reminder: When to execute this goal. Examples: "2h", "1d", "tomorrow". Ignored if waitForUser/Keyword is defined.',
              default: '1h',
            },
            waitForUser: {
              type: 'string',
              description:
                'Optional: Wait for a message from this specific user (Name or JID) before triggering the goal.',
            },
            waitForKeyword: {
              type: 'string',
              description:
                'Optional: Wait for a message containing this keyword before triggering the goal.',
            },
          },
          required: ['title', 'description'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_goals',
        description: 'Lists active autonomous goals for this chat.',
        parameters: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              description: 'Filter by status (pending, in_progress, completed)',
              enum: ['pending', 'in_progress', 'completed', 'all'],
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'complete_goal',
        description:
          'Marks an autonomous goal as completed. MUST be used at the end of a goal execution.',
        parameters: {
          type: 'object',
          properties: {
            goalId: {
              type: 'string',
              description: 'ID of the completed goal',
            },
            result: {
              type: 'string',
              description: 'Action result (optional)',
            },
          },
          required: ['goalId'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'cancel_goal',
        description: 'Cancels an autonomous goal.',
        parameters: {
          type: 'object',
          properties: {
            goalId: {
              type: 'string',
              description: 'ID of the goal to cancel',
            },
          },
          required: ['goalId'],
        },
      },
    },
  ],

  async _executeCreateGoal(args: CreateGoalArgs, chatId: string, goalsService: GoalsServiceLike) {
    const { title, description, executeIn = '1h', waitForUser, waitForKeyword } = args;

    let triggerType: 'TIME' | 'EVENT' = 'TIME';
    let triggerEvent: string | null = null;
    let triggerCondition: Record<string, string> = {};
    let executeAt: string;

    if (waitForUser || waitForKeyword) {
      triggerType = 'EVENT';
      triggerEvent = 'WAIT_FOR_MESSAGE';
      triggerCondition = {};
      if (waitForUser) triggerCondition.from_user = waitForUser;
      if (waitForKeyword) triggerCondition.contains = waitForKeyword;

      executeAt = new Date('2099-12-31T23:59:59Z').toISOString();
    } else {
      executeAt = goalsService.parseDuration(executeIn).toISOString();
    }

    const goal = await goalsService.createGoal({
      title,
      description,
      executeAt,
      targetChatId: chatId,
      origin: 'self',
      triggerType,
      triggerEvent,
      triggerCondition,
    });

    let validMsg: string;
    if (triggerType === 'EVENT') {
      const userPart = waitForUser ? 'From "' + waitForUser + '"' : '';
      const keywordPart = waitForKeyword ? 'Containing "' + waitForKeyword + '"' : '';
      validMsg = `Execution on event: ${userPart} ${keywordPart}`.trim();
    } else {
      validMsg = `Scheduled execution: ${new Date(executeAt).toLocaleString('en-US')}`;
    }

    return {
      success: true,
      message: `✅ Goal created: "${title}"\n${validMsg}\nID: ${goal.id}`,
    };
  },

  async execute(args: unknown, context: GoalsContext, toolName: string) {
    const { chatId } = context || {};

    if (!chatId) {
      return { success: false, message: 'CONTEXT_ERROR: chatId is required.' };
    }

    const { goalsService } = await import('../../../services/goalsService.js');

    switch (toolName) {
      case 'create_goal':
        return await this._executeCreateGoal(
          args as CreateGoalArgs,
          chatId,
          goalsService as unknown as GoalsServiceLike,
        );

      case 'list_goals': {
        const listArgs = args as ListGoalsArgs;
        const { status = 'all' } = listArgs;
        const allGoals = await goalsService.getChatGoals(chatId);

        const filtered =
          status === 'all' ? allGoals : allGoals.filter((g: GoalListItem) => g.status === status);

        if (filtered.length === 0) {
          return {
            success: true,
            message: 'No goals found.',
          };
        }

        const list = filtered
          .map(
            (g: GoalListItem) =>
              `- [${g.status}] ${g.title}\n  Execution: ${new Date(g.execute_at).toLocaleString('en-US')}\n  ID: ${g.id}`,
          )
          .join('\n\n');

        return {
          success: true,
          message: `📋 Goals (${filtered.length}):\n\n${list}`,
        };
      }

      case 'complete_goal': {
        const completeArgs = args as CompleteGoalArgs;
        const { goalId, result } = completeArgs;
        await goalsService.completeGoal(goalId, result);

        return {
          success: true,
          message: `✅ Goal ${goalId} marked as COMPLETED.`,
        };
      }

      case 'cancel_goal': {
        const cancelArgs = args as CancelGoalArgs;
        const { goalId } = cancelArgs;
        await goalsService.cancelGoal(goalId);

        return {
          success: true,
          message: `❌ Goal ${goalId} cancelled.`,
        };
      }

      default:
        return {
          success: false,
          message: 'Unknown tool.',
        };
    }
  },
};
