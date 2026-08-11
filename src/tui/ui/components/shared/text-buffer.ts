function tryHandleUnboundedInputCommandA(key: Key, d: InputHandlerDeps): boolean | null {
  const { sequence } = key;
  if (key.name === 'paste') {
    d.insert(sequence, { paste: true });
    return true;
  }
  if (d.keyMatchers[Command.RETURN](key) || d.keyMatchers[Command.NEWLINE](key)) {
    if (d.singleLine) return false;
    d.newline();
    return true;
  }
  if (d.keyMatchers[Command.MOVE_LEFT](key)) {
    if (d.cursorRow === 0 && d.cursorCol === 0) return false;
    d.move('left');
    return true;
  }
  if (d.keyMatchers[Command.MOVE_UP](key)) {
    if (d.visualCursor[0] === 0) return false;
    d.move('up');
    return true;
  }
  if (d.keyMatchers[Command.MOVE_DOWN](key)) {
    if (d.visualCursor[0] === d.visualLines.length - 1) return false;
    d.move('down');
    return true;
  }
  return null;
}

function tryHandleUnboundedInputCommandB(key: Key, d: InputHandlerDeps): boolean | null {
  const { sequence } = key;
  if (d.keyMatchers[Command.MOVE_WORD_LEFT](key)) {
    d.move('wordLeft');
    return true;
  }
  if (d.keyMatchers[Command.MOVE_WORD_RIGHT](key)) {
    d.move('wordRight');
    return true;
  }
  if (d.keyMatchers[Command.HOME](key)) {
    d.move('home');
    return true;
  }
  if (d.keyMatchers[Command.END](key)) {
    d.move('end');
    return true;
  }
  if (d.keyMatchers[Command.CLEAR_INPUT](key)) {
    if (d.text.length > 0) {
      d.setText('');
      return true;
    }
    return false;
  }
  if (d.keyMatchers[Command.DELETE_WORD_BACKWARD](key)) {
    d.deleteWordLeft();
    return true;
  }
  if (d.keyMatchers[Command.DELETE_WORD_FORWARD](key)) {
    d.deleteWordRight();
    return true;
  }
  if (d.keyMatchers[Command.DELETE_CHAR_LEFT](key)) {
    d.backspace();
    return true;
  }
  if (key.insertable) {
    d.insert(sequence, { paste: false });
    return true;
  }
  return null;
}

function tryHandleUnboundedInputCommand(key: Key, d: InputHandlerDeps): boolean | null {
  return tryHandleUnboundedInputCommandA(key, d) ?? tryHandleUnboundedInputCommandB(key, d);
}

function handleCollapseExpandedPaste(state: TextBufferState, id: string): TextBufferState {
  const expandedPaste = state.expandedPaste!;
  const nextState = pushUndo(state);
  const newLines = [...nextState.lines];
  newLines.splice(
    expandedPaste.startLine,
    expandedPaste.lineCount,
    expandedPaste.prefix + id + expandedPaste.suffix,
  );
  const newCursorRow = expandedPaste.startLine;
  const newCursorCol = cpLen(expandedPaste.prefix) + cpLen(id);
  return {
    ...nextState,
    lines: newLines,
    cursorRow: newCursorRow,
    cursorCol: newCursorCol,
    preferredCol: null,
    expandedPaste: null,
  };
}

import os from 'node:os';
import pathMod, * as path from 'node:path';
import { useState, useCallback, useEffect, useMemo, useReducer } from 'react';
import { LRUCache } from 'mnemonist';
import { debugLogger, getErrorMessage } from '../../../utils/errors.js';
import {
  safeMkdtempSync,
  safeWriteFileSync,
  safeReadFileSync,
  safeUnlinkSync,
  safeRmdirSync,
} from '../../../../utils/safeFs.js';
import { coreEvents } from '../../../utils/coreEvents.js';
import {
  unescapePath,
  EditorType,
  handleVimAction,
  VimAction,
} from '../../contexts/UIStateContext.js';
import {
  toCodePoints,
  cpLen,
  cpSlice,
  stripUnsafeCharacters,
  getCachedStringWidth,
} from '../../utils/textUtils.js';
import { parsePastedPaths } from '../../utils/clipboardUtils.js';
import type { Key } from '../../contexts/KeypressContext.js';
import { Command } from '../../key/keyMatchers.js';
import { LRU_BUFFER_PERF_CACHE_LIMIT } from '../../constants.js';
import { openFileInEditor } from '../../utils/editorUtils.js';
import { useSettings } from '../../contexts/SettingsContext.js';
import { useKeyMatchers } from '../../hooks/useKeyMatchers.js';

export const LARGE_PASTE_LINE_THRESHOLD = 5;
export const LARGE_PASTE_CHAR_THRESHOLD = 500;

// Regex to match paste placeholders like [Pasted Text: 6 lines] or [Pasted Text: 501 chars #2]
export const PASTED_TEXT_PLACEHOLDER_REGEX =
  /\[Pasted Text: \d+ (?:lines|chars)\]|\[Pasted Text: \d+ (?:lines|chars) #\d+\]/g;

// Replace paste placeholder strings with their actual pasted content.
export function expandPastePlaceholders(
  text: string,
  pastedContent: Record<string, string>,
): string {
  const map = new Map(Object.entries(pastedContent));
  return text.replace(PASTED_TEXT_PLACEHOLDER_REGEX, (match) => map.get(match) || match);
}

export type Direction =
  'left' | 'right' | 'up' | 'down' | 'wordLeft' | 'wordRight' | 'home' | 'end';

// Helper functions for line-based word navigation
export const isWordCharStrict = (char: string): boolean => /[\w\p{L}\p{N}]/u.test(char); // Matches a single character that is any Unicode letter, any Unicode number, or an underscore

export const isWhitespace = (char: string): boolean => /\s/.test(char);

// Check if a character is a combining mark (only diacritics for now)
export const isCombiningMark = (char: string): boolean => /\p{M}/u.test(char);

// Check if a character should be considered part of a word (including combining marks)
export const isWordCharWithCombining = (char: string): boolean =>
  isWordCharStrict(char) || isCombiningMark(char);

// Get the script of a character (simplified for common scripts)
export const getCharScript = (char: string): string => {
  if (/\p{Script=Latin}/u.test(char)) return 'latin'; // All Latin script chars including diacritics
  if (/\p{Script=Han}/u.test(char)) return 'han'; // Chinese
  if (/\p{Script=Arabic}/u.test(char)) return 'arabic';
  if (/\p{Script=Hiragana}/u.test(char)) return 'hiragana';
  if (/\p{Script=Katakana}/u.test(char)) return 'katakana';
  if (/\p{Script=Cyrillic}/u.test(char)) return 'cyrillic';
  return 'other';
};

// Check if two characters are from different scripts (indicating word boundary)
export const isDifferentScript = (char1: string, char2: string): boolean => {
  if (!isWordCharStrict(char1) || !isWordCharStrict(char2)) return false;
  return getCharScript(char1) !== getCharScript(char2);
};

// Helpers to reduce cognitive complexity
function skipSameScriptWordChars(chars: string[], startIndex: number): number {
  let i = startIndex;
  while (i < chars.length && isWordCharWithCombining(chars.at(i) || '')) {
    if (
      i + 1 < chars.length &&
      isWordCharStrict(chars.at(i + 1) || '') &&
      isDifferentScript(chars.at(i) || '', chars.at(i + 1) || '')
    ) {
      return i + 1;
    }
    i++;
  }
  return i;
}

function skipNonWordNonWhitespace(chars: string[], startIndex: number): number {
  let i = startIndex;
  while (
    i < chars.length &&
    !isWordCharStrict(chars.at(i) || '') &&
    !isWhitespace(chars.at(i) || '')
  )
    i++;
  return i;
}

function skipWhitespace(chars: string[], startIndex: number): number {
  let i = startIndex;
  while (i < chars.length && isWhitespace(chars.at(i) || '')) i++;
  return i;
}

function skipSameScriptWordCharsBackward(chars: string[], startIndex: number): number {
  let i = startIndex;
  while (i >= 0 && isWordCharStrict(chars.at(i) || '')) {
    if (
      i - 1 >= 0 &&
      isWordCharStrict(chars.at(i - 1) || '') &&
      isDifferentScript(chars.at(i) || '', chars.at(i - 1) || '')
    )
      return i;
    i--;
  }
  return i + 1;
}

function skipNonWordNonWhitespaceBackward(chars: string[], startIndex: number): number {
  let i = startIndex;
  while (i >= 0 && !isWordCharStrict(chars.at(i) || '') && !isWhitespace(chars.at(i) || '')) i--;
  return i + 1;
}

function skipWhitespaceBackward(chars: string[], startIndex: number): number {
  let i = startIndex;
  while (i >= 0 && isWhitespace(chars.at(i) || '')) i--;
  return i;
}

// Find next word start within a line, starting from col
export const findNextWordStartInLine = (line: string, col: number): number | null => {
  const chars = toCodePoints(line);
  let i = col;

  if (i >= chars.length) return null;

  const currentChar = chars.at(i) || '';

  if (isWordCharStrict(currentChar)) {
    i = skipSameScriptWordChars(chars, i);
  } else if (!isWhitespace(currentChar)) {
    i = skipNonWordNonWhitespace(chars, i);
  }

  i = skipWhitespace(chars, i);

  return i < chars.length ? i : null;
};

// Find previous word start within a line
export const findPrevWordStartInLine = (line: string, col: number): number | null => {
  const chars = toCodePoints(line);
  let i = col;

  if (i <= 0) return null;

  i--;

  i = skipWhitespaceBackward(chars, i);

  if (i < 0) return null;

  if (isWordCharStrict(chars.at(i) || '')) {
    return skipSameScriptWordCharsBackward(chars, i);
  } else {
    return skipNonWordNonWhitespaceBackward(chars, i);
  }
};

function isAtWordEnd(chars: string[], i: number): boolean {
  let nextBaseCharIdx = i + 1;
  while (nextBaseCharIdx < chars.length && isCombiningMark(chars.at(nextBaseCharIdx) || '')) {
    nextBaseCharIdx++;
  }
  return (
    i < chars.length &&
    isWordCharWithCombining(chars.at(i) || '') &&
    (nextBaseCharIdx >= chars.length ||
      !isWordCharStrict(chars.at(nextBaseCharIdx) || '') ||
      (isWordCharStrict(chars.at(i) || '') &&
        isDifferentScript(chars.at(i) || '', chars.at(nextBaseCharIdx) || '')))
  );
}

function isAtPunctuationEnd(chars: string[], i: number): boolean {
  return (
    i < chars.length &&
    !isWordCharWithCombining(chars.at(i) || '') &&
    !isWhitespace(chars.at(i) || '') &&
    (i + 1 >= chars.length ||
      isWhitespace(chars.at(i + 1) || '') ||
      isWordCharWithCombining(chars.at(i + 1) || ''))
  );
}

function advanceWordCharBase(
  chars: string[],
  currentIndex: number,
): { i: number; foundWord: boolean; lastBaseCharPos: number } {
  let lastBaseCharPos = -1;
  let i = currentIndex;
  while (i < chars.length && isWordCharWithCombining(chars.at(i) || '')) {
    if (isWordCharStrict(chars.at(i) || '')) lastBaseCharPos = i;
    if (
      i + 1 < chars.length &&
      isWordCharStrict(chars.at(i + 1) || '') &&
      isDifferentScript(chars.at(i) || '', chars.at(i + 1) || '')
    ) {
      i++;
      if (isWordCharStrict(chars.at(i - 1) || '')) lastBaseCharPos = i - 1;
      break;
    }
    i++;
  }
  return { i, foundWord: true, lastBaseCharPos };
}

function advanceNonWordNonSpaceChar(
  chars: string[],
  currentIndex: number,
): { i: number; foundWord: boolean; lastBaseCharPos: number } {
  let lastBaseCharPos = -1;
  let i = currentIndex;
  while (
    i < chars.length &&
    !isWordCharStrict(chars.at(i) || '') &&
    !isWhitespace(chars.at(i) || '')
  ) {
    lastBaseCharPos = i;
    i++;
  }
  return { i, foundWord: true, lastBaseCharPos };
}

function advanceToEndOfWord(
  chars: string[],
  i: number,
): { i: number; foundWord: boolean; lastBaseCharPos: number } {
  if (i < chars.length && isWordCharWithCombining(chars.at(i) || '')) {
    return advanceWordCharBase(chars, i);
  } else if (i < chars.length && !isWhitespace(chars.at(i) || '')) {
    return advanceNonWordNonSpaceChar(chars, i);
  }
  return { i, foundWord: false, lastBaseCharPos: -1 };
}

// Find word end within a line
export const findWordEndInLine = (line: string, col: number): number | null => {
  const chars = toCodePoints(line);
  let i = col;

  if (isAtWordEnd(chars, i) || isAtPunctuationEnd(chars, i)) {
    i++;
    while (i < chars.length && isCombiningMark(chars.at(i) || '')) {
      i++;
    }
    while (i < chars.length && isWhitespace(chars.at(i) || '')) {
      i++;
    }
  }

  if (i < chars.length && !isWordCharWithCombining(chars.at(i) || '')) {
    while (i < chars.length && isWhitespace(chars.at(i) || '')) {
      i++;
    }
  }

  const advanced = advanceToEndOfWord(chars, i);
  const foundWord = advanced.foundWord;
  const lastBaseCharPos = advanced.lastBaseCharPos;

  if (foundWord && lastBaseCharPos >= col) {
    return lastBaseCharPos;
  }

  return null;
};

// Find next big word start within a line (W)
export const findNextBigWordStartInLine = (line: string, col: number): number | null => {
  const chars = toCodePoints(line);
  let i = col;

  if (i >= chars.length) return null;

  // If currently on non-whitespace, skip it
  if (!isWhitespace(chars.at(i) || '')) {
    while (i < chars.length && !isWhitespace(chars.at(i) || '')) {
      i++;
    }
  }

  // Skip whitespace
  while (i < chars.length && isWhitespace(chars.at(i) || '')) {
    i++;
  }

  return i < chars.length ? i : null;
};

// Find previous big word start within a line (B)
export const findPrevBigWordStartInLine = (line: string, col: number): number | null => {
  const chars = toCodePoints(line);
  let i = col;

  if (i <= 0) return null;

  i--;

  // Skip whitespace moving backwards
  while (i >= 0 && isWhitespace(chars.at(i) || '')) {
    i--;
  }

  if (i < 0) return null;

  // We're in a big word, move to its beginning
  while (i >= 0 && !isWhitespace(chars.at(i) || '')) {
    i--;
  }
  return i + 1;
};

// Find big word end within a line (E)
export const findBigWordEndInLine = (line: string, col: number): number | null => {
  const chars = toCodePoints(line);
  let i = col;

  // If we're already at the end of a big word, advance to next
  const atEndOfBigWord =
    i < chars.length &&
    !isWhitespace(chars.at(i) || '') &&
    (i + 1 >= chars.length || isWhitespace(chars.at(i + 1) || ''));

  if (atEndOfBigWord) {
    i++;
  }

  // Skip whitespace
  while (i < chars.length && isWhitespace(chars.at(i) || '')) {
    i++;
  }

  // Move to end of current big word
  if (i < chars.length && !isWhitespace(chars.at(i) || '')) {
    while (i < chars.length && !isWhitespace(chars.at(i) || '')) {
      i++;
    }
    return i - 1;
  }

  return null;
};

// Initialize segmenter for word boundary detection
const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });

function findPrevWordBoundary(line: string, cursorCol: number): number {
  const codePoints = toCodePoints(line);
  // Convert cursorCol (CP index) to string index
  const prefix = codePoints.slice(0, cursorCol).join('');
  const cursorIdx = prefix.length;

  let targetIdx = 0;

  for (const seg of segmenter.segment(line)) {
    // We want the last word start strictly before the cursor.
    // If we've reached or passed the cursor, we stop.
    if (seg.index >= cursorIdx) break;

    if (seg.isWordLike) {
      targetIdx = seg.index;
    }
  }

  return toCodePoints(line.slice(0, targetIdx)).length;
}

function findNextWordBoundary(line: string, cursorCol: number): number {
  const codePoints = toCodePoints(line);
  const prefix = codePoints.slice(0, cursorCol).join('');
  const cursorIdx = prefix.length;

  let targetIdx = line.length;

  for (const seg of segmenter.segment(line)) {
    const segEnd = seg.index + seg.segment.length;

    if (segEnd > cursorIdx) {
      if (seg.isWordLike) {
        targetIdx = segEnd;
        break;
      }
    }
  }

  return toCodePoints(line.slice(0, targetIdx)).length;
}

function processLineForWordSearch(
  line: string,
  row: number,
  searchForWordStart: boolean,
  findEndFn: (l: string, col: number) => number | null,
): { row: number; col: number } | null {
  const chars = toCodePoints(line);
  let firstNonWhitespace = 0;
  while (firstNonWhitespace < chars.length && isWhitespace(chars.at(firstNonWhitespace) || '')) {
    firstNonWhitespace++;
  }
  if (firstNonWhitespace < chars.length) {
    if (searchForWordStart) return { row, col: firstNonWhitespace };
    const endCol = findEndFn(line, firstNonWhitespace);
    if (endCol !== null) return { row, col: endCol };
  }
  return null;
}

function searchSubsequentLinesForWord(
  lines: string[],
  startRow: number,
  searchForWordStart: boolean,
  findEndFn: (line: string, col: number) => number | null,
): { row: number; col: number } | null {
  let firstEmptyRow: number | null = null;
  for (let row = startRow; row < lines.length; row++) {
    const line = lines.at(row) || '';
    if (toCodePoints(line).length === 0) {
      if (firstEmptyRow === null) firstEmptyRow = row;
      continue;
    }
    const result = processLineForWordSearch(line, row, searchForWordStart, findEndFn);
    if (result) return result;
  }
  if (firstEmptyRow !== null) return { row: firstEmptyRow, col: 0 };
  return null;
}

// Find next word across lines
export const findNextWordAcrossLines = (
  lines: string[],
  cursorRow: number,
  cursorCol: number,
  searchForWordStart: boolean,
): { row: number; col: number } | null => {
  const currentLine = lines.at(cursorRow) || '';
  const colInCurrentLine = searchForWordStart
    ? findNextWordStartInLine(currentLine, cursorCol)
    : findWordEndInLine(currentLine, cursorCol);

  if (colInCurrentLine !== null) {
    return { row: cursorRow, col: colInCurrentLine };
  }

  return searchSubsequentLinesForWord(lines, cursorRow + 1, searchForWordStart, findWordEndInLine);
};

// Find previous word across lines
export const findPrevWordAcrossLines = (
  lines: string[],
  cursorRow: number,
  cursorCol: number,
): { row: number; col: number } | null => {
  // First try current line
  const currentLine = lines.at(cursorRow) || '';
  const colInCurrentLine = findPrevWordStartInLine(currentLine, cursorCol);

  if (colInCurrentLine !== null) {
    return { row: cursorRow, col: colInCurrentLine };
  }

  // Search previous lines
  for (let row = cursorRow - 1; row >= 0; row--) {
    const line = lines.at(row) || '';
    const chars = toCodePoints(line);

    if (chars.length === 0) continue;

    // Find last word start
    let lastWordStart = chars.length;
    while (lastWordStart > 0 && isWhitespace(chars.at(lastWordStart - 1) || '')) {
      lastWordStart--;
    }

    if (lastWordStart > 0) {
      // Find start of this word
      const wordStart = findPrevWordStartInLine(line, lastWordStart);
      if (wordStart !== null) {
        return { row, col: wordStart };
      }
    }
  }

  return null;
};

// Find next big word across lines
export const findNextBigWordAcrossLines = (
  lines: string[],
  cursorRow: number,
  cursorCol: number,
  searchForWordStart: boolean,
): { row: number; col: number } | null => {
  const currentLine = lines.at(cursorRow) || '';
  const colInCurrentLine = searchForWordStart
    ? findNextBigWordStartInLine(currentLine, cursorCol)
    : findBigWordEndInLine(currentLine, cursorCol);

  if (colInCurrentLine !== null) {
    return { row: cursorRow, col: colInCurrentLine };
  }

  return searchSubsequentLinesForWord(
    lines,
    cursorRow + 1,
    searchForWordStart,
    findBigWordEndInLine,
  );
};

// Find previous big word across lines
export const findPrevBigWordAcrossLines = (
  lines: string[],
  cursorRow: number,
  cursorCol: number,
): { row: number; col: number } | null => {
  // First try current line
  const currentLine = lines.at(cursorRow) || '';
  const colInCurrentLine = findPrevBigWordStartInLine(currentLine, cursorCol);

  if (colInCurrentLine !== null) {
    return { row: cursorRow, col: colInCurrentLine };
  }

  // Search previous lines
  for (let row = cursorRow - 1; row >= 0; row--) {
    const line = lines.at(row) || '';
    const chars = toCodePoints(line);

    if (chars.length === 0) continue;

    // Find last big word start
    let lastWordStart = chars.length;
    while (lastWordStart > 0 && isWhitespace(chars.at(lastWordStart - 1) || '')) {
      lastWordStart--;
    }

    if (lastWordStart > 0) {
      const wordStart = findPrevBigWordStartInLine(line, lastWordStart);
      if (wordStart !== null) {
        return { row, col: wordStart };
      }
    }
  }

  return null;
};

// Helper functions for vim line operations
export const getPositionFromOffsets = (startOffset: number, endOffset: number, lines: string[]) => {
  let offset = 0;
  let startRow = 0;
  let startCol = 0;
  let endRow = 0;
  let endCol = 0;

  // Find start position
  for (let i = 0; i < lines.length; i++) {
    const lineLength = (lines.at(i)?.length ?? 0) + 1; // +1 for newline
    if (offset + lineLength > startOffset) {
      startRow = i;
      startCol = startOffset - offset;
      break;
    }
    offset += lineLength;
  }

  // Find end position
  offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineLength = (lines.at(i)?.length ?? 0) + (i < lines.length - 1 ? 1 : 0); // +1 for newline except last line
    if (offset + lineLength >= endOffset) {
      endRow = i;
      endCol = endOffset - offset;
      break;
    }
    offset += lineLength;
  }

  return { startRow, startCol, endRow, endCol };
};

export const getLineRangeOffsets = (startRow: number, lineCount: number, lines: string[]) => {
  let startOffset = 0;

  // Calculate start offset
  for (let i = 0; i < startRow; i++) {
    startOffset += (lines.at(i)?.length ?? 0) + 1; // +1 for newline
  }

  // Calculate end offset
  let endOffset = startOffset;
  for (let i = 0; i < lineCount; i++) {
    const lineIndex = startRow + i;
    if (lineIndex < lines.length) {
      endOffset += lines.at(lineIndex)?.length ?? 0;
      if (lineIndex < lines.length - 1) {
        endOffset += 1; // +1 for newline
      }
    }
  }

  return { startOffset, endOffset };
};

export const replaceRangeInternal = (
  state: TextBufferState,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  text: string,
): TextBufferState => {
  const currentLine = (row: number) => state.lines.at(row) || '';
  const currentLineLen = (row: number) => cpLen(currentLine(row));
  const clampVal = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

  if (
    startRow > endRow ||
    (startRow === endRow && startCol > endCol) ||
    startRow < 0 ||
    startCol < 0 ||
    endRow >= state.lines.length ||
    (endRow < state.lines.length && endCol > currentLineLen(endRow))
  ) {
    return state; // Invalid range
  }

  const newLines = [...state.lines];

  const sCol = clampVal(startCol, 0, currentLineLen(startRow));
  const eCol = clampVal(endCol, 0, currentLineLen(endRow));

  const prefix = cpSlice(currentLine(startRow), 0, sCol);
  const suffix = cpSlice(currentLine(endRow), eCol);

  const normalisedReplacement = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const replacementParts = normalisedReplacement.split('\n');

  // The combined first line of the new text
  const firstLine = prefix + replacementParts[0];

  if (replacementParts.length === 1) {
    // No newlines in replacement: combine prefix, replacement, and suffix on one line.
    newLines.splice(startRow, endRow - startRow + 1, firstLine + suffix);
  } else {
    // Newlines in replacement: create new lines.
    const lastLine = replacementParts[replacementParts.length - 1] + suffix;
    const middleLines = replacementParts.slice(1, -1);
    newLines.splice(startRow, endRow - startRow + 1, firstLine, ...middleLines, lastLine);
  }

  const finalCursorRow = startRow + replacementParts.length - 1;
  const finalCursorCol =
    (replacementParts.length > 1 ? 0 : sCol) + cpLen(replacementParts.at(-1) ?? '');

  return {
    ...state,
    lines: newLines,
    cursorRow: Math.min(Math.max(finalCursorRow, 0), newLines.length - 1),
    cursorCol: Math.max(0, Math.min(finalCursorCol, cpLen(newLines.at(finalCursorRow) ?? ''))),
    preferredCol: null,
  };
};

export interface Viewport {
  height: number;
  width: number;
}

function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/* ────────────────────────────────────────────────────────────────────────── */

interface UseTextBufferProps {
  initialText?: string;
  initialCursorOffset?: number;
  viewport: Viewport; // Viewport dimensions needed for scrolling
  stdin?: NodeJS.ReadStream | null; // For external editor
  setRawMode?: (mode: boolean) => void; // For external editor
  onChange?: (text: string) => void; // Callback for when text changes
  escapePastedPaths?: boolean;
  shellModeActive?: boolean; // Whether the text buffer is in shell mode
  inputFilter?: (text: string) => string; // Optional filter for input text
  singleLine?: boolean;
  getPreferredEditor?: () => EditorType | undefined;
}

interface UndoHistoryEntry {
  lines: string[];
  cursorRow: number;
  cursorCol: number;
  pastedContent: Record<string, string>;
  expandedPaste: ExpandedPasteInfo | null;
}

function calculateInitialCursorPosition(initialLines: string[], offset: number): [number, number] {
  let remainingChars = offset;
  let row = 0;
  while (row < initialLines.length) {
    const lineLength = cpLen(initialLines.at(row) ?? '');
    // Add 1 for the newline character (except for the last line)
    const totalCharsInLineAndNewline = lineLength + (row < initialLines.length - 1 ? 1 : 0);

    if (remainingChars <= lineLength) {
      // Cursor is on this line
      return [row, remainingChars];
    }
    remainingChars -= totalCharsInLineAndNewline;
    row++;
  }
  // Offset is beyond the text, place cursor at the end of the last line
  if (initialLines.length > 0) {
    const lastRow = initialLines.length - 1;
    return [lastRow, cpLen(initialLines.at(lastRow) ?? '')];
  }
  return [0, 0]; // Default for empty text
}

export function offsetToLogicalPos(text: string, offset: number): [number, number] {
  let row = 0;
  let col = 0;
  let currentOffset = 0;

  if (offset === 0) return [0, 0];

  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines.at(i) ?? '';
    const lineLength = cpLen(line);
    const lineLengthWithNewline = lineLength + (i < lines.length - 1 ? 1 : 0);

    if (offset <= currentOffset + lineLength) {
      // Check against lineLength first
      row = i;
      col = offset - currentOffset;
      return [row, col];
    } else if (offset <= currentOffset + lineLengthWithNewline) {
      // Check if offset is the newline itself
      row = i;
      col = lineLength; // Position cursor at the end of the current line content
      // If the offset IS the newline, and it's not the last line, advance to next line, col 0
      if (offset === currentOffset + lineLengthWithNewline && i < lines.length - 1) {
        return [i + 1, 0];
      }
      return [row, col]; // Otherwise, it's at the end of the current line content
    }
    currentOffset += lineLengthWithNewline;
  }

  // If offset is beyond the text length, place cursor at the end of the last line
  // or [0,0] if text is empty
  if (lines.length > 0) {
    return [lines.length - 1, cpLen(lines.at(lines.length - 1) ?? '')];
  }
  return [0, 0];
}

/**
 * Converts logical row/col position to absolute text offset
 * Inverse operation of offsetToLogicalPos
 */
export function logicalPosToOffset(lines: string[], row: number, col: number): number {
  let offset = 0;

  // Clamp row to valid range
  const actualRow = Math.min(row, lines.length - 1);

  // Add lengths of all lines before the target row
  for (let i = 0; i < actualRow; i++) {
    offset += cpLen(lines.at(i) ?? '') + 1; // +1 for newline
  }

  // Add column offset within the target row
  if (actualRow >= 0 && actualRow < lines.length) {
    offset += Math.min(col, cpLen(lines.at(actualRow) ?? ''));
  }

  return offset;
}
/**
 * Transformations allow for the CLI to render terse representations of things like file paths
 * (e.g., "@some/path/to/an/image.png" to "[Image image.png]")
 * When the cursor enters a transformed representation, it expands to reveal the logical representation.
 * (e.g., "[Image image.png]" to "@some/path/to/an/image.png")
 */
export interface Transformation {
  logStart: number;
  logEnd: number;
  logicalText: string;
  collapsedText: string;
  type: 'image' | 'paste';
  id?: string; // For paste placeholders
}
export const imagePathRegex = /@[\w/\\.-]+\.(?:png|jpg|jpeg|gif|webp|svg|bmp)\b/gi;

export function getTransformedImagePath(filePath: string): string {
  const raw = filePath;

  // Ignore leading @ when stripping directories, but keep it for simple '@file.png'
  const withoutAt = raw.startsWith('@') ? raw.slice(1) : raw;

  // Unescape the path to handle escaped spaces and other characters
  const unescaped = unescapePath(withoutAt);

  // Find last directory separator, supporting both POSIX and Windows styles
  const lastSepIndex = Math.max(unescaped.lastIndexOf('/'), unescaped.lastIndexOf('\\'));

  // If we saw a separator, take the segment after it; otherwise fall back to the unescaped string
  const fileName = lastSepIndex >= 0 ? unescaped.slice(lastSepIndex + 1) : unescaped;

  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);
  const maxBaseLength = 10;

  const truncatedBase =
    baseName.length > maxBaseLength ? `...${baseName.slice(-maxBaseLength)}` : baseName;

  return `[Image ${truncatedBase}${extension}]`;
}

const transformationsCache = new LRUCache<string, Transformation[]>(LRU_BUFFER_PERF_CACHE_LIMIT);

export function calculateTransformationsForLine(line: string): Transformation[] {
  const cached = transformationsCache.get(line);
  if (cached) {
    return cached;
  }

  const transformations: Transformation[] = [];

  // 1. Detect image paths
  imagePathRegex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = imagePathRegex.exec(line)) !== null) {
    const logicalText = match[0];
    const logStart = cpLen(line.substring(0, match.index));
    const logEnd = logStart + cpLen(logicalText);

    transformations.push({
      logStart,
      logEnd,
      logicalText,
      collapsedText: getTransformedImagePath(logicalText),
      type: 'image',
    });
  }

  // 2. Detect paste placeholders
  const pasteRegex = new RegExp(PASTED_TEXT_PLACEHOLDER_REGEX);
  while ((match = pasteRegex.exec(line)) !== null) {
    const logicalText = match[0];
    const logStart = cpLen(line.substring(0, match.index));
    const logEnd = logStart + cpLen(logicalText);

    transformations.push({
      logStart,
      logEnd,
      logicalText,
      collapsedText: logicalText,
      type: 'paste',
      id: logicalText,
    });
  }

  // Sort transformations by logStart to maintain consistency
  transformations.sort((a, b) => a.logStart - b.logStart);

  transformationsCache.set(line, transformations);

  return transformations;
}

export function calculateTransformations(lines: string[]): Transformation[][] {
  return lines.map((ln) => calculateTransformationsForLine(ln));
}

export function getTransformUnderCursor(
  row: number,
  col: number,
  spansByLine: Transformation[][],
  options: { includeEdge?: boolean } = {},
): Transformation | null {
  const spans = spansByLine.at(row);
  if (!spans || spans.length === 0) return null;
  for (const span of spans) {
    if (col >= span.logStart && (options.includeEdge ? col <= span.logEnd : col < span.logEnd)) {
      return span;
    }
    if (col < span.logStart) break;
  }
  return null;
}

export interface ExpandedPasteInfo {
  id: string;
  startLine: number;
  lineCount: number;
  prefix: string;
  suffix: string;
}

/**
 * Check if a line index falls within an expanded paste region.
 * Returns the paste placeholder ID if found, null otherwise.
 */
export function getExpandedPasteAtLine(
  lineIndex: number,
  expandedPaste: ExpandedPasteInfo | null,
): string | null {
  if (
    expandedPaste &&
    lineIndex >= expandedPaste.startLine &&
    lineIndex < expandedPaste.startLine + expandedPaste.lineCount
  ) {
    return expandedPaste.id;
  }
  return null;
}

/**
 * Surgery for expanded paste regions when lines are added or removed.
 * Adjusts startLine indices and detaches any region that is partially or fully deleted.
 */
export function shiftExpandedRegions(
  expandedPaste: ExpandedPasteInfo | null,
  changeStartLine: number,
  lineDelta: number,
  changeEndLine?: number, // Inclusive
): {
  newInfo: ExpandedPasteInfo | null;
  isDetached: boolean;
} {
  if (!expandedPaste) return { newInfo: null, isDetached: false };

  const effectiveEndLine = changeEndLine ?? changeStartLine;
  const infoEndLine = expandedPaste.startLine + expandedPaste.lineCount - 1;

  // 1. Check for overlap/intersection with the changed range
  const isOverlapping =
    changeStartLine <= infoEndLine && effectiveEndLine >= expandedPaste.startLine;

  if (isOverlapping) {
    // If the change is a deletion (lineDelta < 0) that touches this region, we detach.
    // If it's an insertion, we only detach if it's a multi-line insertion (lineDelta > 0)
    // that isn't at the very start of the region (which would shift it).
    // Regular character typing (lineDelta === 0) does NOT detach.
    if (
      lineDelta < 0 ||
      (lineDelta > 0 && changeStartLine > expandedPaste.startLine && changeStartLine <= infoEndLine)
    ) {
      return { newInfo: null, isDetached: true };
    }
  }

  // 2. Shift regions that start at or after the change point
  if (expandedPaste.startLine >= changeStartLine) {
    return {
      newInfo: {
        ...expandedPaste,
        startLine: expandedPaste.startLine + lineDelta,
      },
      isDetached: false,
    };
  }

  return { newInfo: expandedPaste, isDetached: false };
}

/**
 * Detach any expanded paste region if the cursor is within it.
 * This converts the expanded content to regular text that can no longer be collapsed.
 * Returns the state unchanged if cursor is not in an expanded region.
 */
export function detachExpandedPaste(state: TextBufferState): TextBufferState {
  const expandedId = getExpandedPasteAtLine(state.cursorRow, state.expandedPaste);
  if (!expandedId) return state;

  const map = new Map(Object.entries(state.pastedContent));
  map.delete(expandedId);
  return {
    ...state,
    expandedPaste: null,
    pastedContent: Object.fromEntries(map),
  };
}

/**
 * Represents an atomic placeholder that should be deleted as a unit.
 * Extensible to support future placeholder types.
 */
interface AtomicPlaceholder {
  start: number; // Start position in logical text
  end: number; // End position in logical text
  type: 'paste' | 'image'; // Type for cleanup logic
  id?: string; // For paste placeholders: the pastedContent key
}

/**
 * Find atomic placeholder at cursor for backspace (cursor at end).
 * Checks all placeholder types in priority order.
 */
function findAtomicPlaceholderForBackspace(
  _line: string,
  cursorCol: number,
  transformations: Transformation[],
): AtomicPlaceholder | null {
  for (const transform of transformations) {
    if (cursorCol === transform.logEnd) {
      return {
        start: transform.logStart,
        end: transform.logEnd,
        type: transform.type,
        id: transform.id,
      };
    }
  }

  return null;
}

/**
 * Find atomic placeholder at cursor for delete (cursor at start).
 */
function findAtomicPlaceholderForDelete(
  _line: string,
  cursorCol: number,
  transformations: Transformation[],
): AtomicPlaceholder | null {
  for (const transform of transformations) {
    if (cursorCol === transform.logStart) {
      return {
        start: transform.logStart,
        end: transform.logEnd,
        type: transform.type,
        id: transform.id,
      };
    }
  }

  return null;
}

function appendTransformedSegment(
  transform: Transformation,
  isExpanded: boolean,
  transformedLine: string,
  transformedToLogMap: number[],
) {
  const transformedText = isExpanded ? transform.logicalText : transform.collapsedText;
  const transformedLen = cpLen(transformedText);
  if (isExpanded) {
    for (let i = 0; i < transformedLen; i++) {
      transformedToLogMap.push(transform.logStart + i);
    }
  } else {
    const logicalLength = Math.max(0, transform.logEnd - transform.logStart);
    for (let i = 0; i < transformedLen; i++) {
      const offset = logicalLength === 0 ? 0 : Math.floor((i * logicalLength) / transformedLen);
      const index = transform.logStart + Math.min(offset, Math.max(logicalLength - 1, 0));
      transformedToLogMap.push(index);
    }
  }
  return transformedLine + transformedText;
}

export function calculateTransformedLine(
  logLine: string,
  logIndex: number,
  logicalCursor: [number, number],
  transformations: Transformation[],
): { transformedLine: string; transformedToLogMap: number[] } {
  let transformedLine = '';
  const transformedToLogMap: number[] = [];
  let lastLogPos = 0;

  const cursorIsOnThisLine = logIndex === logicalCursor[0];
  const cursorCol = logicalCursor[1];

  for (const transform of transformations) {
    const textBefore = cpSlice(logLine, lastLogPos, transform.logStart);
    transformedLine += textBefore;
    for (let i = 0; i < cpLen(textBefore); i++) {
      transformedToLogMap.push(lastLogPos + i);
    }

    const isExpanded =
      transform.type === 'image' &&
      cursorIsOnThisLine &&
      cursorCol >= transform.logStart &&
      cursorCol <= transform.logEnd;
    transformedLine = appendTransformedSegment(
      transform,
      isExpanded,
      transformedLine,
      transformedToLogMap,
    );
    lastLogPos = transform.logEnd;
  }

  const textAfter = cpSlice(logLine, lastLogPos);
  transformedLine += textAfter;
  for (let i = 0; i < cpLen(textAfter); i++) {
    transformedToLogMap.push(lastLogPos + i);
  }
  // For a cursor at the very end of the transformed line
  transformedToLogMap.push(cpLen(logLine));

  return { transformedLine, transformedToLogMap };
}

export interface VisualLayout {
  visualLines: string[];
  // For each logical line, an array of [visualLineIndex, startColInLogical]
  logicalToVisualMap: Array<Array<[number, number]>>;
  // For each visual line, its [logicalLineIndex, startColInLogical]
  visualToLogicalMap: Array<[number, number]>;
  // Image paths are transformed (e.g., "@some/path/to/an/image.png" to "[Image image.png]")
  // For each logical line, an array that maps each transformedCol to a logicalCol
  transformedToLogicalMaps: number[][];
  // For each visual line, its [startColInTransformed]
  visualToTransformedMap: number[];
}

// Caches for layout calculation
interface LineLayoutResult {
  visualLines: string[];
  logicalToVisualMap: Array<[number, number]>;
  visualToLogicalMap: Array<[number, number]>;
  transformedToLogMap: number[];
  visualToTransformedMap: number[];
}

const lineLayoutCache = new LRUCache<string, LineLayoutResult>(LRU_BUFFER_PERF_CACHE_LIMIT);

function getLineLayoutCacheKey(
  line: string,
  viewportWidth: number,
  isCursorOnLine: boolean,
  cursorCol: number,
): string {
  // Most lines (99.9% in a large buffer) are not cursor lines.
  // We use a simpler key for them to reduce string allocation overhead.
  if (!isCursorOnLine) {
    return `${viewportWidth}:N:${line}`;
  }
  return `${viewportWidth}:C:${cursorCol}:${line}`;
}

function buildChunkForWrap(
  codePointsInLogLine: string[],
  currentPosInLogLine: number,
  viewportWidth: number,
): { currentChunk: string; numCodePointsInChunk: number } {
  let currentChunk = '';
  let currentChunkVisualWidth = 0;
  let numCodePointsInChunk = 0;
  let lastWordBreakPoint = -1;
  let numCodePointsAtLastWordBreak = 0;

  for (let i = currentPosInLogLine; i < codePointsInLogLine.length; i++) {
    const char = codePointsInLogLine.at(i) || '';
    const charVisualWidth = getCachedStringWidth(char);

    if (currentChunkVisualWidth + charVisualWidth > viewportWidth) {
      const hasValidWordBreak =
        lastWordBreakPoint !== -1 &&
        numCodePointsAtLastWordBreak > 0 &&
        currentPosInLogLine + numCodePointsAtLastWordBreak < i;

      if (hasValidWordBreak) {
        currentChunk = codePointsInLogLine
          .slice(currentPosInLogLine, currentPosInLogLine + numCodePointsAtLastWordBreak)
          .join('');
        numCodePointsInChunk = numCodePointsAtLastWordBreak;
      } else if (numCodePointsInChunk === 0 && charVisualWidth > viewportWidth) {
        currentChunk = char;
        numCodePointsInChunk = 1;
      }
      break;
    }

    currentChunk += char;
    currentChunkVisualWidth += charVisualWidth;
    numCodePointsInChunk++;

    if (char === ' ') {
      lastWordBreakPoint = i;
      numCodePointsAtLastWordBreak = numCodePointsInChunk - 1;
    }
  }

  if (numCodePointsInChunk === 0 && currentPosInLogLine < codePointsInLogLine.length) {
    currentChunk = codePointsInLogLine.at(currentPosInLogLine) || '';
    numCodePointsInChunk = 1;
  }

  return { currentChunk, numCodePointsInChunk };
}

function wrapLineCodePoints(
  codePointsInLogLine: string[],
  transformedToLogMap: number[],
  viewportWidth: number,
  logIndex: number,
) {
  const lineVisualLines: string[] = [];
  const lineLogicalToVisualMap: Array<[number, number]> = [];
  const lineVisualToLogicalMap: Array<[number, number]> = [];
  const lineVisualToTransformedMap: number[] = [];

  let currentPosInLogLine = 0;

  while (currentPosInLogLine < codePointsInLogLine.length) {
    const { currentChunk, numCodePointsInChunk } = buildChunkForWrap(
      codePointsInLogLine,
      currentPosInLogLine,
      viewportWidth,
    );

    const logicalStartCol = transformedToLogMap.at(currentPosInLogLine) ?? 0;
    lineLogicalToVisualMap.push([lineVisualLines.length, logicalStartCol]);
    lineVisualToLogicalMap.push([logIndex, logicalStartCol]);
    lineVisualToTransformedMap.push(currentPosInLogLine);
    lineVisualLines.push(currentChunk);

    const logicalStartOfThisChunk = currentPosInLogLine;
    currentPosInLogLine += numCodePointsInChunk;

    if (
      logicalStartOfThisChunk + numCodePointsInChunk < codePointsInLogLine.length &&
      currentPosInLogLine < codePointsInLogLine.length &&
      codePointsInLogLine.at(currentPosInLogLine) === ' '
    ) {
      currentPosInLogLine++;
    }
  }

  return {
    lineVisualLines,
    lineLogicalToVisualMap,
    lineVisualToLogicalMap,
    lineVisualToTransformedMap,
  };
}

// Calculates the visual wrapping of lines and the mapping between logical and visual coordinates.
// This is an expensive operation and should be memoized.
function calculateLayout(
  logicalLines: string[],
  viewportWidth: number,
  logicalCursor: [number, number],
): VisualLayout {
  const visualLines: string[] = [];
  const logicalToVisualMap: Array<Array<[number, number]>> = [];
  const visualToLogicalMap: Array<[number, number]> = [];
  const transformedToLogicalMaps: number[][] = [];
  const visualToTransformedMap: number[] = [];

  logicalLines.forEach((logLine, logIndex) => {
    logicalToVisualMap.splice(logIndex, 1, []);

    const isCursorOnLine = logIndex === logicalCursor[0];
    const cacheKey = getLineLayoutCacheKey(
      logLine,
      viewportWidth,
      isCursorOnLine,
      logicalCursor[1],
    );
    const cached = lineLayoutCache.get(cacheKey);

    if (cached) {
      const visualLineOffset = visualLines.length;
      visualLines.push(...cached.visualLines);
      cached.logicalToVisualMap.forEach(([relVisualIdx, logCol]) => {
        logicalToVisualMap.at(logIndex)?.push([visualLineOffset + relVisualIdx, logCol]);
      });
      cached.visualToLogicalMap.forEach(([, logCol]) => {
        visualToLogicalMap.push([logIndex, logCol]);
      });
      transformedToLogicalMaps.splice(logIndex, 1, cached.transformedToLogMap);
      visualToTransformedMap.push(...cached.visualToTransformedMap);
      return;
    }

    // Not in cache, calculate
    const transformations = calculateTransformationsForLine(logLine);
    const { transformedLine, transformedToLogMap } = calculateTransformedLine(
      logLine,
      logIndex,
      logicalCursor,
      transformations,
    );

    const lineVisualLines: string[] = [];
    const lineLogicalToVisualMap: Array<[number, number]> = [];
    const lineVisualToLogicalMap: Array<[number, number]> = [];
    const lineVisualToTransformedMap: number[] = [];

    if (transformedLine.length === 0) {
      // Handle empty logical line
      lineLogicalToVisualMap.push([0, 0]);
      lineVisualToLogicalMap.push([logIndex, 0]);
      lineVisualToTransformedMap.push(0);
      lineVisualLines.push('');
    } else {
      // Non-empty logical line
      const wrapResult = wrapLineCodePoints(
        toCodePoints(transformedLine),
        transformedToLogMap,
        viewportWidth,
        logIndex,
      );
      lineVisualLines.push(...wrapResult.lineVisualLines);
      lineLogicalToVisualMap.push(...wrapResult.lineLogicalToVisualMap);
      lineVisualToLogicalMap.push(...wrapResult.lineVisualToLogicalMap);
      lineVisualToTransformedMap.push(...wrapResult.lineVisualToTransformedMap);
    }

    // Cache the result for this line
    lineLayoutCache.set(cacheKey, {
      visualLines: lineVisualLines,
      logicalToVisualMap: lineLogicalToVisualMap,
      visualToLogicalMap: lineVisualToLogicalMap,
      transformedToLogMap,
      visualToTransformedMap: lineVisualToTransformedMap,
    });

    const visualLineOffset = visualLines.length;
    visualLines.push(...lineVisualLines);
    lineLogicalToVisualMap.forEach(([relVisualIdx, logCol]) => {
      logicalToVisualMap.at(logIndex)?.push([visualLineOffset + relVisualIdx, logCol]);
    });
    lineVisualToLogicalMap.forEach(([, logCol]) => {
      visualToLogicalMap.push([logIndex, logCol]);
    });
    transformedToLogicalMaps.splice(logIndex, 1, transformedToLogMap);
    visualToTransformedMap.push(...lineVisualToTransformedMap);
  });

  // If the entire logical text was empty, ensure there's one empty visual line.
  if (logicalLines.length === 0 || (logicalLines.length === 1 && logicalLines[0] === '')) {
    if (visualLines.length === 0) {
      visualLines.push('');
      if (!logicalToVisualMap[0]) logicalToVisualMap[0] = [];
      logicalToVisualMap[0].push([0, 0]);
      visualToLogicalMap.push([0, 0]);
      visualToTransformedMap.push(0);
    }
  }

  return {
    visualLines,
    logicalToVisualMap,
    visualToLogicalMap,
    transformedToLogicalMaps,
    visualToTransformedMap,
  };
}

// Calculates the visual cursor position based on a pre-calculated layout.
// This is a lightweight operation.
function calculateVisualCursorFromLayout(
  layout: VisualLayout,
  logicalCursor: [number, number],
): [number, number] {
  const { logicalToVisualMap, visualLines, transformedToLogicalMaps } = layout;
  const [logicalRow, logicalCol] = logicalCursor;

  const segmentsForLogicalLine = logicalToVisualMap.at(logicalRow);

  if (!segmentsForLogicalLine || segmentsForLogicalLine.length === 0) {
    // This can happen for an empty document.
    return [0, 0];
  }

  // Find the segment where the logical column fits.
  // The segments are sorted by startColInLogical.
  let targetSegmentIndex = segmentsForLogicalLine.findIndex(([, startColInLogical], index) => {
    const nextStartColInLogical =
      index + 1 < segmentsForLogicalLine.length
        ? (segmentsForLogicalLine.at(index + 1)?.[1] ?? Infinity)
        : Infinity;
    return logicalCol >= startColInLogical && logicalCol < nextStartColInLogical;
  });

  // If not found, it means the cursor is at the end of the logical line.
  if (targetSegmentIndex === -1) {
    if (logicalCol === 0) {
      targetSegmentIndex = 0;
    } else {
      targetSegmentIndex = segmentsForLogicalLine.length - 1;
    }
  }

  const [visualRow, startColInLogical] = segmentsForLogicalLine.at(targetSegmentIndex) ?? [0, 0];

  // Find the coordinates in transformed space in order to conver to visual
  const transformedToLogicalMap = transformedToLogicalMaps.at(logicalRow) ?? [];
  let transformedCol = 0;
  for (let i = 0; i < transformedToLogicalMap.length; i++) {
    if ((transformedToLogicalMap.at(i) ?? 0) > logicalCol) {
      transformedCol = Math.max(0, i - 1);
      break;
    }
    if (i === transformedToLogicalMap.length - 1) {
      transformedCol = transformedToLogicalMap.length - 1;
    }
  }
  let startColInTransformed = 0;
  while (
    startColInTransformed < transformedToLogicalMap.length &&
    (transformedToLogicalMap.at(startColInTransformed) ?? 0) < startColInLogical
  ) {
    startColInTransformed++;
  }
  const clampedTransformedCol = Math.min(
    transformedCol,
    Math.max(0, transformedToLogicalMap.length - 1),
  );
  const visualCol = clampedTransformedCol - startColInTransformed;
  const clampedVisualCol = Math.min(Math.max(visualCol, 0), cpLen(visualLines.at(visualRow) ?? ''));
  return [visualRow, clampedVisualCol];
}

// --- Start of reducer logic ---

export interface TextBufferState {
  lines: string[];
  cursorRow: number;
  cursorCol: number;
  transformationsByLine: Transformation[][];
  preferredCol: number | null; // This is the logical character offset in the visual line
  undoStack: UndoHistoryEntry[];
  redoStack: UndoHistoryEntry[];
  clipboard: string | null;
  selectionAnchor: [number, number] | null;
  viewportWidth: number;
  viewportHeight: number;
  visualLayout: VisualLayout;
  pastedContent: Record<string, string>;
  expandedPaste: ExpandedPasteInfo | null;
  yankRegister: { text: string; linewise: boolean } | null;
}

const historyLimit = 100;

export const pushUndo = (currentState: TextBufferState): TextBufferState => {
  const snapshot: UndoHistoryEntry = {
    lines: [...currentState.lines],
    cursorRow: currentState.cursorRow,
    cursorCol: currentState.cursorCol,
    pastedContent: { ...currentState.pastedContent },
    expandedPaste: currentState.expandedPaste ? { ...currentState.expandedPaste } : null,
  };
  const newStack = [...currentState.undoStack, snapshot];
  if (newStack.length > historyLimit) {
    newStack.shift();
  }
  return { ...currentState, undoStack: newStack, redoStack: [] };
};

function generatePastedTextId(
  content: string,
  lineCount: number,
  pastedContent: Record<string, string>,
): string {
  const base =
    lineCount > LARGE_PASTE_LINE_THRESHOLD
      ? `[Pasted Text: ${lineCount} lines]`
      : `[Pasted Text: ${content.length} chars]`;

  let id = base;
  let suffix = 2;
  while (new Map(Object.entries(pastedContent)).get(id)) {
    id = base.replace(/\]/gu, ` #${suffix}]`);
    suffix++;
  }
  return id;
}

function collectPlaceholderIdsFromLines(lines: string[]): Set<string> {
  const ids = new Set<string>();
  const pasteRegex = new RegExp(PASTED_TEXT_PLACEHOLDER_REGEX);
  for (const line of lines) {
    if (!line) continue;
    for (const match of line.matchAll(pasteRegex)) {
      const placeholderId = match[0];
      if (placeholderId) {
        ids.add(placeholderId);
      }
    }
  }
  return ids;
}

function pruneOrphanedPastedContent(
  pastedContent: Record<string, string>,
  expandedPasteId: string | null,
  beforeChangedLines: string[],
  allLines: string[],
): Record<string, string> {
  if (Object.keys(pastedContent).length === 0) return pastedContent;

  const beforeIds = collectPlaceholderIdsFromLines(beforeChangedLines);
  if (beforeIds.size === 0) return pastedContent;

  const afterIds = collectPlaceholderIdsFromLines(allLines);
  const removedIds = [...beforeIds].filter((id) => !afterIds.has(id) && id !== expandedPasteId);
  if (removedIds.length === 0) return pastedContent;

  const prunedMap = new Map(Object.entries(pastedContent));
  for (const id of removedIds) {
    prunedMap.delete(id);
  }
  return Object.fromEntries(prunedMap);
}

export type TextBufferAction =
  | { type: 'insert'; payload: string; isPaste?: boolean }
  | {
      type: 'set_text';
      payload: string;
      pushToUndo?: boolean;
      cursorPosition?: 'start' | 'end' | number;
    }
  | { type: 'add_pasted_content'; payload: { id: string; text: string } }
  | { type: 'backspace' }
  | {
      type: 'move';
      payload: {
        dir: Direction;
      };
    }
  | {
      type: 'set_cursor';
      payload: {
        cursorRow: number;
        cursorCol: number;
        preferredCol: number | null;
      };
    }
  | { type: 'delete' }
  | { type: 'delete_word_left' }
  | { type: 'delete_word_right' }
  | { type: 'kill_line_right' }
  | { type: 'kill_line_left' }
  | { type: 'undo' }
  | { type: 'redo' }
  | {
      type: 'replace_range';
      payload: {
        startRow: number;
        startCol: number;
        endRow: number;
        endCol: number;
        text: string;
      };
    }
  | { type: 'move_to_offset'; payload: { offset: number } }
  | { type: 'create_undo_snapshot' }
  | { type: 'set_viewport'; payload: { width: number; height: number } }
  | { type: 'vim_delete_word_forward'; payload: { count: number } }
  | { type: 'vim_delete_word_backward'; payload: { count: number } }
  | { type: 'vim_delete_word_end'; payload: { count: number } }
  | { type: 'vim_delete_big_word_forward'; payload: { count: number } }
  | { type: 'vim_delete_big_word_backward'; payload: { count: number } }
  | { type: 'vim_delete_big_word_end'; payload: { count: number } }
  | { type: 'vim_change_word_forward'; payload: { count: number } }
  | { type: 'vim_change_word_backward'; payload: { count: number } }
  | { type: 'vim_change_word_end'; payload: { count: number } }
  | { type: 'vim_change_big_word_forward'; payload: { count: number } }
  | { type: 'vim_change_big_word_backward'; payload: { count: number } }
  | { type: 'vim_change_big_word_end'; payload: { count: number } }
  | { type: 'vim_delete_line'; payload: { count: number } }
  | { type: 'vim_change_line'; payload: { count: number } }
  | { type: 'vim_delete_to_end_of_line'; payload: { count: number } }
  | { type: 'vim_delete_to_start_of_line'; payload?: { count: number } }
  | { type: 'vim_change_to_end_of_line'; payload: { count: number } }
  | {
      type: 'vim_change_movement';
      payload: { movement: 'h' | 'j' | 'k' | 'l'; count: number };
    }
  // New vim actions for stateless command handling
  | { type: 'vim_move_left'; payload: { count: number } }
  | { type: 'vim_move_right'; payload: { count: number } }
  | { type: 'vim_move_up'; payload: { count: number } }
  | { type: 'vim_move_down'; payload: { count: number } }
  | { type: 'vim_move_word_forward'; payload: { count: number } }
  | { type: 'vim_move_word_backward'; payload: { count: number } }
  | { type: 'vim_move_word_end'; payload: { count: number } }
  | { type: 'vim_move_big_word_forward'; payload: { count: number } }
  | { type: 'vim_move_big_word_backward'; payload: { count: number } }
  | { type: 'vim_move_big_word_end'; payload: { count: number } }
  | { type: 'vim_delete_char'; payload: { count: number } }
  | { type: 'vim_insert_at_cursor'; payload?: { count: number } }
  | { type: 'vim_append_at_cursor'; payload?: { count: number } }
  | { type: 'vim_open_line_below'; payload?: { count: number } }
  | { type: 'vim_open_line_above'; payload?: { count: number } }
  | { type: 'vim_append_at_line_end'; payload?: { count: number } }
  | { type: 'vim_insert_at_line_start'; payload?: { count: number } }
  | { type: 'vim_move_to_line_start'; payload?: { count: number } }
  | { type: 'vim_move_to_line_end'; payload?: { count: number } }
  | { type: 'vim_move_to_first_nonwhitespace'; payload?: { count: number } }
  | { type: 'vim_move_to_first_line'; payload?: { count: number } }
  | { type: 'vim_move_to_last_line'; payload?: { count: number } }
  | { type: 'vim_move_to_line'; payload: { lineNumber: number } }
  | { type: 'vim_escape_insert_mode'; payload?: { count: number } }
  | { type: 'vim_delete_to_first_nonwhitespace'; payload?: { count: number } }
  | { type: 'vim_change_to_start_of_line'; payload?: { count: number } }
  | { type: 'vim_change_to_first_nonwhitespace'; payload?: { count: number } }
  | { type: 'vim_delete_to_first_line'; payload: { count: number } }
  | { type: 'vim_delete_to_last_line'; payload: { count: number } }
  | { type: 'vim_delete_char_before'; payload: { count: number } }
  | { type: 'vim_toggle_case'; payload: { count: number } }
  | { type: 'vim_replace_char'; payload: { char: string; count: number } }
  | {
      type: 'vim_find_char_forward';
      payload: { char: string; count: number; till: boolean };
    }
  | {
      type: 'vim_find_char_backward';
      payload: { char: string; count: number; till: boolean };
    }
  | {
      type: 'vim_delete_to_char_forward';
      payload: { char: string; count: number; till: boolean };
    }
  | {
      type: 'vim_delete_to_char_backward';
      payload: { char: string; count: number; till: boolean };
    }
  | { type: 'vim_yank_line'; payload: { count: number } }
  | { type: 'vim_yank_word_forward'; payload: { count: number } }
  | { type: 'vim_yank_big_word_forward'; payload: { count: number } }
  | { type: 'vim_yank_word_end'; payload: { count: number } }
  | { type: 'vim_yank_big_word_end'; payload: { count: number } }
  | { type: 'vim_yank_to_end_of_line'; payload: { count: number } }
  | { type: 'vim_paste_after'; payload: { count: number } }
  | { type: 'vim_paste_before'; payload: { count: number } }
  | {
      type: 'toggle_paste_expansion';
      payload: { id: string; row: number; col: number };
    };

export interface TextBufferOptions {
  inputFilter?: (text: string) => string;
  singleLine?: boolean;
}

function handleInsertCase(
  state: TextBufferState,
  payload: string,
  isPaste: boolean | undefined,
  options: TextBufferOptions,
): TextBufferState {
  const nextState = detachExpandedPaste(pushUndo(state));
  const newLines = [...nextState.lines];
  let newCursorRow = nextState.cursorRow;
  let newCursorCol = nextState.cursorCol;
  const currentLineAt = (r: number) => newLines.at(r) ?? '';
  let insertPayload = payload;
  let newPastedContent = nextState.pastedContent;
  if (isPaste) {
    insertPayload = insertPayload.replace(/\r\n|\r/g, '\n');
    const lineCount = insertPayload.split('\n').length;
    if (
      lineCount > LARGE_PASTE_LINE_THRESHOLD ||
      insertPayload.length > LARGE_PASTE_CHAR_THRESHOLD
    ) {
      const id = generatePastedTextId(insertPayload, lineCount, newPastedContent);
      newPastedContent = { ...newPastedContent, [id]: insertPayload };
      insertPayload = id;
    }
  }
  if (options.singleLine) {
    insertPayload = insertPayload.replace(/[\r\n]/g, '');
  }
  if (options.inputFilter) {
    insertPayload = options.inputFilter(insertPayload);
  }
  if (insertPayload.length === 0) {
    return state;
  }
  const str = stripUnsafeCharacters(insertPayload.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
  const parts = str.split('\n');
  const lineContent = currentLineAt(newCursorRow);
  const before = cpSlice(lineContent, 0, newCursorCol);
  const after = cpSlice(lineContent, newCursorCol);
  let lineDelta = 0;
  if (parts.length > 1) {
    newLines.splice(newCursorRow, 1, before + parts[0]);
    const remainingParts = parts.slice(1);
    const lastPartOriginal = remainingParts.pop() ?? '';
    newLines.splice(newCursorRow + 1, 0, ...remainingParts);
    newLines.splice(newCursorRow + parts.length - 1, 0, lastPartOriginal + after);
    lineDelta = parts.length - 1;
    newCursorRow = newCursorRow + parts.length - 1;
    newCursorCol = cpLen(lastPartOriginal);
  } else {
    newLines.splice(newCursorRow, 1, before + parts[0] + after);
    newCursorCol = cpLen(before) + cpLen(parts[0]);
  }
  const { newInfo: newExpandedPaste, isDetached } = shiftExpandedRegions(
    nextState.expandedPaste,
    nextState.cursorRow,
    lineDelta,
  );
  if (isDetached && newExpandedPaste === null && nextState.expandedPaste) {
    delete newPastedContent[nextState.expandedPaste.id];
  }
  return {
    ...nextState,
    lines: newLines,
    cursorRow: newCursorRow,
    cursorCol: newCursorCol,
    preferredCol: null,
    pastedContent: newPastedContent,
    expandedPaste: newExpandedPaste,
  };
}

function handleBackspaceCase(state: TextBufferState): TextBufferState {
  const stateWithUndo = pushUndo(state);
  const currentState = detachExpandedPaste(stateWithUndo);
  const { cursorRow, cursorCol, lines, transformationsByLine } = currentState;
  if (cursorCol === 0 && cursorRow === 0) return currentState;
  const transformations = transformationsByLine.at(cursorRow) ?? [];
  const placeholder = findAtomicPlaceholderForBackspace(
    lines.at(cursorRow) ?? '',
    cursorCol,
    transformations,
  );
  if (placeholder) {
    const newLines = [...currentState.lines];
    const lineVal = newLines.at(cursorRow) ?? '';
    newLines.splice(
      cursorRow,
      1,
      cpSlice(lineVal, 0, placeholder.start) + cpSlice(lineVal, placeholder.end),
    );
    const newTransformations = [...currentState.transformationsByLine];
    newTransformations.splice(
      cursorRow,
      1,
      calculateTransformationsForLine(newLines.at(cursorRow) ?? ''),
    );
    let newPastedContent = currentState.pastedContent;
    if (placeholder.type === 'paste' && placeholder.id) {
      newPastedContent = { ...currentState.pastedContent };
      delete newPastedContent[placeholder.id];
    }
    return {
      ...currentState,
      lines: newLines,
      cursorCol: placeholder.start,
      preferredCol: null,
      transformationsByLine: newTransformations,
      pastedContent: newPastedContent,
    };
  }
  const newLines = [...currentState.lines];
  let newCursorRow = currentState.cursorRow;
  let newCursorCol = currentState.cursorCol;
  const currentLineAt = (r: number) => newLines.at(r) ?? '';
  let lineDelta = 0;
  if (newCursorCol > 0) {
    const lineContent = currentLineAt(newCursorRow);
    newLines.splice(
      newCursorRow,
      1,
      cpSlice(lineContent, 0, newCursorCol - 1) + cpSlice(lineContent, newCursorCol),
    );
    newCursorCol--;
  } else if (newCursorRow > 0) {
    const prevLineContent = currentLineAt(newCursorRow - 1);
    const currentLineContentVal = currentLineAt(newCursorRow);
    const newCol = cpLen(prevLineContent);
    newLines.splice(newCursorRow - 1, 1, prevLineContent + currentLineContentVal);
    newLines.splice(newCursorRow, 1);
    lineDelta = -1;
    newCursorRow--;
    newCursorCol = newCol;
  }
  const { newInfo: newExpandedPaste, isDetached } = shiftExpandedRegions(
    currentState.expandedPaste,
    currentState.cursorRow + lineDelta,
    lineDelta,
    currentState.cursorRow,
  );
  const newPastedContent = { ...currentState.pastedContent };
  if (isDetached && currentState.expandedPaste) {
    delete newPastedContent[currentState.expandedPaste.id];
  }
  return {
    ...currentState,
    lines: newLines,
    cursorRow: newCursorRow,
    cursorCol: newCursorCol,
    preferredCol: null,
    pastedContent: newPastedContent,
    expandedPaste: newExpandedPaste,
  };
}

function applyVisualDirectionHorizontal(
  dir: 'left' | 'right' | 'home' | 'end',
  row: number,
  col: number,
  visualLines: string[],
  currentVisLineLen: number,
): { row: number; col: number; preferredCol: number | null } {
  let newRow = row;
  let newCol = col;
  if (dir === 'left') {
    if (newCol > 0) newCol--;
    else if (newRow > 0) {
      newRow--;
      newCol = cpLen(visualLines.at(newRow) ?? '');
    }
  } else if (dir === 'right') {
    if (newCol < currentVisLineLen) newCol++;
    else if (newRow < visualLines.length - 1) {
      newRow++;
      newCol = 0;
    }
  } else if (dir === 'home') {
    newCol = 0;
  } else if (dir === 'end') {
    newCol = currentVisLineLen;
  }
  return { row: newRow, col: newCol, preferredCol: null };
}

function applyVisualDirectionVertical(
  dir: 'up' | 'down',
  row: number,
  col: number,
  preferredCol: number | null,
  visualLines: string[],
): { row: number; col: number; preferredCol: number | null } {
  let newRow = row;
  const pref = preferredCol === null ? col : preferredCol;
  if (dir === 'up' && newRow > 0) {
    newRow--;
  } else if (dir === 'down' && newRow < visualLines.length - 1) {
    newRow++;
  } else {
    return { row, col, preferredCol };
  }
  return {
    row: newRow,
    col: clamp(pref, 0, cpLen(visualLines.at(newRow) ?? '')),
    preferredCol: pref,
  };
}

function applyVisualDirection(
  dir: Direction,
  initialRow: number,
  initialCol: number,
  initialPreferredCol: number | null,
  visualLines: string[],
  currentVisLineLen: number,
): { row: number; col: number; preferredCol: number | null } | null {
  if (dir === 'left' || dir === 'right' || dir === 'home' || dir === 'end') {
    return applyVisualDirectionHorizontal(
      dir,
      initialRow,
      initialCol,
      visualLines,
      currentVisLineLen,
    );
  }
  if (dir === 'up' || dir === 'down') {
    return applyVisualDirectionVertical(
      dir,
      initialRow,
      initialCol,
      initialPreferredCol,
      visualLines,
    );
  }
  return null;
}

function calculateNewLogicalCursorAfterMove(
  visualLayout: VisualLayout,
  newVisualRow: number,
  newVisualCol: number,
  lines: string[],
): { cursorRow: number; cursorCol: number } | null {
  const visMapRow = visualLayout.visualToLogicalMap.at(newVisualRow);
  if (!visMapRow) return null;
  const [logRow, logicalStartCol] = visMapRow;
  const transformedToLogicalMap = visualLayout.transformedToLogicalMaps?.at(logRow) ?? [];

  let transformedStartCol = 0;
  while (
    transformedStartCol < transformedToLogicalMap.length &&
    (transformedToLogicalMap.at(transformedStartCol) ?? 0) < logicalStartCol
  ) {
    transformedStartCol++;
  }

  const clampedTransformedCol = Math.min(
    transformedStartCol + newVisualCol,
    Math.max(0, transformedToLogicalMap.length - 1),
  );

  const cursorCol =
    transformedToLogicalMap.at(clampedTransformedCol) ?? cpLen(lines.at(logRow) ?? '');
  return { cursorRow: logRow, cursorCol };
}

function handleMoveWordLeft(state: TextBufferState): TextBufferState {
  const { cursorRow, cursorCol, lines } = state;
  if (cursorCol === 0 && cursorRow === 0) return state;
  let newCursorRow = cursorRow;
  let newCursorCol: number;
  if (cursorCol === 0) {
    newCursorRow--;
    newCursorCol = cpLen(lines.at(newCursorRow) ?? '');
  } else {
    const lineContent = lines.at(cursorRow) ?? '';
    newCursorCol = findPrevWordBoundary(lineContent, cursorCol);
  }
  return { ...state, cursorRow: newCursorRow, cursorCol: newCursorCol, preferredCol: null };
}

function handleMoveWordRight(state: TextBufferState): TextBufferState {
  const { cursorRow, cursorCol, lines } = state;
  const lineContent = lines.at(cursorRow) ?? '';
  if (cursorRow === lines.length - 1 && cursorCol === cpLen(lineContent)) {
    return state;
  }
  let newCursorRow = cursorRow;
  let newCursorCol: number;
  const lineLen = cpLen(lineContent);
  if (cursorCol >= lineLen) {
    newCursorRow++;
    newCursorCol = 0;
  } else {
    newCursorCol = findNextWordBoundary(lineContent, cursorCol);
  }
  return { ...state, cursorRow: newCursorRow, cursorCol: newCursorCol, preferredCol: null };
}

function handleMoveCase(state: TextBufferState, dir: Direction): TextBufferState {
  const { cursorRow, cursorCol, lines, visualLayout, preferredCol } = state;
  if (
    dir === 'left' ||
    dir === 'right' ||
    dir === 'up' ||
    dir === 'down' ||
    dir === 'home' ||
    dir === 'end'
  ) {
    const visualCursor = calculateVisualCursorFromLayout(visualLayout, [cursorRow, cursorCol]);
    const { visualLines } = visualLayout;
    const currentVisLineLen = cpLen(visualLines.at(visualCursor[0]) ?? '');
    const result = applyVisualDirection(
      dir,
      visualCursor[0],
      visualCursor[1],
      preferredCol,
      visualLines,
      currentVisLineLen,
    );
    if (!result) return state;
    const { row: newVisualRow, col: newVisualCol, preferredCol: newPreferredCol } = result;
    const newLogical = calculateNewLogicalCursorAfterMove(
      visualLayout,
      newVisualRow,
      newVisualCol,
      lines,
    );
    if (newLogical) {
      return {
        ...state,
        cursorRow: newLogical.cursorRow,
        cursorCol: newLogical.cursorCol,
        preferredCol: newPreferredCol,
      };
    }
    return state;
  }

  if (dir === 'wordLeft') return handleMoveWordLeft(state);
  if (dir === 'wordRight') return handleMoveWordRight(state);
  return state;
}

function handleDeleteCase(state: TextBufferState): TextBufferState {
  const stateWithUndo = pushUndo(state);
  const currentState = detachExpandedPaste(stateWithUndo);
  const { cursorRow, cursorCol, lines, transformationsByLine } = currentState;
  const transformations = transformationsByLine.at(cursorRow) ?? [];
  const placeholder = findAtomicPlaceholderForDelete(
    lines.at(cursorRow) ?? '',
    cursorCol,
    transformations,
  );
  if (placeholder) {
    const newLines = [...currentState.lines];
    const lineVal = newLines.at(cursorRow) ?? '';
    newLines.splice(
      cursorRow,
      1,
      cpSlice(lineVal, 0, placeholder.start) + cpSlice(lineVal, placeholder.end),
    );
    const newTransformations = [...currentState.transformationsByLine];
    newTransformations.splice(
      cursorRow,
      1,
      calculateTransformationsForLine(newLines.at(cursorRow) ?? ''),
    );
    let newPastedContent = currentState.pastedContent;
    if (placeholder.type === 'paste' && placeholder.id) {
      newPastedContent = { ...currentState.pastedContent };
      delete newPastedContent[placeholder.id];
    }
    return {
      ...currentState,
      lines: newLines,
      preferredCol: null,
      transformationsByLine: newTransformations,
      pastedContent: newPastedContent,
    };
  }
  const lineContent = state.lines.at(cursorRow) ?? '';
  let lineDelta = 0;
  const newLines = [...currentState.lines];
  if (cursorCol < cpLen(state.lines.at(cursorRow) ?? '')) {
    newLines.splice(
      cursorRow,
      1,
      cpSlice(lineContent, 0, cursorCol) + cpSlice(lineContent, cursorCol + 1),
    );
  } else if (cursorRow < lines.length - 1) {
    const nextLineContent = state.lines.at(cursorRow + 1) ?? '';
    newLines.splice(cursorRow, 1, lineContent + nextLineContent);
    newLines.splice(cursorRow + 1, 1);
    lineDelta = -1;
  } else {
    return currentState;
  }
  const { newInfo: newExpandedPaste, isDetached } = shiftExpandedRegions(
    currentState.expandedPaste,
    currentState.cursorRow,
    lineDelta,
    currentState.cursorRow + (lineDelta < 0 ? 1 : 0),
  );
  const newPastedContent = { ...currentState.pastedContent };
  if (isDetached && currentState.expandedPaste) {
    delete newPastedContent[currentState.expandedPaste.id];
  }
  return {
    ...currentState,
    lines: newLines,
    preferredCol: null,
    pastedContent: newPastedContent,
    expandedPaste: newExpandedPaste,
  };
}

function handleDeleteWordLeftCase(state: TextBufferState): TextBufferState {
  const stateWithUndo = pushUndo(state);
  const currentState = detachExpandedPaste(stateWithUndo);
  const { cursorRow, cursorCol } = currentState;
  if (cursorCol === 0 && cursorRow === 0) return currentState;
  const newLines = [...currentState.lines];
  let newCursorRow = cursorRow;
  let newCursorCol = cursorCol;
  let beforeChangedLines: string[] = [];
  if (newCursorCol > 0) {
    const lineContent = state.lines.at(newCursorRow) ?? '';
    beforeChangedLines = [lineContent];
    const prevWordStart = findPrevWordStartInLine(lineContent, newCursorCol);
    const start = prevWordStart === null ? 0 : prevWordStart;
    newLines.splice(
      newCursorRow,
      1,
      cpSlice(lineContent, 0, start) + cpSlice(lineContent, newCursorCol),
    );
    newCursorCol = start;
  } else {
    const prevLineContent = state.lines.at(cursorRow - 1) ?? '';
    const currentLineContentVal = state.lines.at(cursorRow) ?? '';
    beforeChangedLines = [prevLineContent, currentLineContentVal];
    const newCol = cpLen(prevLineContent);
    newLines.splice(cursorRow - 1, 1, prevLineContent + currentLineContentVal);
    newLines.splice(cursorRow, 1);
    newCursorRow--;
    newCursorCol = newCol;
  }
  const newPastedContent = pruneOrphanedPastedContent(
    currentState.pastedContent,
    currentState.expandedPaste?.id ?? null,
    beforeChangedLines,
    newLines,
  );
  return {
    ...currentState,
    lines: newLines,
    cursorRow: newCursorRow,
    cursorCol: newCursorCol,
    preferredCol: null,
    pastedContent: newPastedContent,
  };
}

function handleDeleteWordRightCase(state: TextBufferState): TextBufferState {
  const stateWithUndo = pushUndo(state);
  const currentState = detachExpandedPaste(stateWithUndo);
  const { cursorRow, cursorCol, lines } = currentState;
  const lineContent = state.lines.at(cursorRow) ?? '';
  const lineLen = cpLen(lineContent);
  if (cursorCol >= lineLen && cursorRow === lines.length - 1) {
    return currentState;
  }
  const newLines = [...currentState.lines];
  let beforeChangedLines: string[] = [];
  if (cursorCol >= lineLen) {
    const nextLineContent = state.lines.at(cursorRow + 1) ?? '';
    beforeChangedLines = [lineContent, nextLineContent];
    newLines.splice(cursorRow, 1, lineContent + nextLineContent);
    newLines.splice(cursorRow + 1, 1);
  } else {
    beforeChangedLines = [lineContent];
    const nextWordStart = findNextWordStartInLine(lineContent, cursorCol);
    const end = nextWordStart === null ? lineLen : nextWordStart;
    newLines.splice(cursorRow, 1, cpSlice(lineContent, 0, cursorCol) + cpSlice(lineContent, end));
  }
  const newPastedContent = pruneOrphanedPastedContent(
    currentState.pastedContent,
    currentState.expandedPaste?.id ?? null,
    beforeChangedLines,
    newLines,
  );
  return { ...currentState, lines: newLines, preferredCol: null, pastedContent: newPastedContent };
}

function handleKillLineRightCase(state: TextBufferState): TextBufferState {
  const stateWithUndo = pushUndo(state);
  const currentState = detachExpandedPaste(stateWithUndo);
  const { cursorRow, cursorCol, lines } = currentState;
  const lineContent = state.lines.at(cursorRow) ?? '';
  if (cursorCol < cpLen(lineContent)) {
    const newLines = [...currentState.lines];
    newLines.splice(cursorRow, 1, cpSlice(lineContent, 0, cursorCol));
    const newPastedContent = pruneOrphanedPastedContent(
      currentState.pastedContent,
      currentState.expandedPaste?.id ?? null,
      [lineContent],
      newLines,
    );
    return {
      ...currentState,
      lines: newLines,
      preferredCol: null,
      pastedContent: newPastedContent,
    };
  } else if (cursorRow < lines.length - 1) {
    const nextLineContent = state.lines.at(cursorRow + 1) ?? '';
    const newLines = [...currentState.lines];
    newLines.splice(cursorRow, 1, lineContent + nextLineContent);
    newLines.splice(cursorRow + 1, 1);
    const newPastedContent = pruneOrphanedPastedContent(
      currentState.pastedContent,
      currentState.expandedPaste?.id ?? null,
      [lineContent, nextLineContent],
      newLines,
    );
    return {
      ...currentState,
      lines: newLines,
      preferredCol: null,
      pastedContent: newPastedContent,
    };
  }
  return currentState;
}

function handleKillLineLeftCase(state: TextBufferState): TextBufferState {
  const stateWithUndo = pushUndo(state);
  const currentState = detachExpandedPaste(stateWithUndo);
  const { cursorRow, cursorCol } = currentState;
  if (cursorCol > 0) {
    const lineContent = state.lines.at(cursorRow) ?? '';
    const newLines = [...currentState.lines];
    newLines.splice(cursorRow, 1, cpSlice(lineContent, cursorCol));
    const newPastedContent = pruneOrphanedPastedContent(
      currentState.pastedContent,
      currentState.expandedPaste?.id ?? null,
      [lineContent],
      newLines,
    );
    return {
      ...currentState,
      lines: newLines,
      cursorCol: 0,
      preferredCol: null,
      pastedContent: newPastedContent,
    };
  }
  return currentState;
}

function findPasteTransform(
  currentState: TextBufferState,
  targetRow: number,
  col: number,
  id: string,
): { lineIndex: number; placeholderStart: number } | null {
  const tryFindOnLine = (idx: number) => {
    const transforms = currentState.transformationsByLine.at(idx) ?? [];
    let transform = transforms.find(
      (t) => t.type === 'paste' && t.id === id && col >= t.logStart && col <= t.logEnd,
    );
    if (!transform) transform = transforms.find((t) => t.type === 'paste' && t.id === id);
    if (transform) return { lineIndex: idx, placeholderStart: transform.logStart };
    return null;
  };
  if (targetRow >= 0 && targetRow < currentState.lines.length) {
    const res = tryFindOnLine(targetRow);
    if (res) return res;
  }
  for (let i = 0; i < currentState.lines.length; i++) {
    const res = tryFindOnLine(i);
    if (res) return res;
  }
  return null;
}

function handleTogglePasteExpansionCase(
  state: TextBufferState,
  id: string,
  row: number,
  col: number,
): TextBufferState {
  const expandedPaste = state.expandedPaste;
  if (expandedPaste && expandedPaste.id === id) {
    return handleCollapseExpandedPaste(state, id);
  }
  let currentState = state;
  let targetRow = row;
  if (state.expandedPaste) {
    const existingInfo = state.expandedPaste;
    const lineDelta = 1 - existingInfo.lineCount;
    if (targetRow !== undefined && targetRow > existingInfo.startLine) {
      targetRow += lineDelta;
    }
    currentState = textBufferReducerLogic(state, {
      type: 'toggle_paste_expansion',
      payload: { id: existingInfo.id, row: existingInfo.startLine, col: 0 },
    });
    currentState.transformationsByLine = calculateTransformations(currentState.lines);
  }
  const content = new Map(Object.entries(currentState.pastedContent)).get(id);
  if (!content) return currentState;
  const foundPaste = findPasteTransform(currentState, targetRow, col, id);
  if (!foundPaste) return currentState;
  const { lineIndex, placeholderStart } = foundPaste;
  const nextState = pushUndo(currentState);
  const line = nextState.lines.at(lineIndex) ?? '';
  const prefix = cpSlice(line, 0, placeholderStart);
  const suffix = cpSlice(line, placeholderStart + cpLen(id));
  const contentLines = content.split('\n');
  const newLines = [...nextState.lines];
  let expandedLines: string[];
  if (contentLines.length === 1) {
    expandedLines = [prefix + contentLines[0] + suffix];
  } else {
    expandedLines = [
      prefix + contentLines[0],
      ...contentLines.slice(1, -1),
      contentLines[contentLines.length - 1] + suffix,
    ];
  }
  newLines.splice(lineIndex, 1, ...expandedLines);
  const newCursorRow = lineIndex + expandedLines.length - 1;
  const lastExpandedLine = expandedLines[expandedLines.length - 1];
  const newCursorCol = cpLen(lastExpandedLine) - cpLen(suffix);
  return {
    ...nextState,
    lines: newLines,
    cursorRow: newCursorRow,
    cursorCol: newCursorCol,
    preferredCol: null,
    expandedPaste: { id, startLine: lineIndex, lineCount: expandedLines.length, prefix, suffix },
  };
}

function handleSetTextCase(
  state: TextBufferState,
  payload: string,
  pushToUndo: boolean | undefined,
  cursorPosition: 'start' | 'end' | number | undefined,
): TextBufferState {
  let nextState = state;
  if (pushToUndo !== false) {
    nextState = pushUndo(state);
  }
  const newContentLines = payload.replace(/\r\n?/g, '\n').split('\n');
  const lines = newContentLines.length === 0 ? [''] : newContentLines;
  let newCursorRow: number;
  let newCursorCol: number;
  if (typeof cursorPosition === 'number') {
    [newCursorRow, newCursorCol] = offsetToLogicalPos(payload, cursorPosition);
  } else if (cursorPosition === 'start') {
    newCursorRow = 0;
    newCursorCol = 0;
  } else {
    newCursorRow = lines.length - 1;
    newCursorCol = cpLen(lines.at(newCursorRow) ?? '');
  }
  return {
    ...nextState,
    lines,
    cursorRow: newCursorRow,
    cursorCol: newCursorCol,
    preferredCol: null,
    pastedContent: payload === '' ? {} : nextState.pastedContent,
  };
}

function handleReplaceRangeCase(
  state: TextBufferState,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
  text: string,
): TextBufferState {
  const nextState = pushUndo(state);
  const newState = replaceRangeInternal(nextState, startRow, startCol, endRow, endCol, text);
  const oldLineCount = endRow - startRow + 1;
  const newLineCount = newState.lines.length - (nextState.lines.length - oldLineCount);
  const lineDelta = newLineCount - oldLineCount;
  const { newInfo: newExpandedPaste, isDetached } = shiftExpandedRegions(
    nextState.expandedPaste,
    startRow,
    lineDelta,
    endRow,
  );
  const newPastedContent = { ...newState.pastedContent };
  if (isDetached && nextState.expandedPaste) {
    delete newPastedContent[nextState.expandedPaste.id];
  }
  return { ...newState, pastedContent: newPastedContent, expandedPaste: newExpandedPaste };
}

function textBufferReducerLogic(
  state: TextBufferState,
  action: TextBufferAction,
  options: TextBufferOptions = {},
): TextBufferState {
  switch (action.type) {
    case 'set_text':
      return handleSetTextCase(state, action.payload, action.pushToUndo, action.cursorPosition);

    case 'insert':
      return handleInsertCase(state, action.payload, action.isPaste, options);

    case 'add_pasted_content': {
      const { id, text } = action.payload;
      return {
        ...state,
        pastedContent: {
          ...state.pastedContent,
          [id]: text,
        },
      };
    }

    case 'backspace':
      return handleBackspaceCase(state);

    case 'set_viewport': {
      const { width, height } = action.payload;
      if (width === state.viewportWidth && height === state.viewportHeight) {
        return state;
      }
      return {
        ...state,
        viewportWidth: width,
        viewportHeight: height,
      };
    }

    case 'move':
      return handleMoveCase(state, action.payload.dir);

    case 'set_cursor': {
      return {
        ...state,
        ...action.payload,
      };
    }

    case 'delete':
      return handleDeleteCase(state);

    case 'delete_word_left':
      return handleDeleteWordLeftCase(state);

    case 'delete_word_right':
      return handleDeleteWordRightCase(state);

    case 'kill_line_right':
      return handleKillLineRightCase(state);

    case 'kill_line_left':
      return handleKillLineLeftCase(state);

    case 'undo': {
      const stateToRestore = state.undoStack[state.undoStack.length - 1];
      if (!stateToRestore) return state;

      const currentSnapshot: UndoHistoryEntry = {
        lines: [...state.lines],
        cursorRow: state.cursorRow,
        cursorCol: state.cursorCol,
        pastedContent: { ...state.pastedContent },
        expandedPaste: state.expandedPaste ? { ...state.expandedPaste } : null,
      };
      return {
        ...state,
        ...stateToRestore,
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, currentSnapshot],
      };
    }

    case 'redo': {
      const stateToRestore = state.redoStack[state.redoStack.length - 1];
      if (!stateToRestore) return state;

      const currentSnapshot: UndoHistoryEntry = {
        lines: [...state.lines],
        cursorRow: state.cursorRow,
        cursorCol: state.cursorCol,
        pastedContent: { ...state.pastedContent },
        expandedPaste: state.expandedPaste ? { ...state.expandedPaste } : null,
      };
      return {
        ...state,
        ...stateToRestore,
        redoStack: state.redoStack.slice(0, -1),
        undoStack: [...state.undoStack, currentSnapshot],
      };
    }

    case 'replace_range':
      return handleReplaceRangeCase(
        state,
        action.payload.startRow,
        action.payload.startCol,
        action.payload.endRow,
        action.payload.endCol,
        action.payload.text,
      );

    case 'move_to_offset': {
      const { offset } = action.payload;
      const [newRow, newCol] = offsetToLogicalPos(state.lines.join('\n'), offset);
      return {
        ...state,
        cursorRow: newRow,
        cursorCol: newCol,
        preferredCol: null,
      };
    }

    case 'create_undo_snapshot': {
      return pushUndo(state);
    }

    case 'toggle_paste_expansion':
      return handleTogglePasteExpansionCase(
        state,
        action.payload.id,
        action.payload.row,
        action.payload.col,
      );

    default: {
      if ((action.type as string).startsWith('vim_')) {
        return handleVimAction(state, action as VimAction);
      }
      const exhaustiveCheck = action as unknown;
      debugLogger.error(`Unknown action encountered: ${exhaustiveCheck}`);
      return state;
    }
  }
}

export function textBufferReducer(
  state: TextBufferState,
  action: TextBufferAction,
  options: TextBufferOptions = {},
): TextBufferState {
  const newState = textBufferReducerLogic(state, action, options);

  const newTransformedLines =
    newState.lines !== state.lines
      ? calculateTransformations(newState.lines)
      : state.transformationsByLine;

  const oldTransform = getTransformUnderCursor(
    state.cursorRow,
    state.cursorCol,
    state.transformationsByLine,
  );
  const newTransform = getTransformUnderCursor(
    newState.cursorRow,
    newState.cursorCol,
    newTransformedLines,
  );
  const oldInside = oldTransform !== null;
  const newInside = newTransform !== null;
  const movedBetweenTransforms =
    oldTransform !== newTransform && (oldTransform !== null || newTransform !== null);

  if (
    newState.lines !== state.lines ||
    newState.viewportWidth !== state.viewportWidth ||
    oldInside !== newInside ||
    movedBetweenTransforms
  ) {
    const shouldResetPreferred = oldInside !== newInside || movedBetweenTransforms;

    return {
      ...newState,
      preferredCol: shouldResetPreferred ? null : newState.preferredCol,
      visualLayout: calculateLayout(newState.lines, newState.viewportWidth, [
        newState.cursorRow,
        newState.cursorCol,
      ]),
      transformationsByLine: newTransformedLines,
    };
  }

  return newState;
}

// --- End of reducer logic ---

function tryHandleBoundedInputCommand(
  key: Key,
  keyMatchers: Record<Command, (k: Key) => boolean>,
  lines: string[],
  cursorRow: number,
  cursorCol: number,
  undoStackLength: number,
  redoStackLength: number,
  moveFn: (dir: Direction) => void,
  delFn: () => void,
  undoFn: () => void,
  redoFn: () => void,
): boolean | null {
  if (keyMatchers[Command.MOVE_RIGHT](key)) {
    const lastLineIdx = lines.length - 1;
    if (cursorRow === lastLineIdx && cursorCol === cpLen(lines.at(lastLineIdx) ?? '')) {
      return false;
    }
    moveFn('right');
    return true;
  }
  if (keyMatchers[Command.DELETE_CHAR_RIGHT](key)) {
    const lastLineIdx = lines.length - 1;
    if (cursorRow === lastLineIdx && cursorCol === cpLen(lines.at(lastLineIdx) ?? '')) {
      return false;
    }
    delFn();
    return true;
  }
  if (keyMatchers[Command.UNDO](key)) {
    if (undoStackLength === 0) {
      return false;
    }
    undoFn();
    return true;
  }
  if (keyMatchers[Command.REDO](key)) {
    if (redoStackLength === 0) {
      return false;
    }
    redoFn();
    return true;
  }
  return null;
}

function useVimDeleteActions(dispatch: React.Dispatch<TextBufferAction>) {
  return useMemo(
    () => ({
      vimDeleteWordForward: (count: number = 1): void => {
        dispatch({ type: 'vim_delete_word_forward', payload: { count } });
      },
      vimDeleteWordBackward: (count: number = 1): void => {
        dispatch({ type: 'vim_delete_word_backward', payload: { count } });
      },
      vimDeleteWordEnd: (count: number = 1): void => {
        dispatch({ type: 'vim_delete_word_end', payload: { count } });
      },
      vimDeleteBigWordForward: (count: number = 1): void => {
        dispatch({ type: 'vim_delete_big_word_forward', payload: { count } });
      },
      vimDeleteBigWordBackward: (count: number = 1): void => {
        dispatch({ type: 'vim_delete_big_word_backward', payload: { count } });
      },
      vimDeleteBigWordEnd: (count: number = 1): void => {
        dispatch({ type: 'vim_delete_big_word_end', payload: { count } });
      },
      vimChangeWordForward: (count: number = 1): void => {
        dispatch({ type: 'vim_change_word_forward', payload: { count } });
      },
      vimChangeWordBackward: (count: number = 1): void => {
        dispatch({ type: 'vim_change_word_backward', payload: { count } });
      },
      vimChangeWordEnd: (count: number = 1): void => {
        dispatch({ type: 'vim_change_word_end', payload: { count } });
      },
      vimChangeBigWordForward: (count: number = 1): void => {
        dispatch({ type: 'vim_change_big_word_forward', payload: { count } });
      },
      vimChangeBigWordBackward: (count: number = 1): void => {
        dispatch({ type: 'vim_change_big_word_backward', payload: { count } });
      },
      vimChangeBigWordEnd: (count: number = 1): void => {
        dispatch({ type: 'vim_change_big_word_end', payload: { count } });
      },
      vimDeleteLine: (count: number = 1): void => {
        dispatch({ type: 'vim_delete_line', payload: { count } });
      },
      vimChangeLine: (count: number = 1): void => {
        dispatch({ type: 'vim_change_line', payload: { count } });
      },
      vimDeleteToEndOfLine: (count: number = 1): void => {
        dispatch({ type: 'vim_delete_to_end_of_line', payload: { count } });
      },
      vimDeleteToStartOfLine: (): void => {
        dispatch({ type: 'vim_delete_to_start_of_line' });
      },
      vimChangeToEndOfLine: (count: number = 1): void => {
        dispatch({ type: 'vim_change_to_end_of_line', payload: { count } });
      },
      vimDeleteToFirstNonWhitespace: (): void => {
        dispatch({ type: 'vim_delete_to_first_nonwhitespace' });
      },
      vimChangeToStartOfLine: (): void => {
        dispatch({ type: 'vim_change_to_start_of_line' });
      },
      vimChangeToFirstNonWhitespace: (): void => {
        dispatch({ type: 'vim_change_to_first_nonwhitespace' });
      },
      vimDeleteToFirstLine: (count: number = 1): void => {
        dispatch({ type: 'vim_delete_to_first_line', payload: { count } });
      },
      vimDeleteToLastLine: (count: number = 1): void => {
        dispatch({ type: 'vim_delete_to_last_line', payload: { count } });
      },
      vimChangeMovement: (movement: 'h' | 'j' | 'k' | 'l', count: number): void => {
        dispatch({ type: 'vim_change_movement', payload: { movement, count } });
      },
      vimDeleteChar: (count: number = 1): void => {
        dispatch({ type: 'vim_delete_char', payload: { count } });
      },
      vimDeleteCharBefore: (count: number = 1): void => {
        dispatch({ type: 'vim_delete_char_before', payload: { count } });
      },
      vimToggleCase: (count: number = 1): void => {
        dispatch({ type: 'vim_toggle_case', payload: { count } });
      },
      vimReplaceChar: (char: string, count: number): void => {
        dispatch({ type: 'vim_replace_char', payload: { char, count } });
      },
      vimFindCharForward: (char: string, count: number, till: boolean): void => {
        dispatch({ type: 'vim_find_char_forward', payload: { char, count, till } });
      },
      vimFindCharBackward: (char: string, count: number, till: boolean): void => {
        dispatch({ type: 'vim_find_char_backward', payload: { char, count, till } });
      },
      vimDeleteToCharForward: (char: string, count: number, till: boolean): void => {
        dispatch({ type: 'vim_delete_to_char_forward', payload: { char, count, till } });
      },
      vimDeleteToCharBackward: (char: string, count: number, till: boolean): void => {
        dispatch({ type: 'vim_delete_to_char_backward', payload: { char, count, till } });
      },
    }),
    [dispatch],
  );
}

function useVimNavigationActions(dispatch: React.Dispatch<TextBufferAction>) {
  const vimMoveLeft = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_move_left', payload: { count } });
    },
    [dispatch],
  );

  const vimMoveRight = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_move_right', payload: { count } });
    },
    [dispatch],
  );

  const vimMoveUp = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_move_up', payload: { count } });
    },
    [dispatch],
  );

  const vimMoveDown = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_move_down', payload: { count } });
    },
    [dispatch],
  );

  const vimMoveWordForward = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_move_word_forward', payload: { count } });
    },
    [dispatch],
  );

  const vimMoveWordBackward = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_move_word_backward', payload: { count } });
    },
    [dispatch],
  );

  const vimMoveWordEnd = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_move_word_end', payload: { count } });
    },
    [dispatch],
  );

  const vimMoveBigWordForward = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_move_big_word_forward', payload: { count } });
    },
    [dispatch],
  );

  const vimMoveBigWordBackward = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_move_big_word_backward', payload: { count } });
    },
    [dispatch],
  );

  const vimMoveBigWordEnd = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_move_big_word_end', payload: { count } });
    },
    [dispatch],
  );

  const vimInsertAtCursor = useCallback((): void => {
    dispatch({ type: 'vim_insert_at_cursor' });
  }, [dispatch]);

  const vimAppendAtCursor = useCallback((): void => {
    dispatch({ type: 'vim_append_at_cursor' });
  }, [dispatch]);

  const vimOpenLineBelow = useCallback((): void => {
    dispatch({ type: 'vim_open_line_below' });
  }, [dispatch]);

  const vimOpenLineAbove = useCallback((): void => {
    dispatch({ type: 'vim_open_line_above' });
  }, [dispatch]);

  const vimAppendAtLineEnd = useCallback((): void => {
    dispatch({ type: 'vim_append_at_line_end' });
  }, [dispatch]);

  const vimInsertAtLineStart = useCallback((): void => {
    dispatch({ type: 'vim_insert_at_line_start' });
  }, [dispatch]);

  const vimMoveToLineStart = useCallback((): void => {
    dispatch({ type: 'vim_move_to_line_start' });
  }, [dispatch]);

  const vimMoveToLineEnd = useCallback((): void => {
    dispatch({ type: 'vim_move_to_line_end' });
  }, [dispatch]);

  const vimMoveToFirstNonWhitespace = useCallback((): void => {
    dispatch({ type: 'vim_move_to_first_nonwhitespace' });
  }, [dispatch]);

  const vimMoveToFirstLine = useCallback((): void => {
    dispatch({ type: 'vim_move_to_first_line' });
  }, [dispatch]);

  const vimMoveToLastLine = useCallback((): void => {
    dispatch({ type: 'vim_move_to_last_line' });
  }, [dispatch]);

  const vimMoveToLine = useCallback(
    (lineNumber: number): void => {
      dispatch({ type: 'vim_move_to_line', payload: { lineNumber } });
    },
    [dispatch],
  );

  const vimEscapeInsertMode = useCallback((): void => {
    dispatch({ type: 'vim_escape_insert_mode' });
  }, [dispatch]);

  const vimYankLine = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_yank_line', payload: { count } });
    },
    [dispatch],
  );

  const vimYankWordForward = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_yank_word_forward', payload: { count } });
    },
    [dispatch],
  );

  const vimYankBigWordForward = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_yank_big_word_forward', payload: { count } });
    },
    [dispatch],
  );

  const vimYankWordEnd = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_yank_word_end', payload: { count } });
    },
    [dispatch],
  );

  const vimYankBigWordEnd = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_yank_big_word_end', payload: { count } });
    },
    [dispatch],
  );

  const vimYankToEndOfLine = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_yank_to_end_of_line', payload: { count } });
    },
    [dispatch],
  );

  const vimPasteAfter = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_paste_after', payload: { count } });
    },
    [dispatch],
  );

  const vimPasteBefore = useCallback(
    (count: number): void => {
      dispatch({ type: 'vim_paste_before', payload: { count } });
    },
    [dispatch],
  );

  return {
    vimMoveLeft,
    vimMoveRight,
    vimMoveUp,
    vimMoveDown,
    vimMoveWordForward,
    vimMoveWordBackward,
    vimMoveWordEnd,
    vimMoveBigWordForward,
    vimMoveBigWordBackward,
    vimMoveBigWordEnd,
    vimInsertAtCursor,
    vimAppendAtCursor,
    vimOpenLineBelow,
    vimOpenLineAbove,
    vimAppendAtLineEnd,
    vimInsertAtLineStart,
    vimMoveToLineStart,
    vimMoveToLineEnd,
    vimMoveToFirstNonWhitespace,
    vimMoveToFirstLine,
    vimMoveToLastLine,
    vimMoveToLine,
    vimEscapeInsertMode,
    vimYankLine,
    vimYankWordForward,
    vimYankBigWordForward,
    vimYankWordEnd,
    vimYankBigWordEnd,
    vimYankToEndOfLine,
    vimPasteAfter,
    vimPasteBefore,
  };
}

interface BasicActionsDeps {
  dispatch: React.Dispatch<TextBufferAction>;
  singleLine: boolean;
  shellModeActive: boolean;
  escapePastedPaths: boolean;
  expandedPaste: ExpandedPasteInfo | null;
  text: string;
  lines: string[];
  cursorRow: number;
  cursorCol: number;
}

function useBasicActions(d: BasicActionsDeps) {
  const insert = useCallback(
    (ch: string, { paste = false }: { paste?: boolean } = {}): void => {
      if (typeof ch !== 'string') return;
      let textToInsert = ch;
      const minLengthToInferAsDragDrop = 3;
      if (
        ch.length >= minLengthToInferAsDragDrop &&
        !d.shellModeActive &&
        paste &&
        d.escapePastedPaths
      ) {
        const processed = parsePastedPaths(ch.trim());
        if (processed) textToInsert = processed;
      }
      let currentText = '';
      for (const char of toCodePoints(textToInsert)) {
        if (char.codePointAt(0) === 127) {
          if (currentText.length > 0) {
            d.dispatch({ type: 'insert', payload: currentText, isPaste: paste });
            currentText = '';
          }
          d.dispatch({ type: 'backspace' });
        } else {
          currentText += char;
        }
      }
      if (currentText.length > 0)
        d.dispatch({ type: 'insert', payload: currentText, isPaste: paste });
    },
    [d],
  );
  const newline = useCallback((): void => {
    if (!d.singleLine) d.dispatch({ type: 'insert', payload: '\n' });
  }, [d]);
  const backspace = useCallback((): void => {
    d.dispatch({ type: 'backspace' });
  }, [d]);
  const del = useCallback((): void => {
    d.dispatch({ type: 'delete' });
  }, [d]);
  const move = useCallback(
    (dir: Direction): void => {
      d.dispatch({ type: 'move', payload: { dir } });
    },
    [d],
  );
  const undo = useCallback((): void => {
    d.dispatch({ type: 'undo' });
  }, [d]);
  const redo = useCallback((): void => {
    d.dispatch({ type: 'redo' });
  }, [d]);
  type CursorPosition = 'start' | 'end' | number;
  const setText = useCallback(
    (newText: string, cursorPosition?: CursorPosition): void => {
      d.dispatch({ type: 'set_text', payload: newText, cursorPosition });
    },
    [d],
  );
  const deleteWordLeft = useCallback((): void => {
    d.dispatch({ type: 'delete_word_left' });
  }, [d]);
  const deleteWordRight = useCallback((): void => {
    d.dispatch({ type: 'delete_word_right' });
  }, [d]);
  const killLineRight = useCallback((): void => {
    d.dispatch({ type: 'kill_line_right' });
  }, [d]);
  const killLineLeft = useCallback((): void => {
    d.dispatch({ type: 'kill_line_left' });
  }, [d]);
  const replaceRange = useCallback(
    (
      startRow: number,
      startCol: number,
      endRow: number,
      endCol: number,
      replacementText: string,
    ): void => {
      d.dispatch({
        type: 'replace_range',
        payload: { startRow, startCol, endRow, endCol, text: replacementText },
      });
    },
    [d],
  );
  const replaceRangeByOffset = useCallback(
    (startOffset: number, endOffset: number, replacementText: string): void => {
      const [sR, sC] = offsetToLogicalPos(d.text, startOffset);
      const [eR, eC] = offsetToLogicalPos(d.text, endOffset);
      replaceRange(sR, sC, eR, eC, replacementText);
    },
    [d.text, replaceRange],
  );
  const moveToOffset = useCallback(
    (offset: number): void => {
      d.dispatch({ type: 'move_to_offset', payload: { offset } });
    },
    [d],
  );
  const getOffset = useCallback(
    (): number => logicalPosToOffset(d.lines, d.cursorRow, d.cursorCol),
    [d],
  );
  const togglePasteExpansion = useCallback(
    (id: string, row: number, col: number): void => {
      d.dispatch({ type: 'toggle_paste_expansion', payload: { id, row, col } });
    },
    [d],
  );
  const getExpandedPasteAtLineCallback = useCallback(
    (lineIndex: number): string | null => getExpandedPasteAtLine(lineIndex, d.expandedPaste),
    [d.expandedPaste],
  );
  return {
    insert,
    newline,
    backspace,
    del,
    move,
    undo,
    redo,
    setText,
    deleteWordLeft,
    deleteWordRight,
    killLineRight,
    killLineLeft,
    replaceRange,
    replaceRangeByOffset,
    moveToOffset,
    getOffset,
    togglePasteExpansion,
    getExpandedPasteAtLineCallback,
  };
}

interface InputHandlerDeps {
  keyMatchers: Record<Command, (key: Key) => boolean>;
  lines: string[];
  cursorRow: number;
  cursorCol: number;
  singleLine: boolean;
  text: string;
  visualCursor: [number, number];
  visualLines: string[];
  undoStackLength: number;
  redoStackLength: number;
  insert: (ch: string, opts?: { paste?: boolean }) => void;
  newline: () => void;
  backspace: () => void;
  del: () => void;
  move: (dir: Direction) => void;
  undo: () => void;
  redo: () => void;
  setText: (text: string, cursorPosition?: 'start' | 'end' | number) => void;
  deleteWordLeft: () => void;
  deleteWordRight: () => void;
}

function useInputHandler(d: InputHandlerDeps): (key: Key) => boolean {
  return useCallback(
    (key: Key): boolean => {
      const boundedResult = tryHandleBoundedInputCommand(
        key,
        d.keyMatchers,
        d.lines,
        d.cursorRow,
        d.cursorCol,
        d.undoStackLength,
        d.redoStackLength,
        d.move,
        d.del,
        d.undo,
        d.redo,
      );
      if (boundedResult !== null) return boundedResult;
      const unboundedResult = tryHandleUnboundedInputCommand(key, d);
      if (unboundedResult !== null) return unboundedResult;
      return false;
    },
    [d],
  );
}

interface VisualPositioningDeps {
  visualLayout: VisualLayout;
  lines: string[];
  dispatch: React.Dispatch<TextBufferAction>;
}

function useVisualPositioning(d: VisualPositioningDeps) {
  const moveToVisualPosition = useCallback(
    (visRow: number, visCol: number): void => {
      const {
        visualLines: mvVisualLines,
        visualToLogicalMap: mvVisualToLogicalMap,
        transformedToLogicalMaps: mvTransformedToLogicalMaps,
        visualToTransformedMap: mvVisualToTransformedMap,
      } = d.visualLayout;
      const clampedVisRow = Math.max(0, Math.min(visRow, mvVisualLines.length - 1));
      const visualLine = mvVisualLines.at(clampedVisRow) || '';
      const visMapRow = mvVisualToLogicalMap.at(clampedVisRow);
      if (visMapRow) {
        const [logRow] = visMapRow;
        const transformedToLogicalMap = mvTransformedToLogicalMaps?.at(logRow) ?? [];
        const startColInTransformed = mvVisualToTransformedMap?.at(clampedVisRow) ?? 0;
        const codePoints = toCodePoints(visualLine);
        let currentVisX = 0;
        let charOffset = 0;
        for (const char of codePoints) {
          const charWidth = getCachedStringWidth(char);
          if (visCol < currentVisX + charWidth) {
            if (charWidth > 1 && visCol >= currentVisX + charWidth / 2) charOffset++;
            break;
          }
          currentVisX += charWidth;
          charOffset++;
        }
        charOffset = Math.min(charOffset, codePoints.length);
        const transformedCol = Math.min(
          startColInTransformed + charOffset,
          Math.max(0, transformedToLogicalMap.length - 1),
        );
        const newCursorCol =
          transformedToLogicalMap.at(transformedCol) ?? cpLen(d.lines.at(logRow) ?? '');
        d.dispatch({
          type: 'set_cursor',
          payload: { cursorRow: logRow, cursorCol: newCursorCol, preferredCol: charOffset },
        });
      }
    },
    [d],
  );
  const getLogicalPositionFromVisual = useCallback(
    (visRow: number, visCol: number): { row: number; col: number } | null => {
      const {
        visualLines: glpvVisualLines,
        visualToLogicalMap: glpvVisualToLogicalMap,
        transformedToLogicalMaps: glpvTransformedToLogicalMaps,
        visualToTransformedMap: glpvVisualToTransformedMap,
      } = d.visualLayout;
      const clampedVisRow = Math.max(0, Math.min(visRow, glpvVisualLines.length - 1));
      const visualLine = glpvVisualLines.at(clampedVisRow) || '';
      const visMapRow = glpvVisualToLogicalMap.at(clampedVisRow);
      if (!visMapRow) return null;
      const [logRow] = visMapRow;
      const transformedToLogicalMap = glpvTransformedToLogicalMaps?.at(logRow) ?? [];
      const startColInTransformed = glpvVisualToTransformedMap?.at(clampedVisRow) ?? 0;
      const codePoints = toCodePoints(visualLine);
      let currentVisX = 0;
      let charOffset = 0;
      for (const char of codePoints) {
        const charWidth = getCachedStringWidth(char);
        if (visCol < currentVisX + charWidth) {
          if (charWidth > 1 && visCol >= currentVisX + charWidth / 2) charOffset++;
          break;
        }
        currentVisX += charWidth;
        charOffset++;
      }
      charOffset = Math.min(charOffset, codePoints.length);
      const transformedCol = Math.min(
        startColInTransformed + charOffset,
        Math.max(0, transformedToLogicalMap.length - 1),
      );
      return {
        row: logRow,
        col: transformedToLogicalMap.at(transformedCol) ?? cpLen(d.lines.at(logRow) ?? ''),
      };
    },
    [d],
  );
  return { moveToVisualPosition, getLogicalPositionFromVisual };
}

interface ExternalEditorDeps {
  text: string;
  pastedContent: Record<string, string>;
  stdin?: NodeJS.ReadStream | null;
  setRawMode?: (mode: boolean) => void;
  getPreferredEditor?: () => EditorType | undefined;
  openEditorInNewWindow: boolean;
  dispatch: React.Dispatch<TextBufferAction>;
}

function useExternalEditor(d: ExternalEditorDeps): () => Promise<void> {
  return useCallback(async (): Promise<void> => {
    const tmpDir = safeMkdtempSync(pathMod.join(os.tmpdir(), 'hive-edit-'));
    const filePath = pathMod.join(tmpDir, 'buffer.txt');
    const expandedText = expandPastePlaceholders(d.text, d.pastedContent);
    safeWriteFileSync(filePath, expandedText, 'utf8');
    d.dispatch({ type: 'create_undo_snapshot' });
    try {
      await openFileInEditor(
        filePath,
        d.stdin,
        d.setRawMode,
        d.getPreferredEditor?.(),
        d.openEditorInNewWindow,
      );
      let newText = safeReadFileSync(filePath, 'utf8') as string;
      newText = newText.replace(/\r\n?/g, '\n');
      const sortedPlaceholders = Object.entries(d.pastedContent).sort(
        (a, b) => b[1].length - a[1].length,
      );
      for (const [id, content] of sortedPlaceholders) {
        if (newText.includes(content)) newText = newText.replace(content, id);
      }
      d.dispatch({ type: 'set_text', payload: newText, pushToUndo: false });
    } catch (err) {
      coreEvents.emitFeedback('error', getErrorMessage(err), err);
    } finally {
      try {
        safeUnlinkSync(filePath);
      } catch {
        /* ignore */
      }
      try {
        safeRmdirSync(tmpDir);
      } catch {
        /* ignore */
      }
    }
  }, [d]);
}

export function useTextBuffer({
  initialText = '',
  initialCursorOffset = 0,
  viewport,
  stdin,
  setRawMode,
  onChange,
  escapePastedPaths = false,
  shellModeActive = false,
  inputFilter,
  singleLine = false,
  getPreferredEditor,
}: UseTextBufferProps): TextBuffer {
  const settings = useSettings();
  const keyMatchers = useKeyMatchers();
  const initialState = useMemo((): TextBufferState => {
    const lines = initialText.split('\n');
    const [initialCursorRow, initialCursorCol] = calculateInitialCursorPosition(
      lines.length === 0 ? [''] : lines,
      initialCursorOffset,
    );
    const transformationsByLine = calculateTransformations(lines.length === 0 ? [''] : lines);
    const visualLayout = calculateLayout(lines.length === 0 ? [''] : lines, viewport.width, [
      initialCursorRow,
      initialCursorCol,
    ]);
    return {
      lines: lines.length === 0 ? [''] : lines,
      cursorRow: initialCursorRow,
      cursorCol: initialCursorCol,
      transformationsByLine,
      preferredCol: null,
      undoStack: [],
      redoStack: [],
      clipboard: null,
      selectionAnchor: null,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      visualLayout,
      pastedContent: {},
      expandedPaste: null,
      yankRegister: null,
    };
  }, [initialText, initialCursorOffset, viewport.width, viewport.height]);

  const [state, dispatch] = useReducer(
    (s: TextBufferState, a: TextBufferAction) =>
      textBufferReducer(s, a, { inputFilter, singleLine }),
    initialState,
  );
  const {
    lines,
    cursorRow,
    cursorCol,
    preferredCol,
    selectionAnchor,
    visualLayout,
    transformationsByLine,
    pastedContent,
    expandedPaste,
    undoStack,
    redoStack,
  } = state;

  const text = useMemo(() => lines.join('\n'), [lines]);
  const visualCursor = useMemo(
    () => calculateVisualCursorFromLayout(visualLayout, [cursorRow, cursorCol]),
    [visualLayout, cursorRow, cursorCol],
  );
  const { visualLines, visualToLogicalMap, transformedToLogicalMaps, visualToTransformedMap } =
    visualLayout;

  const [scrollRowState, setScrollRowState] = useState<number>(0);
  const { height } = viewport;
  const totalVisualLines = visualLines.length;
  const maxScrollStart = Math.max(0, totalVisualLines - height);
  let newVisualScrollRow = scrollRowState;
  if (visualCursor[0] < scrollRowState) {
    newVisualScrollRow = visualCursor[0];
  } else if (visualCursor[0] >= scrollRowState + height) {
    newVisualScrollRow = visualCursor[0] - height + 1;
  }
  newVisualScrollRow = clamp(newVisualScrollRow, 0, maxScrollStart);
  if (newVisualScrollRow !== scrollRowState) setScrollRowState(newVisualScrollRow);
  const actualScrollRowState = newVisualScrollRow;

  useEffect(() => {
    if (onChange) onChange(text);
  }, [text, onChange]);
  useEffect(() => {
    dispatch({ type: 'set_viewport', payload: { width: viewport.width, height: viewport.height } });
  }, [viewport.width, viewport.height]);

  const basicActions = useBasicActions({
    dispatch,
    singleLine,
    shellModeActive,
    escapePastedPaths,
    expandedPaste,
    text,
    lines,
    cursorRow,
    cursorCol,
  });
  const vimDeleteActions = useVimDeleteActions(dispatch);
  const vimNavigationActions = useVimNavigationActions(dispatch);
  const openInExternalEditor = useExternalEditor({
    text,
    pastedContent,
    stdin,
    setRawMode,
    getPreferredEditor,
    openEditorInNewWindow:
      ((settings.merged.general as Record<string, unknown>)?.openEditorInNewWindow as boolean) ??
      false,
    dispatch,
  });
  const handleInput = useInputHandler({
    keyMatchers,
    lines,
    cursorRow,
    cursorCol,
    singleLine,
    text,
    visualCursor,
    visualLines,
    undoStackLength: undoStack.length,
    redoStackLength: redoStack.length,
    ...basicActions,
  });
  const { moveToVisualPosition, getLogicalPositionFromVisual } = useVisualPositioning({
    visualLayout,
    lines,
    dispatch,
  });

  const visualScrollRow = useMemo(
    () => Math.min(actualScrollRowState, Math.max(0, visualLines.length - viewport.height)),
    [visualLines.length, actualScrollRowState, viewport.height],
  );
  const renderedVisualLines = useMemo(
    () => visualLines.slice(visualScrollRow, visualScrollRow + viewport.height),
    [visualLines, visualScrollRow, viewport.height],
  );

  const returnValue: TextBuffer = useMemo(
    () => ({
      lines,
      text,
      cursor: [cursorRow, cursorCol],
      preferredCol,
      selectionAnchor,
      pastedContent,
      allVisualLines: visualLines,
      viewportVisualLines: renderedVisualLines,
      visualCursor,
      visualScrollRow,
      viewportHeight: viewport.height,
      visualToLogicalMap,
      transformedToLogicalMaps,
      visualToTransformedMap,
      transformationsByLine,
      visualLayout,
      ...basicActions,
      moveToVisualPosition,
      getLogicalPositionFromVisual,
      getExpandedPasteAtLine: basicActions.getExpandedPasteAtLineCallback,
      togglePasteExpansion: basicActions.togglePasteExpansion,
      expandedPaste,
      handleInput,
      openInExternalEditor,
      ...vimDeleteActions,
      ...vimNavigationActions,
    }),
    [
      lines,
      text,
      cursorRow,
      cursorCol,
      preferredCol,
      selectionAnchor,
      pastedContent,
      visualLines,
      renderedVisualLines,
      visualCursor,
      visualScrollRow,
      viewport.height,
      visualToLogicalMap,
      transformedToLogicalMaps,
      visualToTransformedMap,
      transformationsByLine,
      visualLayout,
      basicActions,
      moveToVisualPosition,
      getLogicalPositionFromVisual,
      expandedPaste,
      handleInput,
      openInExternalEditor,
      vimDeleteActions,
      vimNavigationActions,
    ],
  );
  return returnValue;
}

export interface TextBuffer {
  // State
  lines: string[]; // Logical lines
  text: string;
  cursor: [number, number]; // Logical cursor [row, col]
  /**
   * When the user moves the caret vertically we try to keep their original
   * horizontal column even when passing through shorter lines.  We remember
   * that *preferred* column in this field while the user is still travelling
   * vertically.  Any explicit horizontal movement resets the preference.
   */
  preferredCol: number | null; // Preferred visual column
  selectionAnchor: [number, number] | null; // Logical selection anchor
  pastedContent: Record<string, string>;

  // Visual state (handles wrapping)
  allVisualLines: string[]; // All visual lines for the current text and viewport width.
  viewportVisualLines: string[]; // The subset of visual lines to be rendered based on visualScrollRow and viewport.height
  visualCursor: [number, number]; // Visual cursor [row, col] relative to the start of all visualLines
  visualScrollRow: number; // Scroll position for visual lines (index of the first visible visual line)
  viewportHeight: number; // The maximum height of the viewport
  /**
   * For each visual line (by absolute index in allVisualLines) provides a tuple
   * [logicalLineIndex, startColInLogical] that maps where that visual line
   * begins within the logical buffer. Indices are code-point based.
   */
  visualToLogicalMap: Array<[number, number]>;
  /**
   * For each logical line, an array mapping transformed positions (in the transformed
   * line) back to logical column indices.
   */
  transformedToLogicalMaps: number[][];
  /**
   * For each visual line (absolute index across all visual lines), the start index
   * within that logical line's transformed content.
   */
  visualToTransformedMap: number[];
  /** Cached transformations per logical line */
  transformationsByLine: Transformation[][];
  visualLayout: VisualLayout;

  // Actions

  /**
   * Replaces the entire buffer content with the provided text.
   * The operation is undoable.
   */
  setText: (text: string, cursorPosition?: 'start' | 'end' | number) => void;
  /**
   * Insert a single character or string without newlines.
   */
  insert: (ch: string, opts?: { paste?: boolean }) => void;
  newline: () => void;
  backspace: () => void;
  del: () => void;
  move: (dir: Direction) => void;
  undo: () => void;
  redo: () => void;
  /**
   * Replaces the text within the specified range with new text.
   * Handles both single-line and multi-line ranges.
   *
   * @param startRow The starting row index (inclusive).
   * @param startCol The starting column index (inclusive, code-point based).
   * @param endRow The ending row index (inclusive).
   * @param endCol The ending column index (exclusive, code-point based).
   * @param text The new text to insert.
   * @returns True if the buffer was modified, false otherwise.
   */
  replaceRange: (
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
    text: string,
  ) => void;
  /**
   * Delete the word to the *left* of the caret, mirroring common
   * Ctrl/Alt+Backspace behaviour in editors & terminals. Both the adjacent
   * whitespace *and* the word characters immediately preceding the caret are
   * removed.  If the caret is already at column‑0 this becomes a no-op.
   */
  deleteWordLeft: () => void;
  /**
   * Delete the word to the *right* of the caret, akin to many editors'
   * Ctrl/Alt+Delete shortcut.  Removes any whitespace/punctuation that
   * follows the caret and the next contiguous run of word characters.
   */
  deleteWordRight: () => void;

  /**
   * Deletes text from the cursor to the end of the current line.
   */
  killLineRight: () => void;
  /**
   * Deletes text from the start of the current line to the cursor.
   */
  killLineLeft: () => void;
  /**
   * High level "handleInput" – receives what Ink gives us.
   */
  handleInput: (key: Key) => boolean;
  /**
   * Opens the current buffer contents in the user's preferred terminal text
   * editor ($VISUAL or $EDITOR, falling back to "vi").  The method blocks
   * until the editor exits, then reloads the file and replaces the in‑memory
   * buffer with whatever the user saved.
   *
   * The operation is treated as a single undoable edit – we snapshot the
   * previous state *once* before launching the editor so one `undo()` will
   * revert the entire change set.
   *
   * Note: We purposefully rely on the *synchronous* spawn API so that the
   * calling process genuinely waits for the editor to close before
   * continuing.  This mirrors Git's behaviour and simplifies downstream
   * control‑flow (callers can simply `await` the Promise).
   */
  openInExternalEditor: () => Promise<void>;

  replaceRangeByOffset: (startOffset: number, endOffset: number, replacementText: string) => void;
  getOffset: () => number;
  moveToOffset(offset: number): void;
  moveToVisualPosition(visualRow: number, visualCol: number): void;
  /**
   * Convert visual coordinates to logical position without moving cursor.
   * Returns null if the position is out of bounds.
   */
  getLogicalPositionFromVisual(
    visualRow: number,
    visualCol: number,
  ): { row: number; col: number } | null;
  /**
   * Check if a line index falls within an expanded paste region.
   * Returns the paste placeholder ID if found, null otherwise.
   */
  getExpandedPasteAtLine(lineIndex: number): string | null;
  /**
   * Toggle expansion state for a paste placeholder.
   * If collapsed, expands to show full content inline.
   * If expanded, collapses back to placeholder.
   */
  togglePasteExpansion(id: string, row: number, col: number): void;
  /**
   * The current expanded paste info (read-only).
   */
  expandedPaste: ExpandedPasteInfo | null;

  // Vim-specific operations
  /**
   * Delete N words forward from cursor position (vim 'dw' command)
   */
  vimDeleteWordForward: (count: number) => void;
  /**
   * Delete N words backward from cursor position (vim 'db' command)
   */
  vimDeleteWordBackward: (count: number) => void;
  /**
   * Delete to end of N words from cursor position (vim 'de' command)
   */
  vimDeleteWordEnd: (count: number) => void;
  /**
   * Delete N big words forward from cursor position (vim 'dW' command)
   */
  vimDeleteBigWordForward: (count: number) => void;
  /**
   * Delete N big words backward from cursor position (vim 'dB' command)
   */
  vimDeleteBigWordBackward: (count: number) => void;
  /**
   * Delete to end of N big words from cursor position (vim 'dE' command)
   */
  vimDeleteBigWordEnd: (count: number) => void;
  /**
   * Change N words forward from cursor position (vim 'cw' command)
   */
  vimChangeWordForward: (count: number) => void;
  /**
   * Change N words backward from cursor position (vim 'cb' command)
   */
  vimChangeWordBackward: (count: number) => void;
  /**
   * Change to end of N words from cursor position (vim 'ce' command)
   */
  vimChangeWordEnd: (count: number) => void;
  /**
   * Change N big words forward from cursor position (vim 'cW' command)
   */
  vimChangeBigWordForward: (count: number) => void;
  /**
   * Change N big words backward from cursor position (vim 'cB' command)
   */
  vimChangeBigWordBackward: (count: number) => void;
  /**
   * Change to end of N big words from cursor position (vim 'cE' command)
   */
  vimChangeBigWordEnd: (count: number) => void;
  /**
   * Delete N lines from cursor position (vim 'dd' command)
   */
  vimDeleteLine: (count: number) => void;
  /**
   * Change N lines from cursor position (vim 'cc' command)
   */
  vimChangeLine: (count: number) => void;
  /**
   * Delete from cursor to end of line (vim 'D' command)
   * With count > 1, deletes to end of current line plus (count-1) additional lines
   */
  vimDeleteToEndOfLine: (count?: number) => void;
  /**
   * Delete from start of line to cursor (vim 'd0' command)
   */
  vimDeleteToStartOfLine: () => void;
  /**
   * Change from cursor to end of line (vim 'C' command)
   * With count > 1, changes to end of current line plus (count-1) additional lines
   */
  vimChangeToEndOfLine: (count?: number) => void;
  /**
   * Delete from cursor to first non-whitespace character (vim 'd^' command)
   */
  vimDeleteToFirstNonWhitespace: () => void;
  /**
   * Change from cursor to start of line (vim 'c0' command)
   */
  vimChangeToStartOfLine: () => void;
  /**
   * Change from cursor to first non-whitespace character (vim 'c^' command)
   */
  vimChangeToFirstNonWhitespace: () => void;
  /**
   * Delete from current line to first line (vim 'dgg' command)
   */
  vimDeleteToFirstLine: (count: number) => void;
  /**
   * Delete from current line to last line (vim 'dG' command)
   */
  vimDeleteToLastLine: (count: number) => void;
  /**
   * Change movement operations (vim 'ch', 'cj', 'ck', 'cl' commands)
   */
  vimChangeMovement: (movement: 'h' | 'j' | 'k' | 'l', count: number) => void;
  /**
   * Move cursor left N times (vim 'h' command)
   */
  vimMoveLeft: (count: number) => void;
  /**
   * Move cursor right N times (vim 'l' command)
   */
  vimMoveRight: (count: number) => void;
  /**
   * Move cursor up N times (vim 'k' command)
   */
  vimMoveUp: (count: number) => void;
  /**
   * Move cursor down N times (vim 'j' command)
   */
  vimMoveDown: (count: number) => void;
  /**
   * Move cursor forward N words (vim 'w' command)
   */
  vimMoveWordForward: (count: number) => void;
  /**
   * Move cursor backward N words (vim 'b' command)
   */
  vimMoveWordBackward: (count: number) => void;
  /**
   * Move cursor to end of Nth word (vim 'e' command)
   */
  vimMoveWordEnd: (count: number) => void;
  /**
   * Move cursor forward N big words (vim 'W' command)
   */
  vimMoveBigWordForward: (count: number) => void;
  /**
   * Move cursor backward N big words (vim 'B' command)
   */
  vimMoveBigWordBackward: (count: number) => void;
  /**
   * Move cursor to end of Nth big word (vim 'E' command)
   */
  vimMoveBigWordEnd: (count: number) => void;
  /**
   * Delete N characters at cursor (vim 'x' command)
   */
  vimDeleteChar: (count: number) => void;
  /** Delete N characters before cursor (vim 'X') */
  vimDeleteCharBefore: (count: number) => void;
  /** Toggle case of N characters at cursor (vim '~') */
  vimToggleCase: (count: number) => void;
  /** Replace N characters at cursor with char, stay in NORMAL mode (vim 'r') */
  vimReplaceChar: (char: string, count: number) => void;
  /** Move to Nth occurrence of char forward on line; till=true stops before it (vim 'f'/'t') */
  vimFindCharForward: (char: string, count: number, till: boolean) => void;
  /** Move to Nth occurrence of char backward on line; till=true stops after it (vim 'F'/'T') */
  vimFindCharBackward: (char: string, count: number, till: boolean) => void;
  /** Delete from cursor to Nth occurrence of char forward; till=true excludes the char (vim 'df'/'dt') */
  vimDeleteToCharForward: (char: string, count: number, till: boolean) => void;
  /** Delete from Nth occurrence of char backward to cursor; till=true excludes the char (vim 'dF'/'dT') */
  vimDeleteToCharBackward: (char: string, count: number, till: boolean) => void;
  /**
   * Enter insert mode at cursor (vim 'i' command)
   */
  vimInsertAtCursor: () => void;
  /**
   * Enter insert mode after cursor (vim 'a' command)
   */
  vimAppendAtCursor: () => void;
  /**
   * Open new line below and enter insert mode (vim 'o' command)
   */
  vimOpenLineBelow: () => void;
  /**
   * Open new line above and enter insert mode (vim 'O' command)
   */
  vimOpenLineAbove: () => void;
  /**
   * Move to end of line and enter insert mode (vim 'A' command)
   */
  vimAppendAtLineEnd: () => void;
  /**
   * Move to first non-whitespace and enter insert mode (vim 'I' command)
   */
  vimInsertAtLineStart: () => void;
  /**
   * Move cursor to beginning of line (vim '0' command)
   */
  vimMoveToLineStart: () => void;
  /**
   * Move cursor to end of line (vim '$' command)
   */
  vimMoveToLineEnd: () => void;
  /**
   * Move cursor to first non-whitespace character (vim '^' command)
   */
  vimMoveToFirstNonWhitespace: () => void;
  /**
   * Move cursor to first line (vim 'gg' command)
   */
  vimMoveToFirstLine: () => void;
  /**
   * Move cursor to last line (vim 'G' command)
   */
  vimMoveToLastLine: () => void;
  /**
   * Move cursor to specific line number (vim '[N]G' command)
   */
  vimMoveToLine: (lineNumber: number) => void;
  /**
   * Handle escape from insert mode (moves cursor left if not at line start)
   */
  vimEscapeInsertMode: () => void;
  /** Yank N lines into the unnamed register (vim 'yy' / 'Nyy') */
  vimYankLine: (count: number) => void;
  /** Yank forward N words into the unnamed register (vim 'yw') */
  vimYankWordForward: (count: number) => void;
  /** Yank forward N big words into the unnamed register (vim 'yW') */
  vimYankBigWordForward: (count: number) => void;
  /** Yank to end of N words into the unnamed register (vim 'ye') */
  vimYankWordEnd: (count: number) => void;
  /** Yank to end of N big words into the unnamed register (vim 'yE') */
  vimYankBigWordEnd: (count: number) => void;
  /** Yank from cursor to end of line into the unnamed register (vim 'y$') */
  vimYankToEndOfLine: (count: number) => void;
  /** Paste the unnamed register after cursor (vim 'p') */
  vimPasteAfter: (count: number) => void;
  /** Paste the unnamed register before cursor (vim 'P') */
  vimPasteBefore: (count: number) => void;
}
