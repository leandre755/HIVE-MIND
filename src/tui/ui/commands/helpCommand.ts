import {
  CommandKind,
  SlashCommand,
  MessageType,
  HistoryItemHelp,
} from '../contexts/UIStateContext.js';

export const helpCommand: SlashCommand = {
  name: 'help',
  kind: CommandKind.BUILT_IN,
  description: 'For help on HIVE-MIND TUI',
  autoExecute: true,
  action: async (context) => {
    const helpItem: Omit<HistoryItemHelp, 'id'> = {
      type: MessageType.HELP,
      timestamp: new Date(),
    };

    context.ui?.addItem?.(helpItem);
  },
};
