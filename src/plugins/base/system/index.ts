import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

interface SystemContext {
  transport?: unknown;
  sender?: string;
  chatId?: string;
  [key: string]: unknown;
}

interface OsShutdownArgs {
  reason: string;
  restart?: boolean;
}

interface TextMatcherMatch {
  pattern: RegExp;
  handler: string;
  description: string;
  extractArgs: (match: RegExpMatchArray, message: unknown, text: string) => Record<string, unknown>;
}

export default {
  name: 'system',
  description: 'System management (Shutdown, Restart, Shell) - SuperAdmin Only',
  version: '1.0.0',
  enabled: true,

  // Tool definitions
  toolDefinitions: [
    {
      type: 'function',
      function: {
        name: 'os_system_info',
        description: 'Displays system information (CPU, RAM, Uptime).',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'os_shutdown',
        description: 'Stops the bot (Process Exit). SUPER-ADMIN REQUIRED.',
        parameters: {
          type: 'object',
          properties: {
            reason: { type: 'string', description: 'Reason for shutdown' },
            restart: {
              type: 'boolean',
              description: 'If true, attempts a restart (via PM2/Docker)',
            },
          },
          required: ['reason'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'os_update_pull',
        description: 'Performs a Git Pull to update the bot. SUPER-ADMIN REQUIRED.',
        parameters: { type: 'object', properties: {} },
      },
    },
  ],

  textMatchers: [
    {
      pattern: /^\.(shutdown|stop)\b/i,
      handler: 'os_shutdown',
      description: 'Stop the bot',
      extractArgs: (_match: RegExpMatchArray, _message: unknown, text: string) => {
        const reason = text.replace(/^\.(shutdown|stop)\s*/i, '').trim();
        return { reason: reason || 'Manual command', restart: false };
      },
    },
    {
      pattern: /^\.(restart|reboot)\b/i,
      handler: 'os_shutdown',
      description: 'Restart the bot',
      extractArgs: () => {
        return { reason: 'Manual restart', restart: true };
      },
    },
    {
      pattern: /^\.(sys|system|status)\b/i,
      handler: 'os_system_info',
      description: 'System status',
      extractArgs: () => ({}),
    },
  ] satisfies TextMatcherMatch[],

  /**
   * Exécution des outils
   */
  async execute(args: unknown, context: SystemContext, toolName?: string) {
    const { transport, sender } = context || {};

    if (!transport) {
      return { success: false, message: 'Transport not available' };
    }
    const { adminService } = await import('../../../services/adminService.js');
    const isSuperUser = await adminService.isSuperUser(sender!);

    if (toolName !== 'os_system_info' && !isSuperUser) {
      return {
        success: false,
        message: '⛔ DENIED: Only the Creator (SuperUser) can touch the system.',
      };
    }

    switch (toolName) {
      case 'os_system_info':
        return this._getSystemInfo();

      case 'os_shutdown': {
        const shutdownArgs = args as OsShutdownArgs;
        await this._shutdown(shutdownArgs);
        return {
          success: true,
          message: `⚠️ **SHUTDOWN INITIATED**\nReason: ${shutdownArgs.reason}\nDelay: 3s...`,
        };
      }

      case 'os_update_pull':
        return await this._gitPull();

      default:
        return { success: false, message: `Unknown command: ${toolName}` };
    }
  },

  /**
   * System Info
   */
  _getSystemInfo() {
    const uptime = process.uptime();
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const loadAvg = os.loadavg();

    const formatBytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(2) + ' MB';

    return {
      success: true,
      message:
        '💻 **SYSTEM STATUS**\n' +
        `- Uptime: ${Math.floor(uptime / 60)} min\n` +
        `- RAM: ${formatBytes(memUsage.rss)} (Heap: ${formatBytes(memUsage.heapUsed)})\n` +
        `- OS Mem: ${(freeMem / 1024 / 1024 / 1024).toFixed(1)}GB free / ${(totalMem / 1024 / 1024 / 1024).toFixed(1)}GB\n` +
        `- Load: ${loadAvg[0].toFixed(2)}\n` +
        `- Arch: ${os.arch()} (${os.platform()})\n` +
        `- Node: ${process.version}`,
    };
  },

  /**
   * Shutdown / Restart
   */
  async _shutdown(args: OsShutdownArgs) {
    const action = args.restart ? 'Restart' : 'Shutdown';

    console.log(`[System] ${action} in progress... (${args.reason})`);

    // Delegate to hive-mind.ts SIGTERM handler which flushes saveCreds → disconnect → releaseLock → exit
    process.kill(process.pid, 'SIGTERM');
  },

  /**
   * Git Pull
   */
  async _gitPull() {
    try {
      const { stdout, stderr } = await execFileAsync('git', ['pull']);
      return {
        success: true,
        message: `📦 **GIT PULL**\n\`\`\`\n${stdout || stderr}\n\`\`\``,
      };
    } catch (error: unknown) {
      return { success: false, message: `Git Error: ${extractErrorMessage(error)}` };
    }
  },
};
