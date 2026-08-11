import {
  uiTelemetryService,
  resetBrowserSession,
  CommandKind,
  SlashCommand,
} from '../contexts/UIStateContext.js';
import { randomUUID } from 'node:crypto';

export const clearCommand: SlashCommand = {
  name: 'clear',
  altNames: ['new'],
  description: 'Clear the screen and start a new session',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  action: async (context, _args) => {
    context.ui?.setDebugMessage?.('Clearing terminal and resetting chat.');
    await resetBrowserSession();
    const newSessionId = randomUUID();

    await new Promise((resolve) => setImmediate(resolve));

    uiTelemetryService.clear(newSessionId);
    context.ui?.clear?.();
  },
};
