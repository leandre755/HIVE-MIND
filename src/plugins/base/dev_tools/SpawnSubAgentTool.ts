// plugins/dev_tools/SpawnSubAgentTool.ts
// ============================================================================
// Sub-Agent Creator Tool (Swarm Orchestration)
// Allows HIVE-MIND to dynamically instantiate specialized sub-agents
// via the universal SubAgentEngine.
// ============================================================================

import { SubAgentEngine } from '../../../services/agentic/SubAgentEngine.js';

interface SpawnSubAgentArgs {
  name: string;
  persona: string;
  tools: string[];
  mission: string;
  mode?: 'fresh' | 'fork';
}

interface SpawnSubAgentContext {
  conversationHistory?: Array<{ role: string; content: string }>;
  [key: string]: unknown;
}

export default {
  name: 'spawn_sub_agent',
  description:
    'Instantiates and executes a specialized sub-agent to accomplish a complex task in the background.',
  version: '1.0.0',
  enabled: true,

  toolDefinitions: [
    {
      type: 'function',
      function: {
        name: 'spawn_sub_agent',
        description:
          'Creates an autonomous sub-agent (Swarm) with a specific role and precise tools to accomplish a complex mission in the background. Use it to delegate long tasks or those requiring sharp specialization (e.g., fact-checking, code analysis, generating a complex research report).',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description:
                'The name of the sub-agent (e.g., "FactChecker", "MathGenius", "CodeReviewer").',
            },
            persona: {
              type: 'string',
              description:
                'The complete system prompt that defines the personality, role, and strict rules of the sub-agent (e.g. "You are a cybersecurity expert. Your mission is...").',
            },
            tools: {
              type: 'array',
              items: { type: 'string' },
              description:
                'The exact list of tools this sub-agent is allowed to use (e.g., ["duckduck_search", "read_file", "list_directory"]). ATTENTION: only give strictly necessary tools!',
            },
            mission: {
              type: 'string',
              description: 'The exact instructions and task the sub-agent must accomplish.',
            },
            mode: {
              type: 'string',
              enum: ['fresh', 'fork'],
              description:
                'The mode to launch the sub-agent. "fresh" starts with a clean context, "fork" clones the parent conversation history to maximize prompt caching and give the sub-agent full situational awareness (defaults to "fresh").',
            },
          },
          required: ['name', 'persona', 'tools', 'mission'],
        },
      },
    },
  ],

  async execute(args: SpawnSubAgentArgs, context: SpawnSubAgentContext, toolName: string) {
    if (toolName !== 'spawn_sub_agent') return null;

    const { name, persona, tools, mission, mode = 'fresh' } = args;

    console.log(`[Swarm Orchestration] 🧬 Dynamically creating sub-agent: ${name} (mode: ${mode})`);
    console.log(`[Swarm Orchestration] 🛠️ Tools allocated: ${tools.join(', ')}`);

    // Prevent delegation of critical tools like bash_eval unless explicitly verified
    const safeTools = tools.filter((tool: string) => tool !== 'bash_eval');

    if (safeTools.length !== tools.length) {
      console.warn('[Swarm Orchestration] ⚠️ bash_eval was removed for security reasons.');
    }

    const parentHistory = mode === 'fork' ? context.conversationHistory : undefined;

    const dynamicEngine = new SubAgentEngine({
      name,
      systemPrompt: persona,
      allowedTools: safeTools,
      maxIterations: 10, // Reasonable limit for a dynamic agent
      category: 'AGENTIC', // Force use of a reasoning model
      parentHistory,
    });

    const result = await dynamicEngine.run(mission, context);

    return {
      success: result.success,
      message: result.message,
    };
  },
};
