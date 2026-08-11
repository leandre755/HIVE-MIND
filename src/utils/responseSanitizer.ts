/**
 * utils/responseSanitizer.ts
 *
 * 2-Layer defense against weak LLMs that leak tool call syntax,
 * skip mandatory <thought> tags, or emit raw code as text responses.
 *
 * Layer 1 (in-loop): detectResponseDefects() — decides whether to retry
 * Layer 2 (post-loop): sanitizeResponse() — strips anything that slipped through
 */

// WHY: Known tool names are checked to distinguish real tool-call leaks from
// user-facing code examples. Only patterns matching actual system tools trigger.
const KNOWN_TOOL_PREFIXES = [
  'tool_code_execution',
  'code_execution',
  'tool_browser_',
  'tool_send_',
  'tool_workspace_', // WHY: Legacy name — kept intentionally to catch weak models hallucinating the old `workspace_*` names
  'tool_read_file',
  'tool_edit_file',
  'tool_grep_search',
  'tool_google_ai_search',
  'tool_firecrawl_',
  'browser_screenshot',
  'browser_open',
  'browser_snapshot',
  'browser_click',
  'browser_fill',
  'browser_eval',
  'send_message',
  'send_file',
  'send_sticker',
  'db_document_save',
  'db_document_read',
  'db_document_search',
  'read_file',
  'edit_file',
  'grep_search',
  'google_ai_search',
  'firecrawl_scrape',
  'get_file_skeleton',
  'get_function',
  'get_my_capabilities',
  'use_tool',
  'spawn_sub_agent',
];

export interface ResponseDefects {
  /** No <thought>/<think>/<thinking> tags found anywhere in the response */
  hasNoThoughts: boolean;
  /** tool_<name>(...) or <name>(...) patterns found in text */
  hasLeakedToolCalls: boolean;
  /** >80% of the response is a single code block with no surrounding explanation */
  hasRawCodeDominance: boolean;
  /** {"name": "<tool>", "arguments": ...} JSON object in text */
  hasJsonToolObject: boolean;
  /** Total defect count */
  defectCount: number;
  /** Human-readable defect descriptions for logging */
  details: string[];
}

export interface SanitizeResult {
  /** Cleaned text safe for the user */
  cleaned: string;
  /** Whether any modifications were made */
  wasModified: boolean;
  /** List of what was stripped (for logging) */
  strippedItems: string[];
}

const FALLBACK_MESSAGE =
  "J'ai rencontré un problème technique en traitant cette tâche. Peux-tu reformuler ta demande ?";

/**
 * Layer 1: Detect structural defects in a model's text response.
 * Used inside the ReAct loop to decide whether to ask the model to retry.
 *
 * Invariant: returns a defects object with accurate counts. Never throws.
 */
function checkThoughts(text: string, defects: ResponseDefects): void {
  if (!/<(think|thought|thinking)>/i.test(text)) {
    defects.hasNoThoughts = true;
    defects.defectCount++;
    defects.details.push('Missing mandatory <thought> tags');
  }
}

function checkLeakedToolCalls(text: string, defects: ResponseDefects): void {
  if (hasLeakedToolCallPatterns(text)) {
    defects.hasLeakedToolCalls = true;
    defects.defectCount++;
    defects.details.push('Leaked tool call syntax in text');
  }
}

function checkRawCodeAndJson(text: string, defects: ResponseDefects): void {
  if (hasRawCodeDominance(text)) {
    defects.hasRawCodeDominance = true;
    defects.defectCount++;
    defects.details.push('Raw code block dominates response (>80%)');
  }
  if (hasJsonToolObject(text)) {
    defects.hasJsonToolObject = true;
    defects.defectCount++;
    defects.details.push('JSON tool call object in response text');
  }
}

function checkXmlToolTags(text: string, defects: ResponseDefects): void {
  const xmlToolTagPattern =
    /<(?:tool_code|code_execution|tool_call)\b[^>]*>[\s\S]*?<\/(?:tool_code|code_execution|tool_call)>/i;
  if (xmlToolTagPattern.test(text)) {
    defects.hasLeakedToolCalls = true;
    if (!defects.details.includes('Leaked tool call syntax in text')) {
      defects.defectCount++;
      defects.details.push('XML tool invocation tags in text');
    }
  }
}

export function detectResponseDefects(text: string | null | undefined): ResponseDefects {
  const defects: ResponseDefects = {
    hasNoThoughts: false,
    hasLeakedToolCalls: false,
    hasRawCodeDominance: false,
    hasJsonToolObject: false,
    defectCount: 0,
    details: [],
  };
  if (!text || typeof text !== 'string' || text.trim().length === 0) return defects;

  checkThoughts(text, defects);
  checkLeakedToolCalls(text, defects);
  checkRawCodeAndJson(text, defects);
  checkXmlToolTags(text, defects);

  return defects;
}

interface ToolCallRemoval {
  start: number;
  end: number;
  tripleQuote: boolean;
}

interface CallParserState {
  depth: number;
  quote: '"' | "'" | null;
  tripleQuote: boolean;
  escaped: boolean;
}

function consumeQuotedCharacter(state: CallParserState, char: string): boolean {
  if (!state.quote) return false;
  if (state.escaped) state.escaped = false;
  else if (char === '\\') state.escaped = true;
  else if (char === state.quote) state.quote = null;
  return true;
}

function consumeCallDelimiter(state: CallParserState, char: string): boolean {
  if (char === '"' || char === "'") {
    state.quote = char;
    return false;
  }
  if (char === '(') state.depth++;
  if (char === ')') state.depth--;
  return state.depth === 0;
}

function findCallEnd(text: string, openingParenthesis: number): number {
  const state: CallParserState = { depth: 0, quote: null, tripleQuote: false, escaped: false };

  for (let index = openingParenthesis; index < text.length; index++) {
    const char = text.charAt(index);
    const next = text.slice(index, index + 3);

    if (state.tripleQuote) {
      if (next === '"""') {
        state.tripleQuote = false;
        index += 2;
      }
      continue;
    }
    if (consumeQuotedCharacter(state, char)) continue;
    if (next === '"""') {
      state.tripleQuote = true;
      index += 2;
      continue;
    }
    if (consumeCallDelimiter(state, char)) return index + 1;
  }

  return -1;
}

function isIdentifierCharacter(char: string): boolean {
  return /\w/u.test(char);
}

function findNextKnownToolCall(text: string, start: number): ToolCallRemoval | null {
  let openingParenthesis = text.indexOf('(', start);

  while (openingParenthesis !== -1) {
    let nameEnd = openingParenthesis;
    while (nameEnd > start && /\s/u.test(text.charAt(nameEnd - 1))) nameEnd--;

    let nameStart = nameEnd;
    while (nameStart > start && isIdentifierCharacter(text.charAt(nameStart - 1))) nameStart--;

    const rawName = text.slice(nameStart, nameEnd);
    const name = rawName.startsWith('tool_') ? rawName.slice(5) : rawName;
    if (isKnownTool(name)) {
      const end = findCallEnd(text, openingParenthesis);
      if (end !== -1) {
        return {
          start: nameStart,
          end,
          tripleQuote: text.slice(nameStart, end).includes('"""'),
        };
      }
    }

    openingParenthesis = text.indexOf('(', openingParenthesis + 1);
  }

  return null;
}

function findToolCallRemovals(text: string, tripleOnly: boolean): ToolCallRemoval[] {
  const removals: ToolCallRemoval[] = [];
  let searchStart = 0;

  while (searchStart < text.length) {
    const removal = findNextKnownToolCall(text, searchStart);
    if (!removal) break;
    if (removal.tripleQuote === tripleOnly) removals.push(removal);
    searchStart = removal.end;
  }

  return removals;
}

function applyToolCallRemovals(text: string, removals: ToolCallRemoval[]): string {
  return removals
    .slice()
    .sort((left, right) => right.start - left.start)
    .reduce(
      (current, removal) => current.slice(0, removal.start) + current.slice(removal.end),
      text,
    );
}

function stripQuoteToolCalls(state: { cleaned: string; strippedItems: string[] }): void {
  const removals = findToolCallRemovals(state.cleaned, true);
  if (removals.length === 0) return;
  state.strippedItems.push('triple_quote_tool_call');
  state.cleaned = applyToolCallRemovals(state.cleaned, removals);
}

function stripArbitraryToolCalls(state: { cleaned: string; strippedItems: string[] }): void {
  const removals = findToolCallRemovals(state.cleaned, false);
  if (removals.length === 0) return;
  state.strippedItems.push(`tool_call_text(${removals.length})`);
  state.cleaned = applyToolCallRemovals(state.cleaned, removals);
}

function stripJsonToolObjects(state: { cleaned: string; strippedItems: string[] }): void {
  const jsonToolPattern =
    /\{\s*"name"\s*:\s*"[a-zA-Z_]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g;
  const jsonMatches = state.cleaned.match(jsonToolPattern);
  if (jsonMatches) {
    for (const jsonMatch of jsonMatches) {
      const nameMatch = jsonMatch.match(/"name"\s*:\s*"([a-zA-Z_]+)"/);
      if (nameMatch && isKnownTool(nameMatch[1])) {
        state.strippedItems.push(`json_tool_object(${nameMatch[1]})`);
        state.cleaned = state.cleaned.replace(jsonMatch, '');
      }
    }
  }
}

function stripOrphanCodeBlocks(state: { cleaned: string; strippedItems: string[] }): void {
  if (hasRawCodeDominance(state.cleaned)) {
    const codeBlockRegex = /```[\s\S]*?```/g;
    const codeBlocks = state.cleaned.match(codeBlockRegex);
    if (codeBlocks) {
      const nonCodeText = state.cleaned.replace(codeBlockRegex, '').trim();
      if (nonCodeText.length < 50) {
        state.strippedItems.push(`orphan_code_blocks(${codeBlocks.length})`);
        state.cleaned = nonCodeText;
      }
    }
  }
}

function stripXmlToolTags(state: { cleaned: string; strippedItems: string[] }): void {
  const xmlPattern =
    /<(?:tool_code|code_execution|tool_call)\b[^>]*>[\s\S]*?<\/(?:tool_code|code_execution|tool_call)>/gi;
  const xmlMatches = state.cleaned.match(xmlPattern);
  if (xmlMatches) {
    state.strippedItems.push(`xml_tool_tags(${xmlMatches.length})`);
    state.cleaned = state.cleaned.replace(xmlPattern, '');
  }
}

function fallbackOrClean(state: { cleaned: string; strippedItems: string[] }): SanitizeResult {
  state.cleaned = state.cleaned.replace(/\n{3,}/g, '\n\n').trim();
  if (!state.cleaned || state.cleaned.length < 5) {
    state.cleaned = FALLBACK_MESSAGE;
    if (!state.strippedItems.includes('empty_after_strip')) {
      state.strippedItems.push('empty_after_strip');
    }
  }
  return {
    cleaned: state.cleaned,
    wasModified: state.strippedItems.length > 0,
    strippedItems: state.strippedItems,
  };
}

export function sanitizeResponse(text: string | null | undefined): SanitizeResult {
  if (!text || typeof text !== 'string' || text.trim().length === 0) {
    return { cleaned: FALLBACK_MESSAGE, wasModified: true, strippedItems: ['empty_response'] };
  }

  const state = { cleaned: text, strippedItems: [] as string[] };
  stripQuoteToolCalls(state);
  stripArbitraryToolCalls(state);
  stripJsonToolObjects(state);
  stripOrphanCodeBlocks(state);
  stripXmlToolTags(state);

  return fallbackOrClean(state);
}

// ──────────────────── Internal helpers ────────────────────

/**
 * Detects tool call patterns like `tool_code_execution(code=...)` or `browser_screenshot(...)`.
 * WHY: Only matches known tool names to avoid false positives on regular function calls
 * the model might be discussing.
 */
function hasLeakedToolCallPatterns(text: string): boolean {
  for (const prefix of KNOWN_TOOL_PREFIXES) {
    if (text.includes(`${prefix}(`) || text.includes(`${prefix} (`)) {
      return true;
    }
  }

  return /(?:^|\s|\n)tool_[a-zA-Z_]+\s*\(/m.test(text);
}

/**
 * Detects when >80% of the response is enclosed in fenced code blocks
 * AND there's minimal natural language explanation around it.
 */
function hasRawCodeDominance(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 100) return false; // Too short to judge

  const codeBlockRegex = /```[\s\S]*?```/g;
  const codeBlocks = trimmed.match(codeBlockRegex);
  if (!codeBlocks || codeBlocks.length === 0) return false;

  const totalCodeLength = codeBlocks.reduce((sum, block) => sum + block.length, 0);
  const codeRatio = totalCodeLength / trimmed.length;

  if (codeRatio < 0.8) return false;

  // Check if the non-code text is meaningful (>50 chars of natural language)
  const nonCodeText = trimmed.replace(codeBlockRegex, '').trim();
  // WHY: A response like "Here's how:\n```python\n...```" has meaningful intro text.
  // We only flag when the surrounding text is trivially short.
  return nonCodeText.length < 50;
}

/**
 * Detects JSON objects that look like structured tool calls.
 */
function hasJsonToolObject(text: string): boolean {
  const jsonToolPattern = /\{\s*"name"\s*:\s*"([a-zA-Z_]+)"\s*,\s*"arguments"\s*:/;
  const match = text.match(jsonToolPattern);
  if (!match) return false;
  return isKnownTool(match[1]);
}

/**
 * Checks if a tool name matches any known tool in the system.
 */
function isKnownTool(name: string): boolean {
  return KNOWN_TOOL_PREFIXES.some(
    (prefix) => name === prefix || name.startsWith(prefix.replace(/^tool_/, '')),
  );
}
