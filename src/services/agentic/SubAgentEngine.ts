import {
  TOOL_USE_GUIDELINES,
  ERROR_HANDLING_RULES,
  FEW_SHOT_EXAMPLES,
} from '../../constants/systemPromptSections.js';
// services/agentic/SubAgentEngine.ts
// ============================================================================
// Moteur Universel de Sous-Agents (Swarm Architecture)
// Gère une boucle ReAct isolée avec un Persona et des outils restreints.
// ============================================================================

import { providerRouter, type ChatResponse } from '../../providers/index.js';
import { pluginLoader } from '../../plugins/loader.js';
import { blueprintManager, type AgentBlueprint } from '../../core/blueprint/AgentBlueprint.js';
import { validateToolArgs } from '../../utils/toolValidator.js';

interface SubAgentContext {
  readonly blueprint?: AgentBlueprint;
  readonly [key: string]: unknown;
}

export interface SubAgentConfig {
  name: string;
  systemPrompt: string;
  allowedTools: string[];
  maxIterations?: number;
  category?: string;
  parentHistory?: readonly SubAgentMessage[];
}

interface SubAgentMessage {
  readonly role: string;
  readonly content: string | null;
  readonly tool_calls?: readonly SubAgentToolCall[];
  readonly tool_call_id?: string;
  readonly name?: string;
}

interface SubAgentToolCall {
  readonly id: string;
  readonly type: string;
  readonly function: {
    readonly name: string;
    readonly arguments: string;
  };
}

interface SubAgentResult {
  success: boolean;
  message: string;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

function buildForkHistory(config: SubAgentConfig, task: string): SubAgentMessage {
  return {
    role: 'user',
    content:
      `[FORK MISSION - ${config.name}]\n` +
      "Tu es un sous-agent spécialisé issu d'un fork.\n" +
      `Ton rôle spécifique : ${config.systemPrompt}\n` +
      `Tes consignes de sécurité :\n${TOOL_USE_GUIDELINES}\n${ERROR_HANDLING_RULES}\n${FEW_SHOT_EXAMPLES}\n` +
      `Mission spécifique à accomplir en tâche de fond : ${task}\n` +
      "Fais tes appels d'outils et rédige ton rapport final détaillé destiné à ton agent parent.",
  };
}

function buildFreshHistory(config: SubAgentConfig, task: string): SubAgentMessage[] {
  return [
    {
      role: 'system',
      content: `${config.systemPrompt}\n\n${TOOL_USE_GUIDELINES}\n${ERROR_HANDLING_RULES}\n${FEW_SHOT_EXAMPLES}\n\nRÈGLES STRICTES:\n- Explore tes outils pour trouver ou construire la réponse.\n- Ta mission est de répondre à l'instruction de l'utilisateur de manière la plus détaillée possible.\n- Ne dépasse pas ${config.maxIterations} itérations.\n- Ton rapport final doit être riche et actionnable directement par l'agent principal.`,
    },
    {
      role: 'user',
      content: `Mission: ${task}`,
    },
  ];
}

function parseToolArgs(rawArgs: string): Record<string, unknown> {
  try {
    return JSON.parse(rawArgs) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function buildAssistantMsg(response: ChatResponse): SubAgentMessage {
  const toolCalls =
    response.toolCalls && response.toolCalls.length > 0
      ? (response.toolCalls as unknown as SubAgentToolCall[])
      : undefined;
  return {
    role: 'assistant',
    content: response.content || null,
    tool_calls: toolCalls,
  };
}

function buildToolResultMsg(call: SubAgentToolCall, result: unknown): SubAgentMessage {
  return {
    role: 'tool',
    tool_call_id: call.id,
    name: call.function.name,
    content: typeof result === 'string' ? result : JSON.stringify(result),
  };
}

export class SubAgentEngine {
  private config: SubAgentConfig;

  constructor(config: SubAgentConfig) {
    this.config = {
      maxIterations: 10,
      category: 'AGENTIC',
      ...config,
    };
  }

  async run(task: string, context: SubAgentContext): Promise<SubAgentResult> {
    console.log(
      `[SubAgentEngine:${this.config.name}] 🚀 Lancement de la mission: "${task.substring(0, 50)}..."`,
    );

    const blueprintId = `sub_agent_${this.config.name.toLowerCase()}_${Date.now()}`;
    const parentReadOnlyFs = context?.blueprint?.constraints?.read_only_fs ?? false;

    const subBlueprint: AgentBlueprint = {
      metadata: {
        id: blueprintId,
        name: this.config.name,
        version: '1.0.0',
      },
      mindos: {
        drives: [],
      },
      action_space: {
        allowed_tools: this.config.allowedTools,
      },
      constraints: {
        read_only_fs: parentReadOnlyFs,
        max_budget_usd: context?.blueprint?.constraints?.max_budget_usd ?? 0.1,
        max_iterations: this.config.maxIterations || 10,
      },
    };

    blueprintManager.registerEphemeral(subBlueprint);

    const subContext: SubAgentContext = {
      ...context,
      blueprint: subBlueprint,
    };

    try {
      const allToolDefs = pluginLoader.getToolDefinitions();
      const allowedToolsDefs = allToolDefs.filter((t) =>
        this.config.allowedTools.includes(t.function?.name),
      );

      if (allowedToolsDefs.length === 0 && this.config.allowedTools.length > 0) {
        console.warn(
          `[SubAgentEngine:${this.config.name}] ⚠️ Aucun outil autorisé trouvé dans la liste des plugins.`,
        );
      }

      const subAgentHistory = this.buildInitialHistory(task);

      return await this.executeLoop(subAgentHistory, allowedToolsDefs, subContext);
    } finally {
      blueprintManager.cleanupEphemeral(blueprintId);
    }
  }

  private buildInitialHistory(task: string): SubAgentMessage[] {
    if (this.config.parentHistory && this.config.parentHistory.length > 0) {
      const history = [...this.config.parentHistory];
      history.push(buildForkHistory(this.config, task));
      return history;
    }
    return buildFreshHistory(this.config, task);
  }

  private async executeLoop(
    subAgentHistory: SubAgentMessage[],
    allowedToolsDefs: { function: { name: string } }[],
    subContext: SubAgentContext,
  ): Promise<SubAgentResult> {
    let iterations = 0;
    let finalReport = '';
    const START_TIME = Date.now();
    const MAX_DURATION_MS = 120000;

    while (iterations < this.config.maxIterations!) {
      iterations++;

      if (Date.now() - START_TIME > MAX_DURATION_MS) {
        console.warn(`[SubAgentEngine:${this.config.name}] ⏱️ Timeout forcé après 2 minutes.`);
        finalReport =
          'La recherche a été interrompue car elle prenait trop de temps. Voici les informations partielles collectées.';
        break;
      }

      try {
        console.log(
          `[SubAgentEngine:${this.config.name}] 🔄 Itération ${iterations}/${this.config.maxIterations}`,
        );

        const response: ChatResponse = await providerRouter.chat(subAgentHistory as unknown[], {
          category: this.config.category,
          tools: allowedToolsDefs.length > 0 ? allowedToolsDefs : undefined,
        });

        subAgentHistory.push(buildAssistantMsg(response));

        if (!response.toolCalls || response.toolCalls.length === 0) {
          finalReport = response.content || '';
          break;
        }

        if (iterations >= this.config.maxIterations!) {
          console.warn(
            `[SubAgentEngine:${this.config.name}] ⚠️ Max itérations atteint, forçage d'une conclusion.`,
          );
          subAgentHistory.push({
            role: 'user',
            content:
              "Tu as atteint ta limite d'actions. Fais un rapport final très complet avec ce que tu as appris jusqu'ici.",
          });

          const forcedConclusion: ChatResponse = await providerRouter.chat(
            subAgentHistory as unknown[],
            {
              category: this.config.category,
            },
          );
          finalReport = forcedConclusion.content || '';
          break;
        }

        await this.executeToolCalls(response, subAgentHistory, allowedToolsDefs, subContext);
      } catch (error: unknown) {
        const errorMessage = extractErrorMessage(error);
        console.error(
          "[SubAgentEngine:%s] ❌ Erreur à l'itération %d:",
          this.config.name,
          iterations,
          errorMessage,
        );
        return {
          success: false,
          message: `[ERREUR SOUS-AGENT] Impossible de terminer la tâche: ${errorMessage}`,
        };
      }
    }

    const report = finalReport || "Opération terminée mais aucun rapport textuel n'a été généré.";
    console.log(
      `[SubAgentEngine:${this.config.name}] ✅ Fin (${iterations} itérations). Rapport généré.`,
    );

    const cleanedReport = report.replace(/<(think|thought|thinking)>[\s\S]*?<\/\1>/gi, '').trim();

    return {
      success: true,
      message: `[Rapport de ${this.config.name}] :\n${cleanedReport}`,
    };
  }

  private async executeToolCalls(
    response: ChatResponse,
    subAgentHistory: SubAgentMessage[],
    allowedToolsDefs: { function: { name: string } }[],
    subContext: SubAgentContext,
  ): Promise<void> {
    for (const call of response.toolCalls!) {
      const toolCall = call as SubAgentToolCall;
      const toolArgs = parseToolArgs(toolCall.function.arguments);

      if (!this.config.allowedTools.includes(toolCall.function.name)) {
        subAgentHistory.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: JSON.stringify({
            error: `Outil "${toolCall.function.name}" non autorisé pour cet agent.`,
          }),
        });
        continue;
      }

      const validation = validateToolArgs(
        toolCall.function.name,
        JSON.stringify(toolArgs),
        allowedToolsDefs,
      );
      if (!validation.valid) {
        console.warn(
          `[SubAgentEngine:${this.config.name}] ⚠️ Validation failed for "${toolCall.function.name}": ${validation.formattedError}`,
        );
        subAgentHistory.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: validation.formattedError || 'Validation failed',
        });
        continue;
      }

      const result = await pluginLoader.execute(
        toolCall.function.name,
        toolArgs,
        subContext as unknown as Record<string, unknown>,
      );
      subAgentHistory.push(buildToolResultMsg(toolCall, result));
    }
  }
}
