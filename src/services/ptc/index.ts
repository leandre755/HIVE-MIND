/**
 * Programmatic Tool Calling (PTC) — Point d'entrée public
 * Pilier D du projet AION
 *
 * Le PTC permet au LLM de générer un script JS orchestrant N appels d'outils
 * en une seule exécution, au lieu de faire N round-trips LLM coûteux.
 *
 * Usage dans core/index.ts:
 *   import { ptcExecutor, buildCodeExecutionToolDef, buildToolFunctions } from '../services/ptc/index.js';
 */

import { ProgrammaticExecutor } from './ProgrammaticExecutor.js';

// Singleton — une seule instance pour toute la durée de vie du bot
export const ptcExecutor = new ProgrammaticExecutor({
  timeoutMs: parseInt(process.env.PTC_TIMEOUT_MS || '30000', 10),
  baseContextTokens: 7_000,
});

// Re-exports pour usage direct
export { buildToolFunctions } from './ToolBridge.js';
export { validateCode, autoRepairCode, countToolCalls } from './SafeScriptValidator.js';
export type {
  ToolCallRecord,
  CodeExecutionMetadata,
  PTCExecutionResult,
  PTCConfig,
  OpenAIToolDefinition,
} from './types.js';
export type {
  ValidationResult,
  ValidationError,
  ValidationWarning,
  RepairResult,
} from './SafeScriptValidator.js';
