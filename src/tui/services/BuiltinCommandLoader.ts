/**
 * BuiltinCommandLoader — Commandes HIVE-MIND TUI
 *
 * Seules les commandes utiles pour un transport simple sont conservées.
 * Pas d'extensions, pas de MCP, pas de Gemma, pas de skills.
 */

import { ICommandLoader, SlashCommand } from '../ui/contexts/UIStateContext.js';
import { aboutCommand } from '../ui/commands/aboutCommand.js';
import { clearCommand } from '../ui/commands/clearCommand.js';
import { commandsCommand } from '../ui/commands/commandsCommand.js';
import { helpCommand } from '../ui/commands/helpCommand.js';
import { quitCommand } from '../ui/commands/quitCommand.js';
import { themeCommand } from '../ui/commands/themeCommand.js';
import { modelCommand } from '../ui/commands/modelCommand.js';
import { memoryCommand } from '../ui/commands/memoryCommand.js';
import { hiveCommands } from '../ui/commands/hiveCommands.js';

export class BuiltinCommandLoader implements ICommandLoader {
  async loadCommands(_signal: AbortSignal): Promise<SlashCommand[]> {
    const allDefinitions: Array<SlashCommand | null> = [
      aboutCommand,
      clearCommand,
      commandsCommand,
      helpCommand,
      quitCommand,
      themeCommand,
      modelCommand,
      memoryCommand(null),
      ...hiveCommands,
    ];
    return allDefinitions.filter((cmd): cmd is SlashCommand => cmd !== null);
  }
}
