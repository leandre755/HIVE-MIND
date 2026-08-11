import {
  ModelSlashCommandEvent,
  logModelSlashCommand,
  CommandContext,
  CommandKind,
  SlashCommand,
  MessageType,
} from '../contexts/UIStateContext.js';

interface ModelConfigLike {
  setModel?(model: string, persist: boolean): void;
  refreshUserQuota?(): Promise<void>;
}

function getModelConfig(context: CommandContext): ModelConfigLike | null {
  return (
    (context.services?.agentContext?.config as ModelConfigLike | undefined) ??
    (context.services?.agentContext as ModelConfigLike | null)
  );
}

const setModelCommand: SlashCommand = {
  name: 'set',
  description: 'Set the model to use. Usage: /model set <model-name> [--persist]',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  action: async (context: CommandContext, args: string) => {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      context.ui?.addItem?.({
        type: MessageType.ERROR,
        text: 'Usage: /model set <model-name> [--persist]',
      });
      return;
    }

    const modelName = parts[0];
    const persist = parts.includes('--persist');

    const config = getModelConfig(context);
    if (config) {
      config.setModel?.(modelName, !persist);
      const event = new ModelSlashCommandEvent(modelName);
      logModelSlashCommand(config, event);

      context.ui?.addItem?.({
        type: MessageType.INFO,
        text: `Model set to ${modelName}${persist ? ' (persisted)' : ''}`,
      });
    }
  },
};

const manageModelCommand: SlashCommand = {
  name: 'manage',
  description: 'Opens a dialog to configure the model',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context: CommandContext) => {
    const config = getModelConfig(context);
    if (config) {
      await config.refreshUserQuota?.();
    }
    return {
      type: 'dialog',
      dialog: 'model',
    };
  },
};

export const modelCommand: SlashCommand = {
  name: 'model',
  description: 'Manage model configuration',
  kind: CommandKind.BUILT_IN,
  autoExecute: false,
  subCommands: [manageModelCommand, setModelCommand],
  action: async (context: CommandContext, args: string) =>
    manageModelCommand.action!(context, args),
};
