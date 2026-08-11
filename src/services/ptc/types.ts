/**
 * Types pour le Programmatic Tool Calling (PTC)
 * Pilier D du projet AION
 *
 * Inclut les types pour le WakeSystem (OpenClaw Heartbeat pattern)
 */
import type { SleepResult } from './WakeSystem.js';

/** Enregistrement d'un appel d'outil exécuté dans le sandbox */
export interface ToolCallRecord {
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  result?: unknown;
  error?: string;
  executionTimeMs?: number;
}

/** Métadonnées retournées par le meta-tool code_execution */
export interface CodeExecutionMetadata {
  readonly toolCallCount: number;
  readonly intermediateTokensSaved: number;
  readonly totalTokensSaved: number;
  readonly tokenSavingsBreakdown: {
    readonly intermediateResults: number;
    readonly roundTripContext: number;
    readonly toolCallOverhead: number;
    readonly llmDecisions: number;
  };
  readonly toolsUsed: readonly string[];
  readonly executionTimeMs: number;
  readonly sandboxToolCalls: readonly ToolCallRecord[];
  /** Présent si le script a appelé HIVE.sleepAndWake() */
  readonly sleepScheduled?: SleepResult;
  /** Avertissement non-bloquant (ex: PTC_SINGLE_TOOL) */
  readonly warning?: string;
}

/** Résultat complet d'une exécution PTC */
export interface PTCExecutionResult {
  readonly result: unknown;
  readonly metadata: CodeExecutionMetadata;
}

/** Configuration du PTC */
export interface PTCConfig {
  /** Timeout max d'exécution du code en ms (défaut: 30000) */
  readonly timeoutMs: number;
  /** Tokens estimés du contexte de base pour le calcul des économies */
  readonly baseContextTokens: number;
}

/** Fonction outil injectable dans le sandbox */
export type ToolFunction = (args: Record<string, unknown>) => Promise<unknown>;

/** Définition d'outil au format OpenAI (HIVE-MIND standard) */
export interface OpenAIToolDefinition {
  readonly type?: string;
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: {
      readonly type: string;
      readonly properties: Record<string, unknown>;
      readonly required?: readonly string[];
    };
  };
}
