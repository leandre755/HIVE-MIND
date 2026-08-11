/**
 * utils/toolCallExtractor.ts
 * Utilitaire centralisé pour l'extraction des appels d'outils
 * Évite la duplication de code et maintient une logique cohérente
 */

export interface ToolCall {
  id?: string;
  name: string;
  arguments: string;
  type?: string;
}

export interface ToolCallRaw extends ToolCall {
  raw: string;
  index: number;
}

export interface ToolCallStats {
  total: number;
  valid: number;
  unique: number;
  byName: Record<string, number>;
}

interface OpenAIFunction {
  name: string;
  arguments: string;
}

interface OpenAIToolCall {
  id?: string;
  type?: string;
  function?: OpenAIFunction;
}

const EXCLUDED_TAGS = ['thought', 'think', 'thought_process', 'function', 'tool_call'];

function collectFunctionCalls(text: string, includeSys: boolean, matches: ToolCallRaw[]): void {
  const callRegex = includeSys
    ? /\bsys_interaction\.(\w+)\(([^)]*)\)/g
    : /\b([a-zA-Z_]\w*)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = callRegex.exec(text)) !== null) {
    if (m[1]) {
      matches.push({
        name: m[1],
        arguments: (m[2] ?? '').trim(),
        raw: m[0],
        index: m.index,
      });
    }
  }
}

function collectFunctionTags(text: string, matches: ToolCallRaw[]): void {
  const fnRegex = /<function>(\w+)<\/function>/g;
  let m: RegExpExecArray | null;
  while ((m = fnRegex.exec(text)) !== null) {
    if (m[1]) {
      matches.push({
        name: m[1],
        arguments: '{}',
        raw: m[0],
        index: m.index,
      });
    }
  }
}

function collectToolCallTags(text: string, includeSys: boolean, matches: ToolCallRaw[]): void {
  if (!includeSys) return;
  const tcRegex = /<tool_call>\s*(\w+)\s*\(([^)]*)\)\s*<\/tool_call>/g;
  let m: RegExpExecArray | null;
  while ((m = tcRegex.exec(text)) !== null) {
    if (m[1]) {
      matches.push({
        name: m[1],
        arguments: (m[2] ?? '').trim(),
        raw: m[0],
        index: m.index,
      });
    }
  }
}

function collectXmlTags(text: string, matches: ToolCallRaw[]): void {
  const xmlRegex = /<([a-zA-Z_]\w*)>([^<]*)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = xmlRegex.exec(text)) !== null) {
    const tag = m[1];
    const curIndex = m.index;
    const curRaw = m[0];
    if (tag && !EXCLUDED_TAGS.includes(tag.toLowerCase())) {
      const isOverlap = matches.some(
        (existing) => existing.index <= curIndex && curIndex < existing.index + existing.raw.length,
      );
      if (!isOverlap) {
        matches.push({
          name: tag,
          arguments: (m[2] ?? '').trim(),
          raw: curRaw,
          index: curIndex,
        });
      }
    }
  }
}

/**
 * Extrait les appels d'outils depuis du texte
 * Supporte deux formats:
 * - Avec sys_interaction: sys_interaction.toolName(params)
 * - Sans sys_interaction: toolName(params)
 */
export function extractToolCallsFromText(
  text: string | null | undefined,
  includeSys = true,
): ToolCallRaw[] {
  if (!text || typeof text !== 'string') return [];
  try {
    const matches: ToolCallRaw[] = [];
    collectFunctionCalls(text, includeSys, matches);
    collectFunctionTags(text, matches);
    collectToolCallTags(text, includeSys, matches);
    collectXmlTags(text, matches);

    matches.sort((a, b) => a.index - b.index);
    return matches;
  } catch {
    return [];
  }
}

function toToolCall(call: Partial<OpenAIToolCall>): ToolCall | null {
  const fn = call.function;
  if (!fn || !fn.name || !fn.arguments) return null;
  return {
    id: call.id,
    name: fn.name,
    arguments: fn.arguments,
    type: call.type ?? 'function',
  };
}

/**
 * Extrait les appels d'outils depuis des tool_calls OpenAI
 */
export function extractToolCallsFromOpenAI(toolCalls: unknown[] | null | undefined): ToolCall[] {
  if (!Array.isArray(toolCalls)) return [];
  const results: ToolCall[] = [];
  for (const call of toolCalls) {
    const res = toToolCall(call as Partial<OpenAIToolCall>);
    if (res) results.push(res);
  }
  return results;
}

function isValidName(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 100 && /^\w+$/.test(name);
}

/**
 * Valide qu'un appel d'outil est bien formé
 */
export function isValidToolCall(toolCall: Partial<ToolCall>): boolean {
  if (!toolCall || typeof toolCall !== 'object') return false;
  return isValidName(toolCall.name) && typeof toolCall.arguments === 'string';
}

function attemptRepairArguments<T>(text: string): T | null {
  try {
    const cleaned = text
      .replace(/([{,]\s*)(\w+)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/,\s*([}\]])/g, '$1');

    return JSON.parse(cleaned) as T;
  } catch {
    console.error(
      '[ToolCallExtractor] Impossible de réparer les arguments:',
      text.substring(0, 50),
    );
    if (!text.includes('{')) {
      return { text, message: text, query: text } as unknown as T;
    }
    return null;
  }
}

/**
 * Parse les arguments JSON d'un appel d'outil
 */
export function parseToolArguments<T = unknown>(argsText: string | null | undefined): T | null {
  if (!argsText || typeof argsText !== 'string') return null;

  let preCleaned = argsText.trim();
  if (!preCleaned.startsWith('{')) {
    const firstBrace = preCleaned.indexOf('{');
    const lastBrace = preCleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      preCleaned = preCleaned.slice(firstBrace, lastBrace + 1);
    }
  }

  try {
    return JSON.parse(preCleaned) as T;
  } catch {
    console.warn('[ToolCallExtractor] Arguments JSON invalides, tentative de réparation...');
    return attemptRepairArguments<T>(preCleaned);
  }
}

/**
 * Formate un appel d'outil pour l'affichage/debug
 */
export function formatToolCall(toolCall: Partial<ToolCall>): string {
  if (!toolCall) return 'Invalid tool call';

  const name = toolCall.name || 'unknown';
  const args = toolCall.arguments || '{}';
  const MAX_DISPLAY_LENGTH = 50;

  const truncatedArgs =
    args.length > MAX_DISPLAY_LENGTH ? args.substring(0, MAX_DISPLAY_LENGTH) + '...' : args;

  return `${name}(${truncatedArgs})`;
}

/**
 * Déduplique une liste d'appels d'outils
 */
export function deduplicateToolCalls<T extends ToolCall>(toolCalls: T[]): T[] {
  if (!Array.isArray(toolCalls)) return [];

  const seen = new Set<string>();
  return toolCalls.filter((call: T) => {
    if (!call || !call.name) return false;

    const key = `${call.name}:${call.arguments}`;
    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

/**
 * Statistiques sur les appels d'outils extraits
 */
export function getToolCallStats(toolCalls: Partial<ToolCall>[]): ToolCallStats {
  if (!Array.isArray(toolCalls)) return { total: 0, valid: 0, unique: 0, byName: {} };

  const validCalls = toolCalls.filter((call: Partial<ToolCall>): call is ToolCall =>
    isValidToolCall(call),
  );
  const byName: Record<string, number> = {};

  validCalls.forEach((call: ToolCall) => {
    byName[call.name] = (byName[call.name] || 0) + 1;
  });

  return {
    total: toolCalls.length,
    valid: validCalls.length,
    unique: Object.keys(byName).length,
    byName,
  };
}
