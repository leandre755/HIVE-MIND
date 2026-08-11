/**
 * Initializer module pour HIVE-MIND
 * L'initialisation Gemini CLI n'est pas nécessaire — le core gère tout
 */

export interface InitializationResult {
  settings?: unknown;
  startupWarnings?: string[];
  [key: string]: unknown;
}

export async function initialize(_args: unknown): Promise<InitializationResult> {
  return {};
}
