import { cpLen, cpSlice, toCodePoints } from '../../utils/textUtils.js';

import {
  type TextBufferAction,
  type TextBufferState,
  findNextWordAcrossLines,
  findWordEndInLine,
  findNextBigWordAcrossLines,
  findBigWordEndInLine,
  findPrevWordAcrossLines,
  findPrevBigWordAcrossLines,
  isCombiningMark,
  getLineRangeOffsets,
  getPositionFromOffsets,
  replaceRangeInternal,
  pushUndo,
  detachExpandedPaste,
} from './text-buffer.js';

export type VimAction = Extract<
  TextBufferAction,
  | { type: 'vim_delete_char_before' }
  | { type: 'vim_toggle_case' }
  | { type: 'vim_replace_char' }
  | { type: 'vim_find_char_forward' }
  | { type: 'vim_find_char_backward' }
  | { type: 'vim_delete_to_char_forward' }
  | { type: 'vim_delete_to_char_backward' }
  | { type: 'vim_delete_word_forward' }
  | { type: 'vim_delete_word_backward' }
  | { type: 'vim_delete_word_end' }
  | { type: 'vim_delete_big_word_forward' }
  | { type: 'vim_delete_big_word_backward' }
  | { type: 'vim_delete_big_word_end' }
  | { type: 'vim_change_word_forward' }
  | { type: 'vim_change_word_backward' }
  | { type: 'vim_change_word_end' }
  | { type: 'vim_change_big_word_forward' }
  | { type: 'vim_change_big_word_backward' }
  | { type: 'vim_change_big_word_end' }
  | { type: 'vim_delete_line' }
  | { type: 'vim_change_line' }
  | { type: 'vim_delete_to_end_of_line' }
  | { type: 'vim_delete_to_start_of_line' }
  | { type: 'vim_delete_to_first_nonwhitespace' }
  | { type: 'vim_change_to_end_of_line' }
  | { type: 'vim_change_to_start_of_line' }
  | { type: 'vim_change_to_first_nonwhitespace' }
  | { type: 'vim_delete_to_first_line' }
  | { type: 'vim_delete_to_last_line' }
  | { type: 'vim_change_movement' }
  | { type: 'vim_move_left' }
  | { type: 'vim_move_right' }
  | { type: 'vim_move_up' }
  | { type: 'vim_move_down' }
  | { type: 'vim_move_word_forward' }
  | { type: 'vim_move_word_backward' }
  | { type: 'vim_move_word_end' }
  | { type: 'vim_move_big_word_forward' }
  | { type: 'vim_move_big_word_backward' }
  | { type: 'vim_move_big_word_end' }
  | { type: 'vim_delete_char' }
  | { type: 'vim_insert_at_cursor' }
  | { type: 'vim_append_at_cursor' }
  | { type: 'vim_open_line_below' }
  | { type: 'vim_open_line_above' }
  | { type: 'vim_append_at_line_end' }
  | { type: 'vim_insert_at_line_start' }
  | { type: 'vim_move_to_line_start' }
  | { type: 'vim_move_to_line_end' }
  | { type: 'vim_move_to_first_nonwhitespace' }
  | { type: 'vim_move_to_first_line' }
  | { type: 'vim_move_to_last_line' }
  | { type: 'vim_move_to_line' }
  | { type: 'vim_escape_insert_mode' }
  | { type: 'vim_yank_line' }
  | { type: 'vim_yank_word_forward' }
  | { type: 'vim_yank_big_word_forward' }
  | { type: 'vim_yank_word_end' }
  | { type: 'vim_yank_big_word_end' }
  | { type: 'vim_yank_to_end_of_line' }
  | { type: 'vim_paste_after' }
  | { type: 'vim_paste_before' }
>;

function processHit(i: number, direction: number, till: boolean, len: number): number | null {
  const result = till ? i - direction : i;
  return result >= 0 && result < len ? result : null;
}

/**
 * Find the Nth occurrence of `char` in `codePoints`, starting from `cursorCol`.
 * `forward` controls the search direction. `till` offsets the result by 1
 * (Vim `t`/`T` commands stop one position before the target).
 * Returns the target column index, or `null` if not found.
 *
 * Invariant: returned value is always a valid column index in [0, codePoints.length).
 */
function findCharInLine(
  codePoints: string[],
  char: string,
  count: number,
  forward: boolean,
  till: boolean,
  cursorCol: number,
): number | null {
  const direction = forward ? 1 : -1;
  let hits = 0;

  for (let i = cursorCol + direction; forward ? i < codePoints.length : i >= 0; i += direction) {
    if (codePoints.at(i) === char) {
      hits++;
      if (hits >= count) {
        return processHit(i, direction, till, codePoints.length);
      }
    }
  }
  return null;
}

/**
 * In NORMAL mode the cursor can never rest past the last character of a line.
 * Call this after any delete action that stays in NORMAL mode to enforce that
 * invariant. Change actions must NOT use this — they immediately enter INSERT
 * mode where the cursor is allowed to sit at the end of the line.
 */
function clampNormalCursor(state: TextBufferState): TextBufferState {
  const line = state.lines.at(state.cursorRow) || '';
  const len = cpLen(line);
  const maxCol = Math.max(0, len - 1);
  if (state.cursorCol <= maxCol) return state;
  return { ...state, cursorCol: maxCol };
}

/** Extract the text that will be removed by a delete/yank operation. */
function extractRange(
  lines: string[],
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
): string {
  if (startRow === endRow) {
    return toCodePoints(lines.at(startRow) || '')
      .slice(startCol, endCol)
      .join('');
  }
  const parts: string[] = [];
  parts.push(
    toCodePoints(lines.at(startRow) || '')
      .slice(startCol)
      .join(''),
  );
  for (let r = startRow + 1; r < endRow; r++) {
    parts.push(lines.at(r) || '');
  }
  parts.push(
    toCodePoints(lines.at(endRow) || '')
      .slice(0, endCol)
      .join(''),
  );
  return parts.join('\n');
}

interface VimHandlerContext {
  state: TextBufferState;
  lines: string[];
  cursorRow: number;
  cursorCol: number;
}

function handleDeleteChangeWordForward(
  ctx: VimHandlerContext,
  actionType: string,
  count: number,
): TextBufferState | null {
  const { state, lines, cursorRow, cursorCol } = ctx;
  let endRow = cursorRow;
  let endCol = cursorCol;

  for (let i = 0; i < count; i++) {
    const nextWord = findNextWordAcrossLines(lines, endRow, endCol, true);
    if (nextWord) {
      endRow = nextWord.row;
      endCol = nextWord.col;
    } else {
      const currentLine = lines.at(endRow) || '';
      const wordEnd = findWordEndInLine(currentLine, endCol);
      if (wordEnd !== null) {
        endCol = wordEnd + 1;
      }
      break;
    }
  }

  if (endRow !== cursorRow || endCol !== cursorCol) {
    const yankedText = extractRange(lines, cursorRow, cursorCol, endRow, endCol);
    const nextState = detachExpandedPaste(pushUndo(state));
    const newState = replaceRangeInternal(nextState, cursorRow, cursorCol, endRow, endCol, '');
    if (actionType === 'vim_delete_word_forward') {
      return {
        ...clampNormalCursor(newState),
        yankRegister: { text: yankedText, linewise: false },
      };
    }
    return newState;
  }
  return state;
}

function handleDeleteChangeBigWordForward(
  ctx: VimHandlerContext,
  actionType: string,
  count: number,
): TextBufferState | null {
  const { state, lines, cursorRow, cursorCol } = ctx;
  let endRow = cursorRow;
  let endCol = cursorCol;

  for (let i = 0; i < count; i++) {
    const nextWord = findNextBigWordAcrossLines(lines, endRow, endCol, true);
    if (nextWord) {
      endRow = nextWord.row;
      endCol = nextWord.col;
    } else {
      const currentLine = lines.at(endRow) || '';
      const wordEnd = findBigWordEndInLine(currentLine, endCol);
      if (wordEnd !== null) {
        endCol = wordEnd + 1;
      }
      break;
    }
  }

  if (endRow !== cursorRow || endCol !== cursorCol) {
    const yankedText = extractRange(lines, cursorRow, cursorCol, endRow, endCol);
    const nextState = pushUndo(state);
    const newState = replaceRangeInternal(nextState, cursorRow, cursorCol, endRow, endCol, '');
    if (actionType === 'vim_delete_big_word_forward') {
      return {
        ...clampNormalCursor(newState),
        yankRegister: { text: yankedText, linewise: false },
      };
    }
    return newState;
  }
  return state;
}

function handleDeleteChangeWordBackward(
  ctx: VimHandlerContext,
  _actionType: string,
  count: number,
  findPrev: (lines: string[], row: number, col: number) => { row: number; col: number } | null,
): TextBufferState | null {
  const { state, lines, cursorRow, cursorCol } = ctx;
  let startRow = cursorRow;
  let startCol = cursorCol;

  for (let i = 0; i < count; i++) {
    const prevWord = findPrev(lines, startRow, startCol);
    if (prevWord) {
      startRow = prevWord.row;
      startCol = prevWord.col;
    } else {
      break;
    }
  }

  if (startRow !== cursorRow || startCol !== cursorCol) {
    const nextState = detachExpandedPaste(pushUndo(state));
    return replaceRangeInternal(nextState, startRow, startCol, cursorRow, cursorCol, '');
  }
  return state;
}

function handleDeleteChangeWordEnd(
  ctx: VimHandlerContext,
  actionType: string,
  count: number,
  findNext: typeof findNextWordAcrossLines,
  _findEnd: typeof findWordEndInLine,
): TextBufferState | null {
  const { state, lines, cursorRow, cursorCol } = ctx;
  let row = cursorRow;
  let col = cursorCol;
  let endRow = cursorRow;
  let endCol = cursorCol;

  for (let i = 0; i < count; i++) {
    const wordEnd = findNext(lines, row, col, false);
    if (!wordEnd) break;

    endRow = wordEnd.row;
    endCol = wordEnd.col + 1;

    if (i === count - 1) break;

    const nextWord = findNext(lines, wordEnd.row, wordEnd.col + 1, true);
    if (!nextWord) break;

    row = nextWord.row;
    col = nextWord.col;
  }

  if (endRow < lines.length) {
    const lineLen = cpLen(lines.at(endRow) || '');
    endCol = Math.min(endCol, lineLen);
  }

  if (endRow !== cursorRow || endCol !== cursorCol) {
    const yankedText = extractRange(lines, cursorRow, cursorCol, endRow, endCol);
    const nextState = detachExpandedPaste(pushUndo(state));
    const newState = replaceRangeInternal(nextState, cursorRow, cursorCol, endRow, endCol, '');
    const isDelete = actionType.startsWith('vim_delete_');
    if (isDelete) {
      return {
        ...clampNormalCursor(newState),
        yankRegister: { text: yankedText, linewise: false },
      };
    }
    return newState;
  }
  return state;
}

function handleDeleteLine(ctx: VimHandlerContext, count: number): TextBufferState {
  const { state, lines, cursorRow } = ctx;
  if (lines.length === 0) return state;

  const linesToDelete = Math.min(count, lines.length - cursorRow);
  const totalLines = lines.length;
  const yankedText = lines.slice(cursorRow, cursorRow + linesToDelete).join('\n');

  if (totalLines === 1 || linesToDelete >= totalLines) {
    const nextState = detachExpandedPaste(pushUndo(state));
    return {
      ...nextState,
      lines: [''],
      cursorRow: 0,
      cursorCol: 0,
      preferredCol: null,
      yankRegister: { text: yankedText, linewise: true },
    };
  }

  const nextState = detachExpandedPaste(pushUndo(state));
  const newLines = [...nextState.lines];
  newLines.splice(cursorRow, linesToDelete);
  return {
    ...nextState,
    lines: newLines,
    cursorRow: Math.min(cursorRow, newLines.length - 1),
    cursorCol: 0,
    preferredCol: null,
    yankRegister: { text: yankedText, linewise: true },
  };
}

function handleChangeLine(ctx: VimHandlerContext, count: number): TextBufferState {
  const { state, lines, cursorRow } = ctx;
  if (lines.length === 0) return state;

  const linesToChange = Math.min(count, lines.length - cursorRow);
  const nextState = detachExpandedPaste(pushUndo(state));
  const { startOffset, endOffset } = getLineRangeOffsets(cursorRow, linesToChange, nextState.lines);
  const { startRow, startCol, endRow, endCol } = getPositionFromOffsets(
    startOffset,
    endOffset,
    nextState.lines,
  );
  return replaceRangeInternal(nextState, startRow, startCol, endRow, endCol, '');
}

function handleDeleteToStartOfLine(ctx: VimHandlerContext, _count: number): TextBufferState {
  const { state, cursorRow, cursorCol } = ctx;
  if (cursorCol > 0) {
    const nextState = detachExpandedPaste(pushUndo(state));
    return replaceRangeInternal(nextState, cursorRow, 0, cursorRow, cursorCol, '');
  }
  return state;
}

function handleDeleteToFirstNonWhitespace(ctx: VimHandlerContext): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  const currentLine = lines.at(cursorRow) || '';
  const lineCodePoints = toCodePoints(currentLine);
  let firstNonWs = 0;
  while (firstNonWs < lineCodePoints.length && /\s/.test(lineCodePoints.at(firstNonWs) || '')) {
    firstNonWs++;
  }
  if (firstNonWs >= lineCodePoints.length) {
    firstNonWs = 0;
  }
  if (cursorCol !== firstNonWs) {
    const startCol = Math.min(cursorCol, firstNonWs);
    const endCol = Math.max(cursorCol, firstNonWs);
    const nextState = detachExpandedPaste(pushUndo(state));
    return replaceRangeInternal(nextState, cursorRow, startCol, cursorRow, endCol, '');
  }
  return state;
}

function handleDeleteToFirstLine(ctx: VimHandlerContext, count: number): TextBufferState {
  const { state, lines, cursorRow } = ctx;
  const totalLines = lines.length;
  const targetRow = count > 0 ? Math.min(count - 1, totalLines - 1) : 0;
  const startRow = Math.min(cursorRow, targetRow);
  const endRow = Math.max(cursorRow, targetRow);
  const linesToDelete = endRow - startRow + 1;

  if (linesToDelete >= totalLines) {
    const nextState = detachExpandedPaste(pushUndo(state));
    return { ...nextState, lines: [''], cursorRow: 0, cursorCol: 0, preferredCol: null };
  }

  const nextState = detachExpandedPaste(pushUndo(state));
  const newLines = [...nextState.lines];
  newLines.splice(startRow, linesToDelete);
  return {
    ...nextState,
    lines: newLines,
    cursorRow: Math.min(startRow, newLines.length - 1),
    cursorCol: 0,
    preferredCol: null,
  };
}

function handleDeleteToLastLine(ctx: VimHandlerContext, count: number): TextBufferState {
  const { state, lines, cursorRow } = ctx;
  const totalLines = lines.length;
  const targetRow = count > 0 ? Math.min(count - 1, totalLines - 1) : totalLines - 1;
  const startRow = Math.min(cursorRow, targetRow);
  const endRow = Math.max(cursorRow, targetRow);
  const linesToDelete = endRow - startRow + 1;

  if (linesToDelete >= totalLines) {
    const nextState = detachExpandedPaste(pushUndo(state));
    return { ...nextState, lines: [''], cursorRow: 0, cursorCol: 0, preferredCol: null };
  }

  const nextState = detachExpandedPaste(pushUndo(state));
  const newLines = [...nextState.lines];
  newLines.splice(startRow, linesToDelete);
  return {
    ...nextState,
    lines: newLines,
    cursorRow: Math.min(startRow, newLines.length - 1),
    cursorCol: 0,
    preferredCol: null,
  };
}

function handleDeleteToEndOfLine(
  ctx: VimHandlerContext,
  count: number,
  isDelete: boolean,
): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  const currentLine = lines.at(cursorRow) || '';
  const totalLines = lines.length;

  if (count === 1) {
    if (cursorCol < cpLen(currentLine)) {
      const yankedText = extractRange(lines, cursorRow, cursorCol, cursorRow, cpLen(currentLine));
      const nextState = detachExpandedPaste(pushUndo(state));
      const newState = replaceRangeInternal(
        nextState,
        cursorRow,
        cursorCol,
        cursorRow,
        cpLen(currentLine),
        '',
      );
      if (isDelete) {
        return {
          ...clampNormalCursor(newState),
          yankRegister: { text: yankedText, linewise: false },
        };
      }
      return newState;
    }
    return state;
  }

  const linesToDelete = Math.min(count - 1, totalLines - cursorRow - 1);
  const endRow = cursorRow + linesToDelete;

  if (endRow === cursorRow) {
    if (cursorCol < cpLen(currentLine)) {
      const yankedText = extractRange(lines, cursorRow, cursorCol, cursorRow, cpLen(currentLine));
      const nextState = detachExpandedPaste(pushUndo(state));
      const newState = replaceRangeInternal(
        nextState,
        cursorRow,
        cursorCol,
        cursorRow,
        cpLen(currentLine),
        '',
      );
      if (isDelete) {
        return {
          ...clampNormalCursor(newState),
          yankRegister: { text: yankedText, linewise: false },
        };
      }
      return newState;
    }
    return state;
  }

  const endLine = lines.at(endRow) || '';
  const yankedText = extractRange(lines, cursorRow, cursorCol, endRow, cpLen(endLine));
  const nextState = detachExpandedPaste(pushUndo(state));
  const newState = replaceRangeInternal(
    nextState,
    cursorRow,
    cursorCol,
    endRow,
    cpLen(endLine),
    '',
  );
  if (isDelete) {
    return { ...clampNormalCursor(newState), yankRegister: { text: yankedText, linewise: false } };
  }
  return newState;
}

function handleMoveLeft(ctx: VimHandlerContext, count: number): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  let newRow = cursorRow;
  let newCol = cursorCol;
  for (let i = 0; i < count; i++) {
    if (newCol > 0) {
      newCol--;
    } else if (newRow > 0) {
      newRow--;
      const prevLine = lines.at(newRow) || '';
      const prevLineLength = cpLen(prevLine);
      newCol = prevLineLength === 0 ? 0 : prevLineLength - 1;
    }
  }
  return { ...state, cursorRow: newRow, cursorCol: newCol, preferredCol: null };
}

function handleMoveRight(ctx: VimHandlerContext, count: number): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  let newRow = cursorRow;
  let newCol = cursorCol;
  for (let i = 0; i < count; i++) {
    const currentLine = lines.at(newRow) || '';
    const lineLength = cpLen(currentLine);
    if (lineLength === 0) {
      if (newRow < lines.length - 1) {
        newRow++;
        newCol = 0;
      }
    } else if (newCol < lineLength - 1) {
      newCol++;
      const currentLinePoints = toCodePoints(currentLine);
      while (
        newCol < currentLinePoints.length &&
        isCombiningMark(currentLinePoints.at(newCol) || '') &&
        newCol < lineLength - 1
      ) {
        newCol++;
      }
    } else if (newRow < lines.length - 1) {
      newRow++;
      newCol = 0;
    }
  }
  return { ...state, cursorRow: newRow, cursorCol: newCol, preferredCol: null };
}

function handleMoveUpDown(
  ctx: VimHandlerContext,
  direction: 'up' | 'down',
  count: number,
): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  const newRow =
    direction === 'up'
      ? Math.max(0, cursorRow - count)
      : Math.min(lines.length - 1, cursorRow + count);
  const targetLine = lines.at(newRow) || '';
  const targetLineLength = cpLen(targetLine);
  const newCol = Math.min(cursorCol, targetLineLength > 0 ? targetLineLength - 1 : 0);
  return { ...state, cursorRow: newRow, cursorCol: newCol, preferredCol: null };
}

function handleMoveWord(
  ctx: VimHandlerContext,
  count: number,
  findNext: typeof findNextWordAcrossLines,
): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  let row = cursorRow;
  let col = cursorCol;
  for (let i = 0; i < count; i++) {
    const nextWord = findNext(lines, row, col, true);
    if (nextWord) {
      row = nextWord.row;
      col = nextWord.col;
    } else {
      break;
    }
  }
  return { ...state, cursorRow: row, cursorCol: col, preferredCol: null };
}

function handleMoveWordBackward(
  ctx: VimHandlerContext,
  count: number,
  findPrev: typeof findPrevWordAcrossLines,
): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  let row = cursorRow;
  let col = cursorCol;
  for (let i = 0; i < count; i++) {
    const prevWord = findPrev(lines, row, col);
    if (prevWord) {
      row = prevWord.row;
      col = prevWord.col;
    } else {
      break;
    }
  }
  return { ...state, cursorRow: row, cursorCol: col, preferredCol: null };
}

function handleMoveWordEnd(
  ctx: VimHandlerContext,
  count: number,
  findNext: typeof findNextWordAcrossLines,
): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  let row = cursorRow;
  let col = cursorCol;
  for (let i = 0; i < count; i++) {
    const wordEnd = findNext(lines, row, col, false);
    if (wordEnd) {
      row = wordEnd.row;
      col = wordEnd.col;
    } else {
      break;
    }
  }
  return { ...state, cursorRow: row, cursorCol: col, preferredCol: null };
}

function handleDeleteChar(ctx: VimHandlerContext, count: number): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  const currentLine = lines.at(cursorRow) || '';
  const lineLength = cpLen(currentLine);
  if (cursorCol < lineLength) {
    const deleteCount = Math.min(count, lineLength - cursorCol);
    const deletedText = toCodePoints(currentLine)
      .slice(cursorCol, cursorCol + deleteCount)
      .join('');
    const nextState = detachExpandedPaste(pushUndo(state));
    const newState = replaceRangeInternal(
      nextState,
      cursorRow,
      cursorCol,
      cursorRow,
      cursorCol + deleteCount,
      '',
    );
    return { ...clampNormalCursor(newState), yankRegister: { text: deletedText, linewise: false } };
  }
  return state;
}

function handleDeleteCharBefore(ctx: VimHandlerContext, count: number): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  if (cursorCol > 0) {
    const deleteStart = Math.max(0, cursorCol - count);
    const deletedText = toCodePoints(lines.at(cursorRow) || '')
      .slice(deleteStart, cursorCol)
      .join('');
    const nextState = detachExpandedPaste(pushUndo(state));
    const newState = replaceRangeInternal(
      nextState,
      cursorRow,
      deleteStart,
      cursorRow,
      cursorCol,
      '',
    );
    return { ...newState, yankRegister: { text: deletedText, linewise: false } };
  }
  return state;
}

function handleToggleCase(ctx: VimHandlerContext, count: number): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  const currentLine = lines.at(cursorRow) || '';
  const lineLen = cpLen(currentLine);
  if (cursorCol >= lineLen) return state;
  const end = Math.min(cursorCol + count, lineLen);
  const codePoints = toCodePoints(currentLine);
  for (let i = cursorCol; i < end; i++) {
    const ch = codePoints.at(i) || '';
    const upper = ch.toUpperCase();
    const lower = ch.toLowerCase();
    codePoints.splice(i, 1, ch === upper ? lower : upper);
  }
  const newLine = codePoints.join('');
  const nextState = detachExpandedPaste(pushUndo(state));
  const newLines = [...nextState.lines];
  newLines.splice(cursorRow, 1, newLine);
  const newCol = Math.min(end, lineLen > 0 ? lineLen - 1 : 0);
  return { ...nextState, lines: newLines, cursorCol: newCol, preferredCol: null };
}

function handleReplaceChar(ctx: VimHandlerContext, char: string, count: number): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  const currentLine = lines.at(cursorRow) || '';
  const lineLen = cpLen(currentLine);
  if (cursorCol >= lineLen) return state;
  const replaceCount = Math.min(count, lineLen - cursorCol);
  const replacement = char.repeat(replaceCount);
  const nextState = detachExpandedPaste(pushUndo(state));
  const resultState = replaceRangeInternal(
    nextState,
    cursorRow,
    cursorCol,
    cursorRow,
    cursorCol + replaceCount,
    replacement,
  );
  return { ...resultState, cursorCol: cursorCol + replaceCount - 1, preferredCol: null };
}

function handleFindChar(
  ctx: VimHandlerContext,
  char: string,
  count: number,
  forward: boolean,
  till: boolean,
): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  const lineCodePoints = toCodePoints(lines.at(cursorRow) || '');
  const found = findCharInLine(lineCodePoints, char, count, forward, till, cursorCol);
  if (found !== null) {
    return { ...state, cursorCol: found, preferredCol: null };
  }
  return state;
}

function handleDeleteToChar(
  ctx: VimHandlerContext,
  char: string,
  count: number,
  forward: boolean,
  till: boolean,
): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  const lineCodePoints = toCodePoints(lines.at(cursorRow) || '');
  const found = findCharInLine(lineCodePoints, char, count, forward, till, cursorCol);
  if (found !== null) {
    const startCol = forward ? cursorCol : found;
    const endCol = forward ? found + 1 : cursorCol;
    const yankedText = extractRange(lines, cursorRow, startCol, cursorRow, endCol);
    const nextState = detachExpandedPaste(pushUndo(state));
    const newState = replaceRangeInternal(nextState, cursorRow, startCol, cursorRow, endCol, '');
    return { ...clampNormalCursor(newState), yankRegister: { text: yankedText, linewise: false } };
  }
  return state;
}

function handlePasteAfter(ctx: VimHandlerContext): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  const yankRegister = state.yankRegister;
  if (!yankRegister) return state;
  const { text, linewise } = yankRegister;
  if (linewise) {
    const insertRow = cursorRow + 1;
    const newLines = [...lines];
    newLines.splice(insertRow, 0, text);
    return { ...state, lines: newLines, cursorRow: insertRow, cursorCol: 0, preferredCol: null };
  }
  const currentLine = lines.at(cursorRow) || '';
  const insertCol = cursorCol + 1;
  const newLine = cpSlice(currentLine, 0, insertCol) + text + cpSlice(currentLine, insertCol);
  const newLines = [...lines];
  newLines.splice(cursorRow, 1, newLine);
  return { ...state, lines: newLines, cursorCol: insertCol + cpLen(text) - 1, preferredCol: null };
}

function handlePasteBefore(ctx: VimHandlerContext): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  const yankRegister = state.yankRegister;
  if (!yankRegister) return state;
  const { text, linewise } = yankRegister;
  if (linewise) {
    const newLines = [...lines];
    newLines.splice(cursorRow, 0, text);
    return { ...state, lines: newLines, cursorRow, cursorCol: 0, preferredCol: null };
  }
  const currentLine = lines.at(cursorRow) || '';
  const newLine = cpSlice(currentLine, 0, cursorCol) + text + cpSlice(currentLine, cursorCol);
  const newLines = [...lines];
  newLines.splice(cursorRow, 1, newLine);
  return { ...state, lines: newLines, cursorCol: cursorCol + cpLen(text) - 1, preferredCol: null };
}

function handleChangeMovement(
  ctx: VimHandlerContext,
  movement: string,
  count: number,
): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  const totalLines = lines.length;

  switch (movement) {
    case 'h': {
      const startCol = Math.max(0, cursorCol - count);
      return replaceRangeInternal(
        detachExpandedPaste(pushUndo(state)),
        cursorRow,
        startCol,
        cursorRow,
        cursorCol,
        '',
      );
    }
    case 'j': {
      const linesToChange = Math.min(count + 1, totalLines - cursorRow);
      if (linesToChange > 0) {
        if (linesToChange >= totalLines) {
          const nextState = detachExpandedPaste(pushUndo(state));
          return { ...nextState, lines: [''], cursorRow: 0, cursorCol: 0, preferredCol: null };
        }
        const nextState = detachExpandedPaste(pushUndo(state));
        const newLines = [...nextState.lines];
        newLines.splice(cursorRow, linesToChange);
        return {
          ...nextState,
          lines: newLines,
          cursorRow: Math.min(cursorRow, newLines.length - 1),
          cursorCol: 0,
          preferredCol: null,
        };
      }
      return state;
    }
    case 'k': {
      const startRow = Math.max(0, cursorRow - count);
      const linesToChange = cursorRow - startRow + 1;
      if (linesToChange > 0) {
        if (linesToChange >= totalLines) {
          const nextState = detachExpandedPaste(pushUndo(state));
          return { ...nextState, lines: [''], cursorRow: 0, cursorCol: 0, preferredCol: null };
        }
        const nextState = detachExpandedPaste(pushUndo(state));
        const newLines = [...nextState.lines];
        newLines.splice(startRow, linesToChange);
        return {
          ...nextState,
          lines: newLines,
          cursorRow: Math.min(startRow, newLines.length - 1),
          cursorCol: 0,
          preferredCol: null,
        };
      }
      return state;
    }
    case 'l': {
      return replaceRangeInternal(
        detachExpandedPaste(pushUndo(state)),
        cursorRow,
        cursorCol,
        cursorRow,
        Math.min(cpLen(lines.at(cursorRow) || ''), cursorCol + count),
        '',
      );
    }
    default:
      return state;
  }
}

function handleYankLine(ctx: VimHandlerContext, count: number): TextBufferState {
  const { state, lines, cursorRow } = ctx;
  const linesToYank = Math.min(count, lines.length - cursorRow);
  const yankedText = lines.slice(cursorRow, cursorRow + linesToYank).join('\n');
  return { ...state, yankRegister: { text: yankedText, linewise: true } };
}

function handleYankWordForward(ctx: VimHandlerContext, count: number): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  let endRow = cursorRow;
  let endCol = cursorCol;
  for (let i = 0; i < count; i++) {
    const nextWord = findNextWordAcrossLines(lines, endRow, endCol, true);
    if (nextWord) {
      endRow = nextWord.row;
      endCol = nextWord.col;
    } else {
      break;
    }
  }
  if (endRow !== cursorRow || endCol !== cursorCol) {
    return {
      ...state,
      yankRegister: {
        text: extractRange(lines, cursorRow, cursorCol, endRow, endCol),
        linewise: false,
      },
    };
  }
  return state;
}

function handleYankBigWordForward(ctx: VimHandlerContext, count: number): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  let endRow = cursorRow;
  let endCol = cursorCol;
  for (let i = 0; i < count; i++) {
    const nextWord = findNextBigWordAcrossLines(lines, endRow, endCol, true);
    if (nextWord) {
      endRow = nextWord.row;
      endCol = nextWord.col;
    } else {
      break;
    }
  }
  if (endRow !== cursorRow || endCol !== cursorCol) {
    return {
      ...state,
      yankRegister: {
        text: extractRange(lines, cursorRow, cursorCol, endRow, endCol),
        linewise: false,
      },
    };
  }
  return state;
}

function handleYankWordEnd(ctx: VimHandlerContext, count: number): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  let row = cursorRow;
  let col = cursorCol;
  let endRow = cursorRow;
  let endCol = cursorCol;
  for (let i = 0; i < count; i++) {
    const wordEnd = findNextWordAcrossLines(lines, row, col, false);
    if (wordEnd) {
      endRow = wordEnd.row;
      endCol = wordEnd.col + 1;
      if (i < count - 1) {
        const nextWord = findNextWordAcrossLines(lines, wordEnd.row, wordEnd.col + 1, true);
        if (nextWord) {
          row = nextWord.row;
          col = nextWord.col;
        } else {
          break;
        }
      }
    } else {
      break;
    }
  }
  if (endRow < lines.length) {
    endCol = Math.min(endCol, cpLen(lines.at(endRow) || ''));
  }
  if (endRow !== cursorRow || endCol !== cursorCol) {
    return {
      ...state,
      yankRegister: {
        text: extractRange(lines, cursorRow, cursorCol, endRow, endCol),
        linewise: false,
      },
    };
  }
  return state;
}

function handleYankBigWordEnd(ctx: VimHandlerContext, count: number): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  let row = cursorRow;
  let col = cursorCol;
  let endRow = cursorRow;
  let endCol = cursorCol;
  for (let i = 0; i < count; i++) {
    const wordEnd = findNextBigWordAcrossLines(lines, row, col, false);
    if (wordEnd) {
      endRow = wordEnd.row;
      endCol = wordEnd.col + 1;
      if (i < count - 1) {
        const nextWord = findNextBigWordAcrossLines(lines, wordEnd.row, wordEnd.col + 1, true);
        if (nextWord) {
          row = nextWord.row;
          col = nextWord.col;
        } else {
          break;
        }
      }
    } else {
      break;
    }
  }
  if (endRow < lines.length) {
    endCol = Math.min(endCol, cpLen(lines.at(endRow) || ''));
  }
  if (endRow !== cursorRow || endCol !== cursorCol) {
    return {
      ...state,
      yankRegister: {
        text: extractRange(lines, cursorRow, cursorCol, endRow, endCol),
        linewise: false,
      },
    };
  }
  return state;
}

function handleYankToEndOfLine(ctx: VimHandlerContext, _count: number): TextBufferState {
  const { state, lines, cursorRow, cursorCol } = ctx;
  const currentLine = lines.at(cursorRow) || '';
  const lineLen = cpLen(currentLine);
  if (cursorCol < lineLen) {
    return {
      ...state,
      yankRegister: {
        text: extractRange(lines, cursorRow, cursorCol, cursorRow, lineLen),
        linewise: false,
      },
    };
  }
  return state;
}

// Helper to narrow a VimAction to a specific subtype by its discriminant.
// This resolves TS2339 errors from accessing a.payload in a Record<VimAction['type'], Handler>.
type ExtractVimAction<T extends VimAction['type']> = Extract<VimAction, { type: T }>;
type TypedVimHandler<T extends VimAction['type']> = (
  ctx: VimHandlerContext,
  action: ExtractVimAction<T>,
) => TextBufferState;

// Builds a type-safe handler map. Each handler is typed to its specific action variant,
// then cast to the opaque VimHandler type for map storage.
type VimHandlerMap = { [T in VimAction['type']]: TypedVimHandler<T> };
type VimHandler = TypedVimHandler<VimAction['type']>;

function buildHandlers(): VimHandlerMap {
  return {
    vim_delete_word_forward: (ctx, a) =>
      handleDeleteChangeWordForward(ctx, a.type, a.payload.count) ?? ctx.state,
    vim_change_word_forward: (ctx, a) =>
      handleDeleteChangeWordForward(ctx, a.type, a.payload.count) ?? ctx.state,
    vim_delete_big_word_forward: (ctx, a) =>
      handleDeleteChangeBigWordForward(ctx, a.type, a.payload.count) ?? ctx.state,
    vim_change_big_word_forward: (ctx, a) =>
      handleDeleteChangeBigWordForward(ctx, a.type, a.payload.count) ?? ctx.state,
    vim_delete_word_backward: (ctx, a) =>
      handleDeleteChangeWordBackward(ctx, a.type, a.payload.count, findPrevWordAcrossLines) ??
      ctx.state,
    vim_change_word_backward: (ctx, a) =>
      handleDeleteChangeWordBackward(ctx, a.type, a.payload.count, findPrevWordAcrossLines) ??
      ctx.state,
    vim_delete_big_word_backward: (ctx, a) =>
      handleDeleteChangeWordBackward(ctx, a.type, a.payload.count, findPrevBigWordAcrossLines) ??
      ctx.state,
    vim_change_big_word_backward: (ctx, a) =>
      handleDeleteChangeWordBackward(ctx, a.type, a.payload.count, findPrevBigWordAcrossLines) ??
      ctx.state,
    vim_delete_word_end: (ctx, a) =>
      handleDeleteChangeWordEnd(
        ctx,
        a.type,
        a.payload.count,
        findNextWordAcrossLines,
        findWordEndInLine,
      ) ?? ctx.state,
    vim_change_word_end: (ctx, a) =>
      handleDeleteChangeWordEnd(
        ctx,
        a.type,
        a.payload.count,
        findNextWordAcrossLines,
        findWordEndInLine,
      ) ?? ctx.state,
    vim_delete_big_word_end: (ctx, a) =>
      handleDeleteChangeWordEnd(
        ctx,
        a.type,
        a.payload.count,
        findNextBigWordAcrossLines,
        findBigWordEndInLine,
      ) ?? ctx.state,
    vim_change_big_word_end: (ctx, a) =>
      handleDeleteChangeWordEnd(
        ctx,
        a.type,
        a.payload.count,
        findNextBigWordAcrossLines,
        findBigWordEndInLine,
      ) ?? ctx.state,
    vim_delete_line: (ctx, a) => handleDeleteLine(ctx, a.payload.count),
    vim_change_line: (ctx, a) => handleChangeLine(ctx, a.payload.count),
    vim_delete_to_end_of_line: (ctx, a) => handleDeleteToEndOfLine(ctx, a.payload.count, true),
    vim_change_to_end_of_line: (ctx, a) => handleDeleteToEndOfLine(ctx, a.payload.count, false),
    vim_delete_to_start_of_line: (ctx) => handleDeleteToStartOfLine(ctx, ctx.state.cursorCol),
    vim_delete_to_first_nonwhitespace: (ctx) => handleDeleteToFirstNonWhitespace(ctx),
    vim_change_to_start_of_line: (ctx) => {
      if (ctx.cursorCol > 0) {
        const nextState = detachExpandedPaste(pushUndo(ctx.state));
        return replaceRangeInternal(nextState, ctx.cursorRow, 0, ctx.cursorRow, ctx.cursorCol, '');
      }
      return ctx.state;
    },
    vim_change_to_first_nonwhitespace: (ctx) => handleDeleteToFirstNonWhitespace(ctx),
    vim_delete_to_first_line: (ctx, a) => handleDeleteToFirstLine(ctx, a.payload.count),
    vim_delete_to_last_line: (ctx, a) => handleDeleteToLastLine(ctx, a.payload.count),
    vim_change_movement: (ctx, a) => handleChangeMovement(ctx, a.payload.movement, a.payload.count),
    vim_move_left: (ctx, a) => handleMoveLeft(ctx, a.payload.count),
    vim_move_right: (ctx, a) => handleMoveRight(ctx, a.payload.count),
    vim_move_up: (ctx, a) => handleMoveUpDown(ctx, 'up', a.payload.count),
    vim_move_down: (ctx, a) => handleMoveUpDown(ctx, 'down', a.payload.count),
    vim_move_word_forward: (ctx, a) =>
      handleMoveWord(ctx, a.payload.count, findNextWordAcrossLines),
    vim_move_big_word_forward: (ctx, a) =>
      handleMoveWord(ctx, a.payload.count, findNextBigWordAcrossLines),
    vim_move_word_backward: (ctx, a) =>
      handleMoveWordBackward(ctx, a.payload.count, findPrevWordAcrossLines),
    vim_move_big_word_backward: (ctx, a) =>
      handleMoveWordBackward(ctx, a.payload.count, findPrevBigWordAcrossLines),
    vim_move_word_end: (ctx, a) => handleMoveWordEnd(ctx, a.payload.count, findNextWordAcrossLines),
    vim_move_big_word_end: (ctx, a) =>
      handleMoveWordEnd(ctx, a.payload.count, findNextBigWordAcrossLines),
    vim_delete_char: (ctx, a) => handleDeleteChar(ctx, a.payload.count),
    vim_insert_at_cursor: (ctx) => ctx.state,
    vim_append_at_cursor: (ctx) => {
      const currentLine = ctx.lines[ctx.cursorRow] || '';
      const newCol = ctx.cursorCol < cpLen(currentLine) ? ctx.cursorCol + 1 : ctx.cursorCol;
      return { ...ctx.state, cursorCol: newCol, preferredCol: null };
    },
    vim_open_line_below: (ctx) => {
      const nextState = detachExpandedPaste(pushUndo(ctx.state));
      const endOfLine = cpLen(ctx.lines[ctx.cursorRow] || '');
      return replaceRangeInternal(
        nextState,
        ctx.cursorRow,
        endOfLine,
        ctx.cursorRow,
        endOfLine,
        '\n',
      );
    },
    vim_open_line_above: (ctx) => {
      const nextState = detachExpandedPaste(pushUndo(ctx.state));
      const resultState = replaceRangeInternal(nextState, ctx.cursorRow, 0, ctx.cursorRow, 0, '\n');
      return { ...resultState, cursorRow: ctx.cursorRow, cursorCol: 0 };
    },
    vim_append_at_line_end: (ctx) => {
      const lineLength = cpLen(ctx.lines[ctx.cursorRow] || '');
      return { ...ctx.state, cursorCol: lineLength, preferredCol: null };
    },
    vim_insert_at_line_start: (ctx) => {
      const currentLine = ctx.lines.at(ctx.cursorRow) || '';
      let col = 0;
      const lineCodePoints = toCodePoints(currentLine);
      while (col < lineCodePoints.length && /\s/.test(lineCodePoints.at(col) || '')) {
        col++;
      }
      return { ...ctx.state, cursorCol: col, preferredCol: null };
    },
    vim_move_to_line_start: (ctx) => ({ ...ctx.state, cursorCol: 0, preferredCol: null }),
    vim_move_to_line_end: (ctx) => {
      const lineLength = cpLen(ctx.lines[ctx.cursorRow] || '');
      return { ...ctx.state, cursorCol: lineLength > 0 ? lineLength - 1 : 0, preferredCol: null };
    },
    vim_move_to_first_nonwhitespace: (ctx) => {
      const currentLine = ctx.lines.at(ctx.cursorRow) || '';
      let col = 0;
      const lineCodePoints = toCodePoints(currentLine);
      while (col < lineCodePoints.length && /\s/.test(lineCodePoints.at(col) || '')) {
        col++;
      }
      if (col >= lineCodePoints.length) {
        col = 0;
      }
      return { ...ctx.state, cursorCol: col, preferredCol: null };
    },
    vim_move_to_first_line: (ctx) => ({
      ...ctx.state,
      cursorRow: 0,
      cursorCol: 0,
      preferredCol: null,
    }),
    vim_move_to_last_line: (ctx) => ({
      ...ctx.state,
      cursorRow: ctx.lines.length - 1,
      cursorCol: 0,
      preferredCol: null,
    }),
    vim_move_to_line: (ctx, a) => ({
      ...ctx.state,
      cursorRow: Math.min(Math.max(0, a.payload.lineNumber - 1), ctx.lines.length - 1),
      cursorCol: 0,
      preferredCol: null,
    }),
    vim_escape_insert_mode: (ctx) => ({
      ...ctx.state,
      cursorCol: ctx.cursorCol > 0 ? ctx.cursorCol - 1 : 0,
      preferredCol: null,
    }),
    vim_delete_char_before: (ctx, a) => handleDeleteCharBefore(ctx, a.payload.count),
    vim_toggle_case: (ctx, a) => handleToggleCase(ctx, a.payload.count),
    vim_replace_char: (ctx, a) => handleReplaceChar(ctx, a.payload.char, a.payload.count),
    vim_delete_to_char_forward: (ctx, a) =>
      handleDeleteToChar(ctx, a.payload.char, a.payload.count, true, a.payload.till),
    vim_delete_to_char_backward: (ctx, a) =>
      handleDeleteToChar(ctx, a.payload.char, a.payload.count, false, a.payload.till),
    vim_find_char_forward: (ctx, a) =>
      handleFindChar(ctx, a.payload.char, a.payload.count, true, a.payload.till),
    vim_find_char_backward: (ctx, a) =>
      handleFindChar(ctx, a.payload.char, a.payload.count, false, a.payload.till),
    vim_yank_line: (ctx, a) => handleYankLine(ctx, a.payload.count),
    vim_yank_word_forward: (ctx, a) => handleYankWordForward(ctx, a.payload.count),
    vim_yank_big_word_forward: (ctx, a) => handleYankBigWordForward(ctx, a.payload.count),
    vim_yank_word_end: (ctx, a) => handleYankWordEnd(ctx, a.payload.count),
    vim_yank_big_word_end: (ctx, a) => handleYankBigWordEnd(ctx, a.payload.count),
    vim_yank_to_end_of_line: (ctx, a) => handleYankToEndOfLine(ctx, a.payload.count),
    vim_paste_after: (ctx) => handlePasteAfter(ctx),
    vim_paste_before: (ctx) => handlePasteBefore(ctx),
  };
}

const vimHandlers = buildHandlers() as Record<VimAction['type'], VimHandler>;

export function handleVimAction(state: TextBufferState, action: VimAction): TextBufferState {
  const handler = vimHandlers[action.type];
  // VimHandlerMap is exhaustive over VimAction['type'], so handler is always defined.
  return handler(
    { state, lines: state.lines, cursorRow: state.cursorRow, cursorCol: state.cursorCol },
    action,
  );
}
