// plugins/dev_tools/index.ts
// ============================================================================
// Aggregateur unifié des Dev Tools (BashTool + FileEditTool + SearchTools)
// Ce fichier est le seul point d'entrée chargé par PluginLoader (index.js).
// Il aggège les définitions et délègue l'exécution aux sous-modules.
// ============================================================================

import BashTool from './BashTool.js';
import FileEditTool from './FileEditTool.js';
import SearchTools from './SearchTools.js';
import ASTTools from './ASTTools.js';
import SystemScratchpadTool from './SystemScratchpadTool.js';
import SpawnSubAgentTool from './SpawnSubAgentTool.js';
import BrowserTools from './BrowserTools.js';
import LSPTool from './LSPTool.js';

interface DevToolsContext {
  transport?: {
    sendText: (chatId: string | undefined, text: string) => Promise<void>;
    setPresence: (chatId: string | undefined, presence: string) => Promise<void>;
    sendContact: (chatId: string | undefined, name: string, phone: string) => Promise<void>;
  };
  chatId?: string;
  [key: string]: unknown;
}

// ──────────────────────────────────────────────────────────────────────────────
// MATCHERS TEXTUELS — Commandes admin rapides (sans LLM)
// ──────────────────────────────────────────────────────────────────────────────
const TEXT_MATCHERS = [
  {
    pattern: /^\.shutdown$/i,
    handler: 'shutdown_bot',
    description: 'Stops the bot process',
    extractArgs: () => ({}),
  },
  {
    pattern: /^\.devcontact$/i,
    handler: 'send_dev_contact',
    description: 'Sends the developer contact card',
    extractArgs: () => ({}),
  },
];

// ──────────────────────────────────────────────────────────────────────────────
// TOOL DEFINITIONS — Agrégées depuis les sous-modules
// Exposées ici pour que PluginLoader les enregistre et les rende visibles au LLM
// ──────────────────────────────────────────────────────────────────────────────
const AGGREGATED_TOOL_DEFINITIONS = [
  ...BashTool.toolDefinitions,
  ...FileEditTool.toolDefinitions,
  ...SearchTools.toolDefinitions,
  ...ASTTools.toolDefinitions,
  ...SystemScratchpadTool.toolDefinitions,
  ...SpawnSubAgentTool.toolDefinitions,
  ...BrowserTools.toolDefinitions,
  ...LSPTool.toolDefinitions,
];

interface DevToolModule {
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  toolDefinitions: Array<{ function?: { name?: string } }>;
  execute: (args: unknown, context: DevToolsContext, toolName: string) => Promise<unknown>;
}

// ──────────────────────────────────────────────────────────────────────────────
// MAP outil → sous-module (routing O(1))
// ──────────────────────────────────────────────────────────────────────────────
const TOOL_ROUTER = new Map<string, DevToolModule>();

const tools: DevToolModule[] = [
  BashTool as unknown as DevToolModule,
  FileEditTool as unknown as DevToolModule,
  SearchTools as unknown as DevToolModule,
  ASTTools as unknown as DevToolModule,
  SystemScratchpadTool as unknown as DevToolModule,
  SpawnSubAgentTool as unknown as DevToolModule,
  BrowserTools as unknown as DevToolModule,
  LSPTool as unknown as DevToolModule,
];

for (const toolModule of tools) {
  for (const toolDef of toolModule.toolDefinitions) {
    const toolName = toolDef.function?.name;
    if (toolName) TOOL_ROUTER.set(toolName, toolModule);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// EXPORT — Format Plugin standard attendu par PluginLoader
// ──────────────────────────────────────────────────────────────────────────────
export default {
  name: 'dev_tools',
  description:
    'Agent development tools: secure bash execution (YOLO sandbox), exact replacement file editing, reading/searching (LS, Grep, ReadFile), and system admin commands.',
  version: '2.0.0',
  enabled: true,

  // Matchers textuels pour commandes admin rapides
  textMatchers: TEXT_MATCHERS,

  // Définitions d'outils agrégées (visibles par le LLM)
  toolDefinitions: AGGREGATED_TOOL_DEFINITIONS,

  /**
   * Exécution des outils
   * @param args       - Arguments fournis par le LLM
   * @param context    - Contexte (transport, chatId, sender, sourceChannel…)
   * @param toolName   - Nom de l'outil à exécuter
   */
  async execute(args: unknown, context: DevToolsContext, toolName: string) {
    // Déstructuration défensive du contexte
    const { transport, chatId } = context || {};

    // ── Textual admin commands ──────────────────────────────────────
    if (toolName === 'shutdown_bot') {
      console.log('🛑 Shutdown requested via .shutdown command');
      if (transport) {
        await transport.sendText(chatId, '🛑 System shutting down...');
        // setPresence is the standard method from TransportManager
        await transport.setPresence(chatId, 'unavailable').catch(() => {});
      }
      process.kill(process.pid, 'SIGTERM');
      return { success: true, message: 'Bot shut down' };
    }

    if (toolName === 'send_dev_contact') {
      if (transport) {
        await transport.sendContact(chatId, 'Christ-Léandre', '2250150618253');
        return { success: true, message: 'Contact sent' };
      }
      return { success: false, message: 'Transport unavailable' };
    }

    // ── Routing to agent sub-module ──────────────────────────────────
    const subModule = TOOL_ROUTER.get(toolName);
    if (!subModule) {
      return {
        success: false,
        message: `[dev_tools] Unknown tool: "${toolName}". Available tools: ${Array.from(TOOL_ROUTER.keys()).join(', ')}`,
      };
    }

    return subModule.execute(args, context, toolName);
  },
};
