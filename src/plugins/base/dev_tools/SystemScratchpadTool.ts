// plugins/dev_tools/SystemScratchpadTool.ts
// ============================================================================
// Sous-Agent Isolé (Scratchpad Pattern) via le SubAgentEngine universel
// ============================================================================

import { SubAgentEngine } from '../../../services/agentic/SubAgentEngine.js';

interface ScratchpadArgs {
  instructions: string;
}

interface ScratchpadContext {
  [key: string]: unknown;
}

export default {
  name: 'system_scratchpad',
  description:
    'Isolated system scratchpad. Allows executing a complex series of read-only tools (grep, list_dir, read_file, search) in the background without polluting your main memory.',
  version: '2.0.0',
  enabled: true,

  toolDefinitions: [
    {
      type: 'function',
      function: {
        name: 'run_scratchpad',
        description:
          'Invokes an isolated "Scratchpad" process to perform research or complex reads. It works in the background and returns a summary. Use it when you need to search through many files or execute multiple read commands to understand a complex system.',
        parameters: {
          type: 'object',
          properties: {
            instructions: {
              type: 'string',
              description:
                'Strict and detailed instructions for the sub-agent (what it should search/analyze).',
            },
          },
          required: ['instructions'],
        },
      },
    },
  ],

  async execute(args: ScratchpadArgs, context: ScratchpadContext, toolName: string) {
    if (toolName !== 'run_scratchpad') return null;

    const { instructions } = args;
    // WHY: The Planner sometimes omits required params, causing SubAgentEngine.run(undefined)
    // to crash with "Cannot read properties of undefined (reading 'substring')".
    // Fail closed with a structured error the LLM can act on.
    if (!instructions || typeof instructions !== 'string') {
      return {
        success: false,
        message: `TOOL_ERROR: run_scratchpad requires an "instructions" parameter (string). Got ${typeof instructions}. Please retry with a detailed instructions string.`,
      };
    }

    const scratchpadEngine = new SubAgentEngine({
      name: 'SystemScratchpad',
      systemPrompt: `You are an isolated system research process (Scratchpad) for HIVE-MIND.
STRICT RULES:
- You have access ONLY to READ tools (no writing, no destructive bash).
- Explore the system and files, use your tools. When you find the answer, give a VERY DETAILED and TECHNICAL summary.
- Your final report must be usable by the Main Agent without needing to re-read the files.`,
      allowedTools: ['list_directory', 'grep_search', 'read_file', 'duckduck_search'],
      maxIterations: 5, // Limite basse pour éviter de consommer trop de tokens
      category: 'AGENTIC', // ou FAST_CHAT selon la rapidité voulue
    });

    const result = await scratchpadEngine.run(instructions, context);

    return {
      success: result.success,
      message: result.message,
    };
  },
};
