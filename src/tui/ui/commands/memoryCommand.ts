import { HiveConfig } from '../../config/hiveConfig.js';
import {
  listMemoryFiles,
  refreshMemory,
  showMemory,
  MessageType,
  CommandKind,
  SlashCommand,
  CommandContext,
} from '../contexts/UIStateContext.js';

function getMemoryConfig(context: CommandContext): unknown {
  return context.services?.agentContext?.config ?? context.services?.agentContext ?? undefined;
}

const showSubCommand: SlashCommand = {
  name: 'show',
  description: 'Show the current memory contents',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context) => {
    const config = getMemoryConfig(context);
    if (!config) return;
    const result = showMemory(config);

    context.ui?.addItem?.(
      {
        type: MessageType.INFO,
        text: result.content,
      },
      Date.now(),
    );
  },
};

const reloadSubCommand: SlashCommand = {
  name: 'reload',
  altNames: ['refresh'],
  description: 'Reload the memory from the source',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context) => {
    context.ui?.addItem?.(
      {
        type: MessageType.INFO,
        text: 'Reloading memory from source files...',
      },
      Date.now(),
    );

    try {
      const config = getMemoryConfig(context);
      if (config) {
        const result = await refreshMemory(config);

        context.ui?.addItem?.(
          {
            type: MessageType.INFO,
            text: result.content,
          },
          Date.now(),
        );
      }
    } catch (error) {
      context.ui?.addItem?.(
        {
          type: MessageType.ERROR,

          text: `Error reloading memory: ${(error as Error).message}`,
        },
        Date.now(),
      );
    }
  },
};

const listSubCommand: SlashCommand = {
  name: 'list',
  description: 'Lists the paths of the memory files in use',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context) => {
    const config = getMemoryConfig(context);
    if (!config) return;
    const result = listMemoryFiles(config);

    context.ui?.addItem?.(
      {
        type: MessageType.INFO,
        text: result.content,
      },
      Date.now(),
    );
  },
};

export const memoryCommand = (_config: HiveConfig | null): SlashCommand => {
  const subCommands: SlashCommand[] = [showSubCommand, reloadSubCommand, listSubCommand];

  return {
    name: 'memory',
    description: 'Commands for interacting with memory',
    kind: CommandKind.BUILT_IN,
    autoExecute: false,
    subCommands,
  };
};
