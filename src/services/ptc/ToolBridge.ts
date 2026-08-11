/**
 * ToolBridge — Pont entre les plugins HIVE-MIND et le sandbox PTC
 *
 * WHY: Le PTC executor a besoin de fonctions `async (args) => result` pour chaque outil.
 * Les plugins HIVE-MIND utilisent le format OpenAI (`toolDefinition`) et s'exécutent
 * via `pluginLoader.execute(name, args, context)`. Ce bridge fait la conversion.
 */

import type { ToolFunction, OpenAIToolDefinition } from './types.js';

/** Contexte d'exécution transmis aux plugins */
interface ToolExecutionContext {
  readonly transport: unknown;
  readonly message: unknown;
  readonly chatId: string;
  readonly sender: string;
  readonly sourceChannel?: string;
  readonly onProgress?: (status: string) => void;
}

/** Fonction qui exécute un plugin par son nom */
type PluginExecuteFn = (
  toolName: string,
  args: Record<string, unknown>,
  context: ToolExecutionContext,
) => Promise<unknown>;

/**
 * Crée une Map de fonctions exécutables à partir des tool definitions HIVE-MIND.
 *
 * @param toolDefs — Définitions d'outils au format OpenAI (depuis pluginLoader.getRelevantTools)
 * @param executeFn — Fonction d'exécution (typiquement pluginLoader.execute)
 * @param context — Contexte de message courant (transport, chatId, sender, etc.)
 * @returns Map<toolName, async (args) => result>
 */
export function buildToolFunctions(
  toolDefs: readonly OpenAIToolDefinition[],
  executeFn: PluginExecuteFn,
  context: ToolExecutionContext,
): Map<string, ToolFunction> {
  const fns = new Map<string, ToolFunction>();

  for (const def of toolDefs) {
    const toolName = def.function.name;

    // Ne pas inclure le meta-tool lui-même (évite la récursion)
    if (toolName === 'code_execution') continue;

    fns.set(toolName, async (args: Record<string, unknown>) => {
      return executeFn(toolName, args, context);
    });
  }

  return fns;
}
