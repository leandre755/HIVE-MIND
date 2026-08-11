import { permissionManager } from '../../../core/security/PermissionManager.js';
import { persistentShell } from './PersistentShell.js';
import { z } from 'zod';
import { defineZodTool } from '../../../utils/toolExecution.js';

const MAX_OUTPUT_LENGTH = 30000;

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export default {
  name: 'dev_tools_bash',
  description: 'Execution of persistent bash commands (CWD and Env preserved).',
  version: '2.0.0',
  enabled: true,

  toolDefinitions: [
    defineZodTool({
      name: 'execute_bash_command',
      description:
        'Executes a bash command on the local machine in a persistent shell. Use this strictly when you need to interact with the file system, compile code, or run scripts.',
      schema: z.object({
        command: z
          .string()
          .describe(
            'The precise bash command to execute (e.g. "ls -la src/", "npm test"). Do not chain complex logic; keep it simple and readable.',
          ),
      }),
      execute: async (args, context) => {
        const { command } = args;
        const ctx = context as {
          chatId: string;
          sourceChannel?: string;
          message?: { sender?: string };
          onProgress?: (msg: string) => void;
        };
        const { chatId, sourceChannel } = ctx;

        // 1. Security Validation (Sandbox)
        const validation = permissionManager.validateBashCommand(command, persistentShell.getCwd());

        if (!validation.result && !validation.requiresPermission) {
          return {
            success: false,
            message: `[SECURITY BLOCK] Forbidden command: ${validation.reason}`,
          };
        }

        if (validation.requiresPermission) {
          const permResult = await permissionManager.askPermission(
            chatId,
            `Execute Bash (Non-Sandboxed): ${command}`,
            sourceChannel,
            ctx.message?.sender || 'system',
          );

          if (!permResult.granted) {
            if (permResult.feedback) {
              return {
                success: false,
                message: `[ACTION REJECTED] The user REJECTED this action and provided this corrective instruction: "${permResult.feedback}". Modify your parameters and try again.`,
              };
            }
            return {
              success: false,
              message: '[ACTION REJECTED] The user refused the execution of this command.',
            };
          }
        }

        // 2. Exécution dans le shell persistant
        try {
          console.log(`[BashTool] 🐚 Executing: ${command}`);

          if (ctx.onProgress) ctx.onProgress(`Executing: ${command}`);

          const { stdout, exitCode } = await persistentShell.execute(command);

          if (ctx.onProgress) ctx.onProgress(`Finished (Code: ${exitCode})`);

          let finalOutput = stdout;
          if (stdout.length > MAX_OUTPUT_LENGTH) {
            const head = stdout.substring(0, MAX_OUTPUT_LENGTH / 2);
            const tail = stdout.substring(stdout.length - MAX_OUTPUT_LENGTH / 2);
            finalOutput = `${head}\n\n... [${stdout.length - MAX_OUTPUT_LENGTH} characters truncated] ...\n\n${tail}`;
          }

          const isSuccess = exitCode === 0;

          return {
            success: isSuccess,
            llmOutput: {
              stdout: finalOutput || (isSuccess ? 'No output (success)' : 'No output (error)'),
              exitCode,
            },
            userOutput: `🐚 *Bash Execution*:\n\`\`\`bash\n${command}\n\`\`\`\nStatus: ${isSuccess ? '✅ Success' : '❌ Failed (Code ' + exitCode + ')'}`,
          };
        } catch (error: unknown) {
          const errorMsg = extractErrorMessage(error);
          return {
            success: false,
            llmOutput: `Fatal execution error: ${errorMsg}`,
            userOutput: `❌ *Bash Error* during execution of \`${command}\`\n_${errorMsg}_`,
          };
        }
      },
    }),
  ],

  async execute(
    args: unknown,
    context: unknown,
    toolName: string,
  ): Promise<{
    success: boolean;
    message?: string;
    llmOutput?: unknown;
    userOutput?: string;
  } | null> {
    // Le routage est maintenant géré dynamiquement, mais pour compatibilité avec le vieux système (pluginLoader)
    // on délègue au "_execute" injecté par defineZodTool.
    const toolDef = this.toolDefinitions.find((t) => t.function.name === toolName);
    if (!toolDef || !toolDef._execute) return null;

    // args are assumed to be already validated if coming from executeZodTool wrapper
    return (await toolDef._execute(args as never, context as never)) as Promise<{
      success: boolean;
      message?: string;
      llmOutput?: unknown;
      userOutput?: string;
    } | null>;
  },
};
