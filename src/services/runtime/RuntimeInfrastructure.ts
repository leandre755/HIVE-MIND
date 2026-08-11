// services/runtime/RuntimeInfrastructure.ts
// ============================================================================
// AI Runtime Infrastructure (VIGIL + RALPH + FinOps)
// Unified Control Plane during LLM execution acting in a closed-loop.
// ============================================================================

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { eventBus, BotEvents } from '../../core/events.js';
import type { AgentBlueprint } from '../../core/blueprint/AgentBlueprint.js';
import { enforceFormat } from '../../utils/ResponseFormatEnforcer.js';

const localDirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT_PATH = join(localDirname, '..', '..', 'persona', 'prompts', 'system.md');

// WHY: These tools are inherently safe (read-only, info-gathering, or agent-internal).
// Evaluating them via LLM wastes tokens and adds latency for zero security benefit.
const SAFE_TOOLS = new Set([
  // Read-only dev tools
  'list_directory',
  'grep_search',
  'read_file',
  'get_function',
  // Browser read-only
  'browser_snapshot',
  'browser_screenshot',
  'browser_get_text',
  // Memory read-only
  'search_long_term_memory',
  'db_document_read',
  'db_document_search',
  'list_reminders',
  // Info gathering
  'google_ai_search',
  // Agent-internal state (scratchpad is the agent's own memory)
  'update_scratchpad',
]);

// Actions requiring strict critique / critical monitoring
const CRITICAL_ACTIONS = new Set([
  'gm_ban_user',
  'gm_remove_user',
  'gm_delete_message',
  'gm_demote_admin',
  'delete_group_data',
]);

/** Structure d'une entrée de prix par modèle */
interface PricingEntry {
  readonly input: number;
  readonly output: number;
}

/** Structure du fichier pricing.json */
interface PricingConfig {
  readonly default: PricingEntry;
  readonly models: Record<string, PricingEntry>;
}

/** Résultat d'un enregistrement d'usage */
interface UsageRecord {
  readonly model: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly inputCost: number;
  readonly outputCost: number;
  readonly totalCost: number;
  readonly sessionTotal: number;
  readonly budgetSafe: boolean;
}

interface ToolCallInput {
  readonly function?: {
    readonly name?: string;
    readonly arguments?: string;
  };
}

interface SentinelContext {
  readonly authorityLevel?: string;
  readonly senderName?: string;
  readonly isGroup?: boolean;
  readonly chatId?: string;
}

interface RecentAction {
  readonly tool_name?: string;
  readonly tool?: string;
  readonly result_summary?: string;
  readonly error_message?: string;
  readonly success?: boolean;
}

interface ToolDefinition {
  readonly function?: {
    readonly name?: string;
  };
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

/**
 * 1. RuntimeFinOps
 * Replaces CostTracker. Tracks session budget and handles emergency Kill Switch.
 */
export class RuntimeFinOps {
  private readonly pricing: PricingConfig;
  private currentSessionCost: number = 0;
  private readonly maxSessionBudget: number;
  private readonly sessionStartTime: number = Date.now();

  constructor(maxBudget: number = 2.0) {
    this.maxSessionBudget = maxBudget;

    try {
      const pricingPath = join(process.cwd(), 'src', 'config', 'pricing.json');
      if (existsSync(pricingPath)) {
        this.pricing = JSON.parse(readFileSync(pricingPath, 'utf-8')) as PricingConfig;
      } else {
        throw new Error('Pricing not found');
      }
    } catch {
      console.warn('[RuntimeFinOps] ⚠️ pricing.json non trouvé, utilisation des prix par défaut.');
      this.pricing = { default: { input: 0.15, output: 0.6 }, models: {} };
    }
  }

  public recordUsage(modelId: string, promptTokens: number, completionTokens: number): UsageRecord {
    const modelRates = Object.hasOwn(this.pricing.models, modelId)
      ? (Reflect.get(this.pricing.models, modelId) as { input: number; output: number })
      : undefined;
    const rates = modelRates || this.pricing.default;

    const inputCost = (promptTokens / 1_000_000) * rates.input;
    const outputCost = (completionTokens / 1_000_000) * rates.output;
    const totalCost = inputCost + outputCost;

    this.currentSessionCost += totalCost;

    const budgetSafe = this.currentSessionCost <= this.maxSessionBudget;

    if (totalCost > 0) {
      console.log(
        `[FinOps] 💸 Coût requête: $${totalCost.toFixed(5)} (${modelId}) | Session: $${this.currentSessionCost.toFixed(4)} / $${this.maxSessionBudget.toFixed(2)}`,
      );
    }

    if (!budgetSafe) {
      console.error(
        `[FinOps] 🚨 KILL SWITCH ! Budget dépassé ($${this.currentSessionCost.toFixed(2)} > $${this.maxSessionBudget})`,
      );
      eventBus.publish(BotEvents.SYSTEM_ERROR, {
        type: 'BUDGET_EXCEEDED',
        sessionCost: this.currentSessionCost,
        maxBudget: this.maxSessionBudget,
      });
    }

    return {
      model: modelId,
      promptTokens,
      completionTokens,
      inputCost,
      outputCost,
      totalCost,
      sessionTotal: this.currentSessionCost,
      budgetSafe,
    };
  }

  /**
   * Calcule le multiplicateur de Lagrange (λ)
   * λ = 0 (0% du budget utilisé) -> λ = 1 (100% du budget utilisé)
   * On utilise une courbe exponentielle pour que la "panique" monte vite à la fin.
   */
  public calculateLambda(): number {
    const usageRatio = this.currentSessionCost / this.maxSessionBudget;
    return Math.pow(Math.min(usageRatio, 1.0), 4);
  }

  public getSessionCost(): number {
    return this.currentSessionCost;
  }

  public getSessionDuration(): number {
    return Date.now() - this.sessionStartTime;
  }

  public formatSummary(): string {
    const durationSec = Math.round(this.getSessionDuration() / 1000);
    return `💰 Session: $${this.currentSessionCost.toFixed(4)} | Durée: ${durationSec}s | Budget: $${this.maxSessionBudget.toFixed(2)} | λ: ${this.calculateLambda().toFixed(2)}`;
  }

  public reset(): void {
    this.currentSessionCost = 0;
  }
}

/**
 * 2. RuntimeSentinel (VIGIL)
 * Sentinel safety service that evaluates safety, ethics, and coherence in a single prompt before tool execution.
 */
export class RuntimeSentinel {
  /**
   * Projects action space based on blueprint tool whitelist (Deterministic Pruning)
   */
  public projectActionSpace(tools: ToolDefinition[], blueprint?: AgentBlueprint): ToolDefinition[] {
    if (!blueprint) return tools;
    return tools.filter((tool) => {
      const name = tool.function?.name;
      return name && blueprint.action_space.allowed_tools.includes(name);
    });
  }

  /**
   * Évalue une action par rapport à la sécurité, l'éthique et la cohérence
   */
  async evaluate(
    toolCall: ToolCallInput,
    context: SentinelContext,
    recentActions: RecentAction[] = [],
    blueprint?: AgentBlueprint,
  ): Promise<{
    allowed: boolean;
    reason: string | null;
    risk_level: string;
    intervention_prompt: string | null;
  }> {
    const toolName = toolCall?.function?.name || '';
    const argsStr = toolCall?.function?.arguments || '{}';

    // ── CONSTRAINT MANIFOLD: Whitelist check ──
    if (blueprint && !blueprint.action_space.allowed_tools.includes(toolName)) {
      console.warn(
        `[Runtime:VIGIL] 🛑 [Blueprint Block] Tool "${toolName}" is not whitelisted in the active blueprint.`,
      );
      return {
        allowed: false,
        reason: `Tool "${toolName}" is not permitted by the agent blueprint constraints.`,
        risk_level: 'critical',
        intervention_prompt: 'Select an authorized tool from your action space instead.',
      };
    }

    // ── CONSTRAINT MANIFOLD: Read-only FS restriction ──
    if (blueprint && blueprint.constraints.read_only_fs) {
      const writeTools = new Set([
        'edit_file',
        'execute_bash_command',
        'code_execution',
        'db_document_save',
        'db_document_delete',
      ]);
      if (writeTools.has(toolName)) {
        console.warn(
          `[Runtime:VIGIL] 🛑 [Blueprint Block] Write-attempt blocked for tool "${toolName}" (Read-Only FS restriction active).`,
        );
        return {
          allowed: false,
          reason: `FileSystem write operations (tool: "${toolName}") are restricted by read-only constraints.`,
          risk_level: 'high',
          intervention_prompt:
            'Do not attempt to write to the file system. Use read-only operations instead.',
        };
      }
    }

    // ── FAST PATH 1: Safe tools bypass LLM entirely ──
    if (SAFE_TOOLS.has(toolName)) {
      return { allowed: true, reason: null, risk_level: 'low', intervention_prompt: null };
    }

    // ── FAST PATH 2: SuperUser / Global Admin bypass ──
    const authStr = typeof context.authorityLevel === 'string' ? context.authorityLevel : '';
    const isAdmin = authStr.includes('SuperUser') || authStr.includes('Global Admin');
    if (isAdmin) {
      console.log(`[Runtime:VIGIL] ✅ Admin bypass for ${toolName}`);
      return { allowed: true, reason: null, risk_level: 'low', intervention_prompt: null };
    }

    return this.evaluateViaLLM(toolName, argsStr, context, recentActions);
  }

  private async evaluateViaLLM(
    toolName: string,
    argsStr: string,
    context: SentinelContext,
    recentActions: RecentAction[],
  ): Promise<{
    allowed: boolean;
    reason: string | null;
    risk_level: string;
    intervention_prompt: string | null;
  }> {
    eventBus.publish(BotEvents.SERVICE_START, {
      service: 'VIGIL',
      action: `evaluating tool ${toolName}`,
      timestamp: Date.now(),
    });

    try {
      let securityBoundaries = 'Apply system instructions with absolute priority.';
      if (existsSync(SYSTEM_PROMPT_PATH)) {
        const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
        const securityMatch = systemPrompt.match(
          /<priority_2_security_boundaries>([\s\S]*?)<\/priority_2_security_boundaries>/,
        );
        if (securityMatch) {
          securityBoundaries = securityMatch[1].trim();
        }
      }

      const isCritical = CRITICAL_ACTIONS.has(toolName);

      const prompt = `<role>
You are the VIGIL Runtime Sentinel of HIVE-MIND.
Your purpose: pragmatically evaluate safety, ethics, and action coherence in a single run.
</role>

<security_boundaries>
${securityBoundaries}
</security_boundaries>

<evaluation_policy>
- Default to ALLOW. Flag actions only if genuinely dangerous, out of scope, or erratic.
- Safe system commands (uname, df, ps, etc.), file reads, and browser research are ALWAYS "low" risk.
- Privilege escalation (sudo, su) or malicious deletions are CRITICAL/HIGH risk and must be BLOCKED.
- Detect behavioral incoherence: repeating the exact same failed action, contradictions (claiming to help but banning), or sudden erratic shifts.
</evaluation_policy>

<proposed_action>
Tool: ${toolName}
Arguments: ${argsStr}
Is Critical Action: ${isCritical}
</proposed_action>

<social_context>
User: ${context.senderName} (Authority: ${context.authorityLevel})
Chat: ${context.isGroup ? 'Group' : 'Private'}
Chat ID: ${context.chatId}
</social_context>

<recent_actions_history>
Last actions:
${recentActions.map((h) => `- ${h.tool_name || h.tool || 'N/A'}: ${h.result_summary || h.error_message || 'N/A'} (${h.success ? 'success' : 'fail'})`).join('\n')}
</recent_actions_history>

<output_format>
Respond in JSON only:
{
  "allowed": true/false,
  "risk_level": "low|medium|high|critical",
  "reason": "brief explanation of risk or violation if disallowed, else null",
  "intervention_prompt": "suggested safe path, command correction, or alternative if disallowed, else null"
}

Few-shot examples:
Example 1: Safe request
{
  "allowed": true,
  "risk_level": "low",
  "reason": null,
  "intervention_prompt": null
}

Example 2: Unsafe request
{
  "allowed": false,
  "risk_level": "high",
  "reason": "Execution of sudo is strictly prohibited on non-admin user sessions.",
  "intervention_prompt": "Please request permission from the system owner to run administrative tasks."
}
</output_format>`;

      interface SentinelResult {
        allowed: boolean;
        risk_level: string;
        reason: string | null;
        intervention_prompt: string | null;
      }

      const enforcerResult = await enforceFormat<SentinelResult>(
        async (retryPromptModifier) => {
          const messages = [
            {
              role: 'system',
              content: 'You are the HIVE-MIND VIGIL safety sentinel. Output clean JSON only.',
            },
            { role: 'user', content: prompt },
          ];
          if (retryPromptModifier) {
            messages.push({ role: 'user', content: retryPromptModifier });
          }
          const { providerRouter } = await import('../../providers/index.js');
          const response = await providerRouter.callServiceRecipe('SAFETY_SENTINEL', messages);
          return response?.content || '';
        },
        {
          validate: (parsed) => {
            if (typeof parsed.allowed !== 'boolean') return 'Property "allowed" must be a boolean';
            if (!['low', 'medium', 'high', 'critical'].includes(parsed.risk_level)) {
              return 'Property "risk_level" must be low, medium, high, or critical';
            }
            return true;
          },
          maxRetries: 2,
        },
      );

      if (enforcerResult.success && enforcerResult.data) {
        const result = enforcerResult.data;
        if (result.risk_level === 'low') {
          return { allowed: true, reason: null, risk_level: 'low', intervention_prompt: null };
        }

        return {
          allowed: !!result.allowed,
          reason: result.reason || null,
          risk_level: result.risk_level || 'medium',
          intervention_prompt: result.intervention_prompt || null,
        };
      }

      throw new Error(enforcerResult.error || 'Empty or invalid response from safety model');
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      console.error('[Runtime:VIGIL] 🚨 Error during evaluation:', errorMessage);
      // FAIL CLOSED for critical actions, FAIL OPEN with caution for normal actions
      const isCritical = CRITICAL_ACTIONS.has(toolName);
      if (isCritical) {
        return {
          allowed: false,
          reason: `Safety evaluation failed for critical action: ${errorMessage}`,
          risk_level: 'critical',
          intervention_prompt: 'Wait for administrator intervention.',
        };
      } else {
        return {
          allowed: true,
          reason: null,
          risk_level: 'medium',
          intervention_prompt: null,
        };
      }
    } finally {
      eventBus.publish(BotEvents.SERVICE_END, {
        service: 'VIGIL',
        timestamp: Date.now(),
      });
    }
  }
}

/**
 * 3. RalphController
 * Implements "Long-running Claude" pattern to detect agentic laziness
 * and injects a kickback message to force re-iteration.
 */
export class RalphController {
  async verifyCompletion(
    initialGoal: string,
    finalResponse: string,
  ): Promise<{
    is_complete: boolean;
    laziness_detected: boolean;
    kickback_message: string | null;
  }> {
    try {
      const prompt = `<role>
You are the RALPH Completion & Quality Controller of HIVE-MIND.
Your purpose: identify agentic laziness (e.g. leaving TODOs, asking the user to complete code, exiting prematurely before solving).
</role>

<inputs>
<initial_goal>
${initialGoal}
</initial_goal>

<final_assistant_response>
${finalResponse}
</final_assistant_response>
</inputs>

<instructions>
Evaluate if the final response completes the initial goal.
Flag laziness if:
- The assistant asks the user to write code or complete actions themselves.
- The assistant leaves placeholders, stubs, or comments like "// implement here".
- The assistant quits before solving a multi-step task they are capable of doing.
</instructions>

<output_format>
Respond in JSON only:
{
  "is_complete": true/false,
  "laziness_detected": true/false,
  "kickback_message": "if lazy, write a firm system directive telling the agent exactly what they left unfinished and commanding them to continue and complete it. Otherwise null."
}

Few-shot examples:
Example 1: Task fully completed without laziness
{
  "is_complete": true,
  "laziness_detected": false,
  "kickback_message": null
}

Example 2: Lazy agent leaving stubs
{
  "is_complete": false,
  "laziness_detected": true,
  "kickback_message": "[SYSTEM REJECTION] You left '// TODO: implement later' on line 45 of src/core/index.ts. You must fully write the implementation as instructed. No placeholders or incomplete code are allowed. Complete the task now."
}
</output_format>`;

      interface RalphResult {
        is_complete: boolean;
        laziness_detected: boolean;
        kickback_message: string | null;
      }

      const enforcerResult = await enforceFormat<RalphResult>(
        async (retryPromptModifier) => {
          const messages = [
            {
              role: 'system',
              content:
                'You are RALPH. Detect laziness and force agents to complete tasks. Output clean JSON only.',
            },
            { role: 'user', content: prompt },
          ];
          if (retryPromptModifier) {
            messages.push({ role: 'user', content: retryPromptModifier });
          }
          const { providerRouter } = await import('../../providers/index.js');
          const response = await providerRouter.callServiceRecipe('CRITIC', messages);
          return response?.content || '';
        },
        {
          validate: (parsed) => {
            if (typeof parsed.is_complete !== 'boolean')
              return 'Property "is_complete" must be a boolean';
            if (typeof parsed.laziness_detected !== 'boolean')
              return 'Property "laziness_detected" must be a boolean';
            return true;
          },
          maxRetries: 2,
        },
      );

      if (enforcerResult.success && enforcerResult.data) {
        const result = enforcerResult.data;
        return {
          is_complete: !!result.is_complete,
          laziness_detected: !!result.laziness_detected,
          kickback_message: result.kickback_message || null,
        };
      }

      throw new Error(enforcerResult.error || 'Empty or invalid response from RALPH');
    } catch (error: unknown) {
      const errorMessage = extractErrorMessage(error);
      console.error('[Runtime:RALPH] 🚨 Error during completion check:', errorMessage);
      // Default to complete on error so we don't loop infinitely
      return {
        is_complete: true,
        laziness_detected: false,
        kickback_message: null,
      };
    }
  }
}

/**
 * Main AIRuntimeInfrastructure facade
 */
export class AIRuntimeInfrastructure {
  public readonly finOps: RuntimeFinOps;
  public readonly sentinel: RuntimeSentinel;
  public readonly ralph: RalphController;

  constructor(maxBudget?: number) {
    this.finOps = new RuntimeFinOps(maxBudget);
    this.sentinel = new RuntimeSentinel();
    this.ralph = new RalphController();
  }
}
