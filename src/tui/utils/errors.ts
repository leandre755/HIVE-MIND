import { runSyncCleanup } from './cleanup.js';
import type { HiveConfig } from '../config/hiveConfig.js';

interface ErrorWithCode extends Error {
  exitCode?: number;
  code?: string | number;
  status?: string | number;
}

export class FatalToolExecutionError extends Error {
  exitCode = 1;
}

export class FatalCancellationError extends Error {
  exitCode = 130;
}

export class FatalTurnLimitedError extends Error {
  exitCode = 1;
}

export const debugLogger = {
  debug: (...args: unknown[]) => console.debug('[Debug]', ...args),
  log: (...args: unknown[]) => console.debug('[Debug]', ...args),
  info: (...args: unknown[]) => console.info('[Info]', ...args),
  warn: (...args: unknown[]) => console.warn('[Warn]', ...args),
  error: (...args: unknown[]) => console.error('[Error]', ...args),
};

export function parseAndFormatApiError(error: unknown): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export function isFatalToolError(_errorType?: string): boolean {
  return false;
}

export function getErrorMessage(error: unknown): string {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

export function checkExhaustive(x: never): never {
  throw new Error(`Unreachable case: ${JSON.stringify(x)}`);
}

/**
 * Extracts the appropriate error code from an error object.
 */
function extractErrorCode(error: unknown): string | number {
  const errorWithCode = error as ErrorWithCode;

  // Prioritize exitCode for FatalError types, fall back to other codes
  if (typeof errorWithCode.exitCode === 'number') {
    return errorWithCode.exitCode;
  }
  if (errorWithCode.code !== undefined) {
    return errorWithCode.code;
  }
  if (errorWithCode.status !== undefined) {
    return errorWithCode.status;
  }

  return 1; // Default exit code
}

/**
 * Converts an error code to a numeric exit code.
 */
function getNumericExitCode(errorCode: string | number): number {
  return typeof errorCode === 'number' ? errorCode : 1;
}

/**
 * Handles errors consistently for both JSON and text output formats.
 */
export function handleError(
  error: unknown,
  _config: HiveConfig,
  customErrorCode?: string | number,
): never {
  const errorMessage = parseAndFormatApiError(error);

  const errorCode = customErrorCode ?? extractErrorCode(error);
  console.error(errorMessage);
  runSyncCleanup();
  process.exit(getNumericExitCode(errorCode));
}

/**
 * Handles tool execution errors specifically.
 */
export function handleToolError(
  toolName: string,
  toolError: Error,
  _config: HiveConfig,
  errorType?: string,
  resultDisplay?: string,
): void {
  const errorMessage = `Error executing tool ${toolName}: ${resultDisplay || toolError.message}`;

  const isFatal = isFatalToolError(errorType);

  if (isFatal) {
    const toolExecutionError = new FatalToolExecutionError(errorMessage);
    console.error(errorMessage);
    runSyncCleanup();
    process.exit(toolExecutionError.exitCode);
  }

  // Non-fatal: log and continue
  debugLogger.warn(errorMessage);
}

/**
 * Handles cancellation/abort signals consistently.
 */
export function handleCancellationError(_config: HiveConfig): never {
  const cancellationError = new FatalCancellationError('Operation cancelled.');

  console.error(cancellationError.message);
  runSyncCleanup();
  process.exit(cancellationError.exitCode);
}

/**
 * Handles max session turns exceeded consistently.
 */
export function handleMaxTurnsExceededError(_config: HiveConfig): never {
  const maxTurnsError = new FatalTurnLimitedError(
    'Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
  );

  console.error(maxTurnsError.message);
  runSyncCleanup();
  process.exit(maxTurnsError.exitCode);
}
