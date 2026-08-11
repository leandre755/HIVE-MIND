import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { Suggestion } from '../components/SuggestionsDisplay.js';
import { debugLogger } from '../../utils/errors.js';
import { safeReaddir } from '../../../utils/safeFs.js';
import { getArgumentCompletions } from './shell-completions/index.js';

/**
 * Maximum number of suggestions to return to avoid freezing the React Ink UI.
 */
const MAX_SHELL_SUGGESTIONS = 100;

/**
 * Debounce interval (ms) for file system completions.
 */
const FS_COMPLETION_DEBOUNCE_MS = 50;

import { escapeShellPath } from './shell-completions/utils.js';
export { escapeShellPath };

export interface TokenInfo {
  /** The raw token text (without surrounding quotes but with internal escapes). */
  token: string;
  /** Offset in the original line where this token begins. */
  start: number;
  /** Offset in the original line where this token ends (exclusive). */
  end: number;
  /** Whether this is the first token (command position). */
  isFirstToken: boolean;
  /** The fully built list of tokens parsing the string. */
  tokens: string[];
  /** The index in the tokens list where the cursor lies. */
  cursorIndex: number;
  /** The command token (always tokens[0] if length > 0, otherwise empty string) */
  commandToken: string;
}

function parseSingleQuotedString(line: string, i: number): { tokenSegment: string; nextI: number } {
  let tokenSegment = '';
  let idx = i + 1; // skip opening quote
  while (idx < line.length && line.at(idx) !== "'") {
    tokenSegment += line.at(idx) || '';
    idx++;
  }
  if (idx < line.length) idx++; // skip closing quote
  return { tokenSegment, nextI: idx };
}

function parseDoubleQuotedString(line: string, i: number): { tokenSegment: string; nextI: number } {
  let tokenSegment = '';
  let idx = i + 1; // skip opening quote
  while (idx < line.length && line.at(idx) !== '"') {
    if (line.at(idx) === '\\' && idx + 1 < line.length) {
      tokenSegment += line.at(idx + 1) || '';
      idx += 2;
    } else {
      tokenSegment += line.at(idx) || '';
      idx++;
    }
  }
  if (idx < line.length) idx++; // skip closing quote
  return { tokenSegment, nextI: idx };
}

function parseNextToken(line: string, i: number): { token: string; nextI: number } {
  let token = '';
  let idx = i;
  while (idx < line.length) {
    const ch = line.at(idx);
    if (ch === '\\' && idx + 1 < line.length) {
      token += line.at(idx + 1) || '';
      idx += 2;
    } else if (ch === "'") {
      const res = parseSingleQuotedString(line, idx);
      token += res.tokenSegment;
      idx = res.nextI;
    } else if (ch === '"') {
      const res = parseDoubleQuotedString(line, idx);
      token += res.tokenSegment;
      idx = res.nextI;
    } else if (ch === ' ' || ch === '\t') {
      break;
    } else {
      token += ch || '';
      idx++;
    }
  }
  return { token, nextI: idx };
}

export function getTokenAtCursor(line: string, cursorCol: number): TokenInfo | null {
  const tokensInfo: Array<{ token: string; start: number; end: number }> = [];
  let i = 0;

  while (i < line.length) {
    // Skip whitespace
    const curCh = line.at(i);
    if (curCh === ' ' || curCh === '\t') {
      i++;
      continue;
    }

    const tokenStart = i;
    const { token, nextI } = parseNextToken(line, i);
    i = nextI;
    tokensInfo.push({ token, start: tokenStart, end: i });
  }

  const rawTokens = tokensInfo.map((t) => t.token);
  const commandToken = rawTokens.length > 0 ? rawTokens[0] : '';

  if (tokensInfo.length === 0) {
    return {
      token: '',
      start: cursorCol,
      end: cursorCol,
      isFirstToken: true,
      tokens: [''],
      cursorIndex: 0,
      commandToken: '',
    };
  }

  // Find the token that contains or is immediately adjacent to the cursor
  for (let idx = 0; idx < tokensInfo.length; idx++) {
    const t = tokensInfo.at(idx);
    if (t && cursorCol >= t.start && cursorCol <= t.end) {
      return {
        token: t.token,
        start: t.start,
        end: t.end,
        isFirstToken: idx === 0,
        tokens: rawTokens,
        cursorIndex: idx,
        commandToken,
      };
    }
  }

  // Cursor is in whitespace between tokens, or at the start/end of the line.
  // Find the appropriate insertion index for a new empty token.
  let insertIndex = tokensInfo.length;
  for (let idx = 0; idx < tokensInfo.length; idx++) {
    const t = tokensInfo.at(idx);
    if (t && cursorCol < t.start) {
      insertIndex = idx;
      break;
    }
  }

  const newTokens = [...rawTokens.slice(0, insertIndex), '', ...rawTokens.slice(insertIndex)];

  return {
    token: '',
    start: cursorCol,
    end: cursorCol,
    isFirstToken: insertIndex === 0,
    tokens: newTokens,
    cursorIndex: insertIndex,
    commandToken: newTokens.length > 0 ? newTokens[0] : '',
  };
}

export async function scanPathExecutables(signal?: AbortSignal): Promise<string[]> {
  const pathEnv = process.env['PATH'] ?? '';
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const isWindows = process.platform === 'win32';
  const pathExtList = isWindows
    ? (process.env['PATHEXT'] ?? '.EXE;.CMD;.BAT;.COM')
        .split(';')
        .filter(Boolean)
        .map((e) => e.toLowerCase())
    : [];

  const seen = new Set<string>();
  const executables: string[] = [];

  // Add Windows shell built-ins
  if (isWindows) {
    const builtins = [
      'assoc',
      'break',
      'call',
      'cd',
      'chcp',
      'chdir',
      'cls',
      'color',
      'copy',
      'date',
      'del',
      'dir',
      'echo',
      'endlocal',
      'erase',
      'exit',
      'for',
      'ftype',
      'goto',
      'if',
      'md',
      'mkdir',
      'mklink',
      'move',
      'path',
      'pause',
      'popd',
      'prompt',
      'pushd',
      'rd',
      'rem',
      'ren',
      'rename',
      'rmdir',
      'set',
      'setlocal',
      'shift',
      'start',
      'time',
      'title',
      'type',
      'ver',
      'verify',
      'vol',
    ];
    for (const builtin of builtins) {
      seen.add(builtin);
      executables.push(builtin);
    }
  }

  const dirResults = await Promise.all(
    dirs.map(async (dir) => {
      if (signal?.aborted) return [];
      try {
        const entries = (await safeReaddir(dir, { withFileTypes: true })) as Dirent[];
        const validEntries: string[] = [];

        // Check executability in parallel (batched per directory)
        await Promise.all(
          entries.map(async (entry) => {
            if (signal?.aborted) return;
            if (!entry.isFile() && !entry.isSymbolicLink()) return;

            const name = entry.name;
            if (isWindows) {
              const ext = path.extname(name).toLowerCase();
              if (pathExtList.length > 0 && !pathExtList.includes(ext)) return;
            }

            try {
              await fs.access(path.join(dir, name), fs.constants.R_OK | fs.constants.X_OK);
              validEntries.push(name);
            } catch {
              // Not executable — skip
            }
          }),
        );

        return validEntries;
      } catch {
        // EACCES, ENOENT, etc. — skip this directory
        return [];
      }
    }),
  );

  for (const names of dirResults) {
    for (const name of names) {
      if (!seen.has(name)) {
        seen.add(name);
        executables.push(name);
      }
    }
  }

  executables.sort();
  return executables;
}

function expandTilde(inputPath: string): [string, boolean] {
  if (inputPath === '~' || inputPath.startsWith('~/') || inputPath.startsWith('~' + path.sep)) {
    return [path.join(os.homedir(), inputPath.slice(1)), true];
  }
  return [inputPath, false];
}

function getDirAndPrefix(
  expandedPartial: string,
  normalizedPartial: string,
  cwd: string,
): { dirToRead: string; prefix: string; endsWithSep: boolean } {
  const endsWithSep = normalizedPartial.endsWith('/') || normalizedPartial === '';
  const dirToRead = endsWithSep
    ? path.resolve(cwd, expandedPartial)
    : path.resolve(cwd, path.dirname(expandedPartial));
  const prefix = endsWithSep ? '' : path.basename(expandedPartial);
  return { dirToRead, prefix, endsWithSep };
}

function formatCompletionValue(
  normalizedPartial: string,
  displayName: string,
  endsWithSep: boolean,
  didExpandTilde: boolean,
): string {
  let completionValue: string;
  if (endsWithSep) {
    completionValue = normalizedPartial + displayName;
  } else {
    const parentPart = normalizedPartial.slice(
      0,
      normalizedPartial.length - path.basename(normalizedPartial).length,
    );
    completionValue = parentPart + displayName;
  }

  if (didExpandTilde) {
    const homeDir = os.homedir().replace(/\\/g, '/');
    if (completionValue.startsWith(homeDir)) {
      completionValue = '~' + completionValue.slice(homeDir.length);
    }
  }
  return escapeShellPath(completionValue);
}

function filterSuggestions(
  entries: Array<import('node:fs').Dirent>,
  showDotfiles: boolean,
  prefixLower: string,
  normalizedPartial: string,
  endsWithSep: boolean,
  didExpandTilde: boolean,
): Suggestion[] {
  const suggestions: Suggestion[] = [];
  for (const entry of entries) {
    const name = entry.name;
    if (name.startsWith('.') && !showDotfiles) continue;
    if (!name.toLowerCase().startsWith(prefixLower)) continue;

    const isDir = entry.isDirectory();
    const displayName = isDir ? name + '/' : name;
    const escapedValue = formatCompletionValue(
      normalizedPartial,
      displayName,
      endsWithSep,
      didExpandTilde,
    );

    suggestions.push({
      label: displayName,
      value: escapedValue,
      description: isDir ? 'directory' : 'file',
    });

    if (suggestions.length >= MAX_SHELL_SUGGESTIONS) break;
  }
  return suggestions;
}

export async function resolvePathCompletions(
  partial: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<Suggestion[]> {
  if (partial == null) return [];

  let strippedPartial = partial;
  if (strippedPartial.startsWith('"') || strippedPartial.startsWith("'")) {
    strippedPartial = strippedPartial.slice(1);
  }
  if (strippedPartial.endsWith('"') || strippedPartial.endsWith("'")) {
    strippedPartial = strippedPartial.slice(0, -1);
  }

  const normalizedPartial = strippedPartial.replace(/\\/g, '/');

  const [expandedPartial, didExpandTilde] = expandTilde(normalizedPartial);
  const { dirToRead, prefix, endsWithSep } = getDirAndPrefix(
    expandedPartial,
    normalizedPartial,
    cwd,
  );
  const prefixLower = prefix.toLowerCase();
  const showDotfiles = prefix.startsWith('.');

  let entries: Dirent[];
  try {
    if (signal?.aborted) return [];
    entries = (await safeReaddir(dirToRead, { withFileTypes: true })) as Dirent[];
  } catch {
    return [];
  }

  if (signal?.aborted) return [];

  const suggestions = filterSuggestions(
    entries,
    showDotfiles,
    prefixLower,
    normalizedPartial,
    endsWithSep,
    didExpandTilde,
  );

  suggestions.sort((a, b) => {
    const aIsDir = a.description === 'directory';
    const bIsDir = b.description === 'directory';
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  return suggestions;
}

export interface UseShellCompletionProps {
  enabled: boolean;
  line: string;
  cursorCol: number;
  cwd: string;
  setSuggestions: (suggestions: Suggestion[]) => void;
  setIsLoadingSuggestions: (isLoading: boolean) => void;
}

export interface UseShellCompletionReturn {
  completionStart: number;
  completionEnd: number;
  query: string;
  activeStart: number;
}

const EMPTY_TOKENS: string[] = [];

async function fetchCommandCompletions(
  query: string,
  signal: AbortSignal,
  pathCachePromiseRef: React.MutableRefObject<Promise<string[]> | null>,
): Promise<Suggestion[]> {
  if (!pathCachePromiseRef.current) {
    pathCachePromiseRef.current = scanPathExecutables();
  }
  const executables = await pathCachePromiseRef.current;
  if (signal.aborted) return [];
  const queryLower = query.toLowerCase();
  return executables
    .filter((cmd) => cmd.toLowerCase().startsWith(queryLower))
    .sort((a, b) => (a.length !== b.length ? a.length - b.length : a.localeCompare(b)))
    .slice(0, MAX_SHELL_SUGGESTIONS)
    .map((cmd) => ({
      label: cmd,
      value: escapeShellPath(cmd),
      description: 'command',
    }));
}

async function fetchArgumentCompletions(
  commandToken: string,
  tokens: string[],
  cursorIndex: number,
  cwd: string,
  query: string,
  signal: AbortSignal,
): Promise<Suggestion[]> {
  const argumentCompletions = await getArgumentCompletions(
    commandToken,
    tokens,
    cursorIndex,
    cwd,
    signal,
  );
  if (signal.aborted) return [];

  if (argumentCompletions?.exclusive) {
    return argumentCompletions.suggestions ?? [];
  } else {
    const pathSuggestions = await resolvePathCompletions(query, cwd, signal);
    if (signal.aborted) return [];
    return [...(argumentCompletions?.suggestions ?? []), ...pathSuggestions].slice(
      0,
      MAX_SHELL_SUGGESTIONS,
    );
  }
}

function handleCompletionError(
  error: unknown,
  signal: AbortSignal,
  safeSetSuggestions: (s: Suggestion[]) => void,
  setActiveStart: (s: number) => void,
  completionStart: number,
) {
  const isAbortError = signal.aborted || (error instanceof Error && error.name === 'AbortError');
  if (!isAbortError) {
    debugLogger.warn(
      `[WARN] shell completion failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    safeSetSuggestions([]);
    setActiveStart(completionStart);
  }
}

export function useShellCompletion({
  enabled,
  line,
  cursorCol,
  cwd,
  setSuggestions,
  setIsLoadingSuggestions,
}: UseShellCompletionProps): UseShellCompletionReturn {
  const pathCachePromiseRef = useRef<Promise<string[]> | null>(null);
  const pathEnvRef = useRef<string>(process.env['PATH'] ?? '');
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const [activeStart, setActiveStart] = useState<number>(-1);
  const prevSuggestionsCountRef = useRef<number>(-1);
  const prevIsLoadingRef = useRef<boolean | null>(null);

  const safeSetSuggestions = useCallback(
    (suggestions: Suggestion[]) => {
      if (suggestions.length === 0 && prevSuggestionsCountRef.current === 0) {
        return;
      }
      prevSuggestionsCountRef.current = suggestions.length;
      setSuggestions(suggestions);
    },
    [setSuggestions],
  );

  const safeSetIsLoadingSuggestions = useCallback(
    (isLoading: boolean) => {
      if (prevIsLoadingRef.current === isLoading) {
        return;
      }
      prevIsLoadingRef.current = isLoading;
      setIsLoadingSuggestions(isLoading);
    },
    [setIsLoadingSuggestions],
  );

  const tokenInfo = useMemo(
    () => (enabled ? getTokenAtCursor(line, cursorCol) : null),
    [enabled, line, cursorCol],
  );

  const {
    token: query = '',
    start: completionStart = -1,
    end: completionEnd = -1,
    isFirstToken: isCommandPosition = false,
    tokens = EMPTY_TOKENS,
    cursorIndex = -1,
    commandToken = '',
  } = tokenInfo || {};

  useEffect(() => {
    if (enabled && activeStart !== -1 && completionStart !== activeStart) {
      safeSetSuggestions([]);
      setActiveStart(-1);
    }
  }, [enabled, activeStart, completionStart, safeSetSuggestions]);

  useEffect(() => {
    const currentPath = process.env['PATH'] ?? '';
    if (currentPath !== pathEnvRef.current) {
      pathCachePromiseRef.current = null;
      pathEnvRef.current = currentPath;
    }
  }, []);

  const performCompletion = useCallback(async () => {
    if (!enabled || !tokenInfo || query.startsWith('-')) {
      safeSetSuggestions([]);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    try {
      safeSetIsLoadingSuggestions(isCommandPosition);
      const results = isCommandPosition
        ? await fetchCommandCompletions(query, signal, pathCachePromiseRef)
        : await fetchArgumentCompletions(commandToken, tokens, cursorIndex, cwd, query, signal);

      if (signal.aborted) return;
      safeSetSuggestions(results);
      setActiveStart(completionStart);
    } catch (error) {
      handleCompletionError(error, signal, safeSetSuggestions, setActiveStart, completionStart);
    } finally {
      if (!signal.aborted) {
        safeSetIsLoadingSuggestions(false);
      }
    }
  }, [
    enabled,
    tokenInfo,
    query,
    isCommandPosition,
    tokens,
    cursorIndex,
    commandToken,
    cwd,
    completionStart,
    safeSetSuggestions,
    safeSetIsLoadingSuggestions,
  ]);

  useEffect(() => {
    if (!enabled) {
      abortRef.current?.abort();
      safeSetSuggestions([]);
      setActiveStart((prev) => (prev === -1 ? prev : -1));
      safeSetIsLoadingSuggestions(false);
    }
  }, [enabled, safeSetSuggestions, safeSetIsLoadingSuggestions]);

  useEffect(() => {
    if (!enabled) return;

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      performCompletion();
    }, FS_COMPLETION_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [enabled, performCompletion]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    },
    [],
  );

  return {
    completionStart,
    completionEnd,
    query,
    activeStart,
  };
}
