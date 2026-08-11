import {
  CommandKind,
  CommandContext,
  SlashCommand,
  MessageType,
  HistoryItemAbout,
  IdeClient,
  getVersion,
} from '../contexts/UIStateContext.js';
import process from 'node:process';

export const aboutCommand: SlashCommand = {
  name: 'about',
  description: 'Show version info',
  kind: CommandKind.BUILT_IN,
  autoExecute: true,
  isSafeConcurrent: true,
  action: async (context) => {
    const osVersion = process.platform;
    let sandboxEnv = 'no sandbox';
    if (process.env['SANDBOX'] && process.env['SANDBOX'] !== 'sandbox-exec') {
      sandboxEnv = process.env['SANDBOX'];
    } else if (process.env['SANDBOX'] === 'sandbox-exec') {
      sandboxEnv = `sandbox-exec (${process.env['SEATBELT_PROFILE'] || 'unknown'})`;
    }
    const agentContext = context.services?.agentContext;
    const modelVersion =
      agentContext?.config?.getModel?.() || agentContext?.getModel?.() || 'Unknown';
    const cliVersion = await getVersion();
    const selectedAuthType = undefined;
    const gcpProject = process.env['GOOGLE_CLOUD_PROJECT'] || '';
    const ideClient = await getIdeClientName(context);

    const userEmail = undefined;

    const aboutItem: Omit<HistoryItemAbout, 'id'> = {
      type: MessageType.ABOUT,
      cliVersion,
      osVersion,
      sandboxEnv,
      modelVersion,
      selectedAuthType,
      gcpProject,
      ideClient,
      userEmail,
    };

    context.ui?.addItem?.(aboutItem);
  },
};

async function getIdeClientName(context: CommandContext) {
  const agentContext = context.services?.agentContext;
  if (!agentContext?.config?.getIdeMode?.() && !agentContext?.getIdeMode?.()) {
    return '';
  }
  const ideClient = await IdeClient.getInstance();
  return ideClient?.getDetectedIdeDisplayName() ?? '';
}
