// services/ast/TreeSitterService.ts
// ============================================================================
// TREE-SITTER SERVICE — AST parsing engine for code intelligence
//
// WHY: Provides structural understanding of source code files via tree-sitter
// WASM bindings. Enables skeleton extraction, function isolation, and
// symbol-level operations that are 80-95% more token-efficient than raw
// file reading for the LLM.
//
// ARCHITECTURE:
// - Uses web-tree-sitter (WASM) for portability (no native compilation)
// - Language parsers are lazily loaded and cached
// - Queries capture definitions and references per-language
// ============================================================================

import * as path from 'path';
import { fileURLToPath } from 'url';
import { safeExistsSync, safeReadFileSync, resolveWithinRoot } from '../../utils/safeFs.js';
import { Parser, Language, Query, Node as SyntaxNode } from 'web-tree-sitter';
import { LANGUAGE_MAP } from './queries.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

function detectParentClass(defNode: SyntaxNode): string | undefined {
  let parentNode: SyntaxNode | null = defNode.parent;
  while (parentNode) {
    if (parentNode.type.includes('class') || parentNode.type === 'class_definition') {
      const className = parentNode.childForFieldName('name');
      return className?.text;
    }
    parentNode = parentNode.parent;
  }
  return undefined;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface SymbolDefinition {
  /** Symbol name (e.g., "processData", "UserService") */
  name: string;
  /** Symbol kind (function, method, class, interface, enum, type) */
  kind: string;
  /** Parent symbol name for nested definitions (e.g., "UserService" for method "getUser") */
  parent?: string;
  /** 0-indexed start line in the file */
  startLine: number;
  /** 0-indexed end line in the file */
  endLine: number;
  /** Number of lines in the definition */
  lineCount: number;
  /** The definition's signature line text */
  signatureLine: string;
  /** Indentation of the definition */
  indentation: string;
}

export interface SymbolReference {
  /** Referenced symbol name */
  name: string;
  /** File path where the reference is found */
  filePath: string;
  /** 0-indexed line number */
  line: number;
  /** The line text containing the reference */
  lineText: string;
  /** Whether this is a definition or just a reference */
  isDefinition: boolean;
}

// ── Singleton State ────────────────────────────────────────────────────────

let isInitialized = false;
let initPromise: Promise<void> | null = null;

const languageCache = new Map<string, Language>();
const queryCache = new Map<string, Query>();

// ── Initialization ─────────────────────────────────────────────────────────

async function ensureInitialized(): Promise<void> {
  if (isInitialized) return;
  if (!initPromise) {
    initPromise = Parser.init({
      locateFile(scriptName: string) {
        const localPath = resolveWithinRoot(__dirname, scriptName);
        if (safeExistsSync(localPath)) return localPath;
        const runtimeRoot = path.resolve(process.cwd(), 'node_modules', 'web-tree-sitter');
        return resolveWithinRoot(runtimeRoot, scriptName);
      },
    }).then(() => {
      isInitialized = true;
    });
  }
  return initPromise;
}

async function loadLanguage(langName: string): Promise<Language> {
  const cached = languageCache.get(langName);
  if (cached) return cached;

  const wasmName = `tree-sitter-${langName}.wasm`;
  const wasmRoot = path.resolve(process.cwd(), 'node_modules', 'tree-sitter-wasms', 'out');
  const searchPaths = [
    resolveWithinRoot(wasmRoot, wasmName),
    resolveWithinRoot(__dirname, wasmName),
  ];

  for (const wasmPath of searchPaths) {
    try {
      if (safeExistsSync(wasmPath)) {
        const language = await Language.load(wasmPath);
        languageCache.set(langName, language);
        return language;
      }
    } catch (err: unknown) {
      console.error(
        '[TreeSitterService] Error loading WASM from %s:',
        wasmPath,
        extractErrorMessage(err),
      );
    }
  }
  throw new Error(`[AST] WASM non trouvé pour: ${langName}. Fichier attendu: ${wasmName}`);
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Parses a file and returns all symbol definitions.
 *
 * @param absolutePath - Full path to the source file
 * @returns Array of symbol definitions, or null if language unsupported
 */
function _findEncompassingDefNode(
  captureNode: SyntaxNode,
  definitionNodes: Map<number, { name: string; node: SyntaxNode }>,
): SyntaxNode | null {
  let current: SyntaxNode | null = captureNode;
  while (current) {
    if (definitionNodes.has(current.id)) return current;
    current = current.parent;
  }
  return null;
}

function _buildDefinitionsFromCaptures(
  captures: Array<{ name: string; node: SyntaxNode }>,
  lines: string[],
): SymbolDefinition[] {
  const definitionNodes = new Map<number, { name: string; node: SyntaxNode }>();
  for (const capture of captures) {
    if (capture.name.includes('definition') && !capture.name.includes('name.definition')) {
      definitionNodes.set(capture.node.id, { name: capture.name, node: capture.node });
    }
  }

  const definitions: SymbolDefinition[] = [];
  const seen = new Set<number>();

  for (const capture of captures) {
    if (!capture.name.includes('name.definition')) continue;

    const startLine = capture.node.startPosition.row;
    if (seen.has(startLine)) continue;
    seen.add(startLine);

    const kind = capture.name.replace('name.definition.', '');
    const name = capture.node.text;
    const defNode = _findEncompassingDefNode(capture.node, definitionNodes);
    const endLine = defNode ? defNode.endPosition.row : startLine;
    const lineCount = endLine - startLine + 1;
    const parent = kind === 'method' && defNode ? detectParentClass(defNode) : undefined;
    const signatureLine = lines.at(startLine) ?? '';

    definitions.push({
      name,
      kind,
      parent,
      startLine,
      endLine,
      lineCount,
      signatureLine,
      indentation: signatureLine.match(/^\s*/)?.[0] || '',
    });
  }

  definitions.sort((a, b) => a.startLine - b.startLine);
  return definitions;
}

export async function parseDefinitions(absolutePath: string): Promise<SymbolDefinition[] | null> {
  try {
    await ensureInitialized();

    const ext = path.extname(absolutePath).toLowerCase().slice(1);
    const langConfig = Object.hasOwn(LANGUAGE_MAP, ext)
      ? (Reflect.get(LANGUAGE_MAP, ext) as (typeof LANGUAGE_MAP)[keyof typeof LANGUAGE_MAP])
      : null;
    if (!langConfig) return null;

    const content = safeReadFileSync(absolutePath);
    const language = await loadLanguage(langConfig.langName);

    const queryCacheKey = `${langConfig.langName}:def`;
    let query = queryCache.get(queryCacheKey);
    if (!query) {
      query = new Query(language, langConfig.query);
      queryCache.set(queryCacheKey, query);
    }

    const parser = new Parser();
    parser.setLanguage(language);
    const tree = parser.parse(content);
    if (!tree?.rootNode) return null;

    const captures = query.captures(tree.rootNode);
    const lines = content.split('\n');
    return _buildDefinitionsFromCaptures(captures, lines);
  } catch (error: unknown) {
    console.warn(
      `[AST] Tree-sitter failed for ${absolutePath}, falling back to Regex parsing: ${extractErrorMessage(error)}`,
    );
    return parseDefinitionsRegexFallback(absolutePath);
  }
}

type SymbolFindType = 'definition' | 'reference' | 'both';

function _tryMatchClass(
  trimmed: string,
  line: string,
  i: number,
): { name: string; def: SymbolDefinition } | null {
  const classMatch = trimmed.match(/\bclass\s+(\w+)/);
  if (!classMatch) return null;
  const className = classMatch[1];
  return {
    name: className,
    def: {
      name: className,
      kind: 'class',
      startLine: i,
      endLine: i,
      lineCount: 1,
      signatureLine: line,
      indentation: line.match(/^\s*/)?.[0] || '',
    },
  };
}

function _tryMatchFunction(trimmed: string, line: string, i: number): SymbolDefinition | null {
  const funcMatch = trimmed.match(/\bfunction\s+(\w+)\s*\(/);
  if (!funcMatch) return null;
  return {
    name: funcMatch[1],
    kind: 'function',
    startLine: i,
    endLine: i,
    lineCount: 1,
    signatureLine: line,
    indentation: line.match(/^\s*/)?.[0] || '',
  };
}

function _tryMatchMethod(
  trimmed: string,
  line: string,
  i: number,
  currentClass: string,
): SymbolDefinition | null {
  const methodMatch = trimmed.match(/^(?:public|private|protected|async|static)\s+(\w+)\s*\(/);
  if (!methodMatch) return null;
  const name = methodMatch[1];
  if (['constructor', 'function', 'if', 'for', 'while', 'catch', 'switch'].includes(name))
    return null;
  return {
    name,
    kind: 'method',
    parent: currentClass,
    startLine: i,
    endLine: i,
    lineCount: 1,
    signatureLine: line,
    indentation: line.match(/^\s*/)?.[0] || '',
  };
}

function _processDefinitionLine(
  line: string,
  i: number,
  state: { currentClass: string | undefined; braceScope: number },
): SymbolDefinition | null {
  const trimmed = line.trim();

  if (trimmed.includes('{')) state.braceScope++;
  if (trimmed.includes('}')) state.braceScope--;

  const classRes = _tryMatchClass(trimmed, line, i);
  if (classRes) {
    state.currentClass = classRes.name;
    state.braceScope = trimmed.includes('{') ? 1 : 0;
    return classRes.def;
  }

  if (state.currentClass && state.braceScope <= 0 && trimmed.includes('}')) {
    state.currentClass = undefined;
  }

  const funcDef = _tryMatchFunction(trimmed, line, i);
  if (funcDef) return funcDef;

  if (state.currentClass) {
    return _tryMatchMethod(trimmed, line, i, state.currentClass);
  }
  return null;
}

function parseDefinitionsRegexFallback(absolutePath: string): SymbolDefinition[] | null {
  try {
    const content = safeReadFileSync(absolutePath);
    const lines = content.split('\n');
    const definitions: SymbolDefinition[] = [];
    const state = { currentClass: undefined as string | undefined, braceScope: 0 };

    for (let i = 0; i < lines.length; i++) {
      const line = lines.at(i) ?? '';
      const def = _processDefinitionLine(line, i, state);
      if (def) definitions.push(def);
    }
    return definitions;
  } catch {
    return null;
  }
}

export async function getFileSkeleton(absolutePath: string): Promise<string | null> {
  const definitions = await parseDefinitions(absolutePath);
  if (!definitions || definitions.length === 0) return null;

  const result: string[] = [];
  for (const def of definitions) {
    const lineCountStr = def.lineCount > 1 ? ` (${def.lineCount} lines)` : '';
    result.push(`${def.indentation}${def.signatureLine.trim()}${lineCountStr}`);
  }
  return result.join('\n');
}

export async function getFunction(
  absolutePath: string,
  functionName: string,
): Promise<{ content: string; startLine: number; endLine: number } | null> {
  const definitions = await parseDefinitions(absolutePath);
  if (!definitions) return null;

  const content = safeReadFileSync(absolutePath);
  const lines = content.split('\n');
  const parts = functionName.split('.');
  const targetParent = parts.length >= 2 ? parts[0] : undefined;
  const targetName = parts.length >= 2 ? parts[1] : parts[0];

  const match = definitions.find((def) => {
    if (def.name !== targetName) return false;
    if (targetParent && def.parent !== targetParent) return false;
    return true;
  });

  if (!match) return null;

  const extractedLines = lines.slice(match.startLine, match.endLine + 1);
  return {
    content: extractedLines.join('\n'),
    startLine: match.startLine,
    endLine: match.endLine,
  };
}

async function _processSingleFileReferences(
  filePath: string,
  symbolName: string,
  findType: SymbolFindType,
): Promise<SymbolReference[]> {
  const ext = path.extname(filePath).toLowerCase().slice(1);
  const langConfig = Object.hasOwn(LANGUAGE_MAP, ext)
    ? (Reflect.get(LANGUAGE_MAP, ext) as (typeof LANGUAGE_MAP)[keyof typeof LANGUAGE_MAP])
    : null;
  if (!langConfig) return [];

  const results: SymbolReference[] = [];
  const content = safeReadFileSync(filePath);
  const language = await loadLanguage(langConfig.langName);

  const queryCacheKey = `${langConfig.langName}:ref`;
  let query = queryCache.get(queryCacheKey);
  if (!query) {
    query = new Query(language, langConfig.query);
    queryCache.set(queryCacheKey, query);
  }

  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(content);
  if (!tree?.rootNode) return [];

  const captures = query.captures(tree.rootNode);
  const lines = content.split('\n');

  for (const capture of captures) {
    if (capture.node.text !== symbolName) continue;

    const isDefinition = capture.name.includes('name.definition');
    const isReference = capture.name.includes('name.reference');

    if (findType === 'definition' && !isDefinition) continue;
    if (findType === 'reference' && !isReference) continue;

    const line = capture.node.startPosition.row;
    results.push({
      name: symbolName,
      filePath,
      line,
      lineText: lines.at(line) ?? '',
      isDefinition,
    });
  }

  return results;
}

export async function findSymbolReferences(
  filePaths: string[],
  symbolName: string,
  findType: SymbolFindType = 'both',
): Promise<SymbolReference[]> {
  try {
    await ensureInitialized();
    const results: SymbolReference[] = [];

    for (const filePath of filePaths) {
      try {
        const fileRefs = await _processSingleFileReferences(filePath, symbolName, findType);
        results.push(...fileRefs);
      } catch {
        const fileRefs = findSymbolReferencesRegexFallback([filePath], symbolName, findType);
        results.push(...fileRefs);
      }
    }

    return results;
  } catch (error: unknown) {
    console.warn(
      `[AST] Tree-sitter bulk references failed, falling back to Regex search: ${extractErrorMessage(error)}`,
    );
    return findSymbolReferencesRegexFallback(filePaths, symbolName, findType);
  }
}

function hasWordBoundaryMatch(lineText: string, symbolName: string): boolean {
  let idx = lineText.indexOf(symbolName);
  while (idx !== -1) {
    const before = idx > 0 ? lineText.charAt(idx - 1) : ' ';
    const after =
      idx + symbolName.length < lineText.length ? lineText.charAt(idx + symbolName.length) : ' ';
    const beforeIsWord = /\w/.test(before);
    const afterIsWord = /\w/.test(after);
    if (!beforeIsWord && !afterIsWord) return true;
    idx = lineText.indexOf(symbolName, idx + 1);
  }
  return false;
}

function _findSymbolInLines(
  lines: string[],
  symbolName: string,
  filePath: string,
  findType: SymbolFindType,
): SymbolReference[] {
  const results: SymbolReference[] = [];
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines.at(i) ?? '';
    if (hasWordBoundaryMatch(lineText, symbolName)) {
      const isDefinition =
        /\bclass\b|\bfunction\b|\bpublic\b|\bprivate\b|\bmethod\b/.test(lineText) ||
        lineText.includes(`${symbolName}(`);

      if (findType === 'definition' && !isDefinition) continue;
      if (findType === 'reference' && isDefinition) continue;

      results.push({
        name: symbolName,
        filePath,
        line: i,
        lineText,
        isDefinition,
      });
    }
  }
  return results;
}

function findSymbolReferencesRegexFallback(
  filePaths: string[],
  symbolName: string,
  findType: SymbolFindType = 'both',
): SymbolReference[] {
  const results: SymbolReference[] = [];

  for (const filePath of filePaths) {
    try {
      const content = safeReadFileSync(filePath);
      const lines = content.split('\n');
      results.push(..._findSymbolInLines(lines, symbolName, filePath, findType));
    } catch {
      /* skip */
    }
  }
  return results;
}
