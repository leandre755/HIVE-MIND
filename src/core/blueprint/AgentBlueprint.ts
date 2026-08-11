import { z } from 'zod';
import { safeReadFileSync, safeExistsSync, resolveWithinRoot } from '../../utils/safeFs.js';

// 1. Definition of the strict Standard AgenticFormat Schema via Zod
export const AgenticFormatSchema = z.object({
  metadata: z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
  }),
  mindos: z.object({
    drives: z.array(z.string()), // Core drives/motivations
  }),
  action_space: z.object({
    allowed_tools: z.array(z.string()), // Tool whitelist
  }),
  constraints: z.object({
    read_only_fs: z.boolean().default(false),
    max_budget_usd: z.number().default(1.0),
    max_iterations: z.number().default(10),
  }),
});

export type AgentBlueprint = z.infer<typeof AgenticFormatSchema>;

class BlueprintManager {
  // Ephemeral registry in RAM for sub-agents
  private ephemeralRegistry: Map<string, AgentBlueprint> = new Map();

  /**
   * Loads a blueprint by ID. Checks RAM first, then resolves from config/blueprints/
   */
  public loadBlueprint(blueprintId: string): AgentBlueprint {
    // 1. RAM first (ephemeral sub-agents)
    if (this.ephemeralRegistry.has(blueprintId)) {
      return this.ephemeralRegistry.get(blueprintId)!;
    }

    // 2. Disk fallback (static system blueprints)
    const blueprintRoot = resolveWithinRoot(process.cwd(), 'src/config/blueprints');
    const path = resolveWithinRoot(blueprintRoot, `${blueprintId}.json`);
    if (!safeExistsSync(path)) {
      throw new Error(
        `[BlueprintManager] Blueprint file not found on disk: src/config/blueprints/${blueprintId}.json`,
      );
    }

    try {
      const rawContent = safeReadFileSync(path, 'utf-8');
      const parsed = JSON.parse(rawContent);
      return AgenticFormatSchema.parse(parsed);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[BlueprintManager] Failed parsing blueprint "%s":', blueprintId, message);
      throw new Error(
        `[BlueprintManager] Invalid blueprint format for "${blueprintId}": ${message}`,
      );
    }
  }

  /**
   * Registers a dynamically generated blueprint to RAM.
   * Returns the registered blueprint ID.
   */
  public registerEphemeral(blueprintData: unknown): string {
    try {
      const validated = AgenticFormatSchema.parse(blueprintData);
      this.ephemeralRegistry.set(validated.metadata.id, validated);
      return validated.metadata.id;
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      console.error('[BlueprintManager] Ephemeral registration rejected:', message);
      throw new Error(`[BlueprintManager] Ephemeral schema validation failed: ${message}`);
    }
  }

  /**
   * Removes an ephemeral blueprint from RAM.
   */
  public cleanupEphemeral(blueprintId: string): void {
    const deleted = this.ephemeralRegistry.delete(blueprintId);
    if (deleted) {
      console.log(
        `[BlueprintManager] Ephemeral blueprint "${blueprintId}" successfully garbage-collected.`,
      );
    }
  }
}

export const blueprintManager = new BlueprintManager();
export default blueprintManager;
