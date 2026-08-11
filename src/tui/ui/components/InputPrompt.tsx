import React, { Fragment, useState, useRef, useMemo, useCallback, useEffect } from 'react';
import clipboardy from 'clipboardy';
import { Box, Text, useStdout, type DOMElement } from 'ink';
import { SuggestionsDisplay, MAX_WIDTH, type Suggestion } from './SuggestionsDisplay.js';
import { theme } from '../semantic-colors.js';
import { useInputHistory } from '../hooks/useInputHistory.js';
import { escapeAtSymbols } from '../hooks/atCommandProcessor.js';
import { ScrollableList, type ScrollableListRef } from './shared/ScrollableList.js';
import { HalfLinePaddedBox } from './shared/HalfLinePaddedBox.js';
import {
  type TextBuffer,
  logicalPosToOffset,
  expandPastePlaceholders,
  getTransformUnderCursor,
  LARGE_PASTE_LINE_THRESHOLD,
  LARGE_PASTE_CHAR_THRESHOLD,
} from './shared/text-buffer.js';
import { cpSlice, cpLen, toCodePoints, cpIndexToOffset } from '../utils/textUtils.js';
import chalk from 'chalk';
import stringWidth from 'string-width';
import { useShellHistory } from '../hooks/useShellHistory.js';
import { useReverseSearchCompletion } from '../hooks/useReverseSearchCompletion.js';
import { useCommandCompletion, CompletionMode } from '../hooks/useCommandCompletion.js';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import { Command } from '../key/keyMatchers.js';
import { formatCommand } from '../key/keybindingUtils.js';
import {
  CommandContext,
  SlashCommand,
  ApprovalMode,
  StreamingState,
  Storage,
  useUIState,
} from '../contexts/UIStateContext.js';
import { debugLogger } from '../../utils/errors.js';
import { HiveConfig } from '../../config/hiveConfig.js';
import { coreEvents } from '../../utils/coreEvents.js';

import { parseInputForHighlighting, parseSegmentsFromTokens } from '../utils/highlight.js';
import { useKittyKeyboardProtocol } from '../hooks/useKittyKeyboardProtocol.js';
import {
  clipboardHasImage,
  saveClipboardImage,
  cleanupOldClipboardImages,
} from '../utils/clipboardUtils.js';
import { isAutoExecutableCommand, isSlashCommand } from '../utils/commandUtils.js';
import { parseSlashCommand } from '../../utils/commands.js';
import * as path from 'node:path';
import { SCREEN_READER_USER_PREFIX } from '../textConstants.js';
import { useShellFocusState } from '../contexts/ShellFocusContext.js';
import { useInputState } from '../contexts/InputContext.js';
import { appEvents, AppEvent, TransientMessageType } from '../../utils/events.js';
import { useSettings } from '../contexts/SettingsContext.js';
import { useMouseClick } from '../hooks/useMouseClick.js';
import { useMouse, type MouseEvent } from '../contexts/MouseContext.js';
import { useUIActions } from '../contexts/UIActionsContext.js';
import { useAlternateBuffer } from '../hooks/useAlternateBuffer.js';
import { useIsHelpDismissKey } from '../utils/shortcutsHelp.js';
import { useRepeatedKeyPress } from '../hooks/useRepeatedKeyPress.js';
import { useKeyMatchers } from '../hooks/useKeyMatchers.js';
import type { VimMode } from '../contexts/VimModeContext.js';

const SCROLLBAR_GUTTER_WIDTH = 1;

/**
 * Returns if the terminal can be trusted to handle paste events atomically
 * rather than potentially sending multiple paste events separated by line
 * breaks which could trigger unintended command execution.
 */
export function isTerminalPasteTrusted(kittyProtocolSupported: boolean): boolean {
  // Ideally we could trust all VSCode family terminals as well but it appears
  // we cannot as Cursor users on windows reported being impacted by this
  // issue.
  return kittyProtocolSupported;
}

export type ScrollableItem =
  | { type: 'visualLine'; lineText: string; absoluteVisualIdx: number }
  | { type: 'ghostLine'; ghostLine: string; index: number };

export interface InputPromptProps {
  onSubmit: (value: string) => void;
  onClearScreen: () => void;
  config: HiveConfig;
  slashCommands: readonly SlashCommand[];
  commandContext: CommandContext;
  placeholder?: string;
  focus?: boolean;
  setShellModeActive: (value: boolean) => void;
  approvalMode: ApprovalMode;
  onEscapePromptChange?: (showPrompt: boolean) => void;
  onSuggestionsVisibilityChange?: (visible: boolean) => void;
  vimHandleInput?: (key: Key) => boolean;
  vimEnabled?: boolean;
  vimMode?: VimMode;
  isEmbeddedShellFocused?: boolean;
  setQueueErrorMessage: (message: string | null) => void;
  streamingState: StreamingState;
  popAllMessages?: () => string | undefined;
  onQueueMessage?: (message: string) => void;
  suggestionsPosition?: 'above' | 'below';
  setBannerVisible: (visible: boolean) => void;
}

// The input content, input container, and input suggestions list may have different widths
export const calculatePromptWidths = (mainContentWidth: number) => {
  const FRAME_PADDING_AND_BORDER = 4; // Border (2) + padding (2)
  const PROMPT_PREFIX_WIDTH = 2; // '> ' or '! '

  const FRAME_OVERHEAD = FRAME_PADDING_AND_BORDER + PROMPT_PREFIX_WIDTH;
  const suggestionsWidth = Math.max(20, mainContentWidth);

  return {
    inputWidth: Math.max(mainContentWidth - FRAME_OVERHEAD, 1),
    containerWidth: mainContentWidth,
    suggestionsWidth,
    frameOverhead: FRAME_OVERHEAD,
  } as const;
};

/**
 * Returns true if the given text exceeds the thresholds for being considered a "large paste".
 */
export function isLargePaste(text: string): boolean {
  const pasteLineCount = text.split('\n').length;
  return pasteLineCount > LARGE_PASTE_LINE_THRESHOLD || text.length > LARGE_PASTE_CHAR_THRESHOLD;
}

interface InputHandlerContext {
  buffer: TextBuffer;
  completion: ReturnType<typeof useCommandCompletion>;
  reverseSearchCompletion: ReturnType<typeof useReverseSearchCompletion>;
  commandSearchCompletion: ReturnType<typeof useReverseSearchCompletion>;
  shellModeActive: boolean;
  setShellModeActive: (v: boolean) => void;
  setSuppressCompletion: (v: boolean) => void;
  setForceShowShellSuggestions: (v: boolean) => void;
  forceShowShellSuggestions: boolean;
  shouldShowSuggestions: boolean;
  isShellSuggestionsVisible: boolean;
  reverseSearchActive: boolean;
  setReverseSearchActive: (v: boolean) => void;
  setTextBeforeReverseSearch: (v: string) => void;
  commandSearchActive: boolean;
  setCommandSearchActive: (v: boolean) => void;
  setCursorPosition: (pos: [number, number]) => void;
  cursorPosition: [number, number];
  textBeforeReverseSearch: string;
  setExpandedSuggestionIndex: (v: number) => void;
  resetCompletionState: () => void;
  resetReverseSearchCompletionState: () => void;
  handleSubmit: (text: string) => void;
  recentUnsafePasteTime: number | null;
  setRecentUnsafePasteTime: (v: number | null) => void;
  setQueueErrorMessage: ((msg: string) => void) | undefined;
  onQueueMessage: ((msg: string) => void) | undefined;
  resetPlainTabPress: () => void;
  registerPlainTabPress: () => number;
  toggleCleanUiDetailsVisible: () => void;
  isGenerating: boolean;
  keyMatchers: ReturnType<typeof useKeyMatchers>;
  isHelpDismissKey: (key: Key) => boolean;
  setShortcutsHelpVisible: (v: boolean) => void;
  shortcutsHelpVisible: boolean;
  vimEnabled: boolean;
  vimMode: VimMode;
  vimHandleInput: ((key: Key) => boolean) | undefined;
  resetEscapeState: () => void;
  handleEscPress: () => void;

  tryLoadQueuedMessages: () => boolean;
  setBannerVisible: (v: boolean) => void;
  onClearScreen: () => void;
  activePtyId: string | undefined;
  setEmbeddedShellFocused: (v: boolean) => void;
  backgroundTasks: Map<number, unknown>;
  backgroundTaskHeight: number;
  shellHistory: ReturnType<typeof useShellHistory>;
  inputHistory: ReturnType<typeof useInputHistory>;
  settings: ReturnType<typeof useSettings>['merged'];
  pasteTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  kittyProtocol: { enabled: boolean };
  focus: boolean;
  resetTurnBaseline: () => void;
  streamingState: StreamingState;
}

const DOUBLE_TAB_CLEAN_UI_TOGGLE_WINDOW_MS = 350;
/**
 * Attempt to toggle expansion of a paste placeholder in the buffer.
 * Returns true if a toggle action was performed or hint was shown, false otherwise.
 */
export function tryTogglePasteExpansion(buffer: TextBuffer): boolean {
  if (!buffer.pastedContent || Object.keys(buffer.pastedContent).length === 0) {
    return false;
  }

  const [row, col] = buffer.cursor;

  // 1. Check if cursor is on or immediately after a collapsed placeholder
  const transform = getTransformUnderCursor(row, col, buffer.transformationsByLine, {
    includeEdge: true,
  });
  if (transform?.type === 'paste' && transform.id) {
    buffer.togglePasteExpansion(transform.id, row, col);
    return true;
  }

  // 2. Check if cursor is inside an expanded paste region — collapse it
  const expandedId = buffer.getExpandedPasteAtLine(row);
  if (expandedId) {
    buffer.togglePasteExpansion(expandedId, row, col);
    return true;
  }

  // 3. Placeholders exist but cursor isn't on one — show hint
  appEvents.emit(AppEvent.TransientMessage, {
    message: 'Move cursor within placeholder to expand',
    type: TransientMessageType.Hint,
  });
  return true;
}

function handleQueueMessageKey(
  ctx: InputHandlerContext,
  _key: Key,
  isQueueMessageKey: boolean,
  hasTabCompletionInteraction: boolean,
): boolean {
  if (
    !ctx.isGenerating ||
    !isQueueMessageKey ||
    hasTabCompletionInteraction ||
    ctx.buffer.text.trim().length === 0
  ) {
    return false;
  }
  const trimmedMessage = ctx.buffer.text.trim();
  const isSlash = isSlashCommand(trimmedMessage);
  if (isSlash || ctx.shellModeActive) {
    ctx.setQueueErrorMessage?.(
      `${ctx.shellModeActive ? 'Shell' : 'Slash'} commands cannot be queued`,
    );
  } else if (ctx.onQueueMessage) {
    ctx.onQueueMessage(ctx.buffer.text);
    ctx.buffer.setText('');
    ctx.resetCompletionState();
    ctx.resetReverseSearchCompletionState();
  }
  ctx.resetPlainTabPress();
  return true;
}

function handleTabKey(ctx: InputHandlerContext, isPlainTab: boolean): boolean {
  if (!isPlainTab) {
    ctx.resetPlainTabPress();
    return false;
  }
  if (ctx.shellModeActive) {
    ctx.resetPlainTabPress();
    if (!ctx.shouldShowSuggestions) {
      ctx.setSuppressCompletion(false);
      if (ctx.completion.promptCompletion.text) {
        ctx.completion.promptCompletion.accept();
        return true;
      }
      if (ctx.completion.suggestions.length > 0 && !ctx.forceShowShellSuggestions) {
        ctx.setForceShowShellSuggestions(true);
        return true;
      }
    }
    return false;
  }
  if (!ctx.isShellSuggestionsVisible) {
    if (ctx.registerPlainTabPress() === 2) {
      ctx.toggleCleanUiDetailsVisible();
      ctx.resetPlainTabPress();
      return true;
    }
  } else {
    ctx.resetPlainTabPress();
  }
  return false;
}

function handlePasteKey(
  ctx: InputHandlerContext,
  key: Key,
  kittyProtocol: { enabled: boolean },
  pasteTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>,
  setRecentUnsafePasteTime: (v: number | null) => void,
  _recentUnsafePasteTime: number | null,
): boolean {
  if (key.name !== 'paste') return false;
  if (ctx.shortcutsHelpVisible) {
    ctx.setShortcutsHelpVisible(false);
  }
  if (!isTerminalPasteTrusted(kittyProtocol.enabled)) {
    setRecentUnsafePasteTime(Date.now());
    if (pasteTimeoutRef.current) {
      clearTimeout(pasteTimeoutRef.current);
    }
    pasteTimeoutRef.current = setTimeout(() => {
      setRecentUnsafePasteTime(null);
      pasteTimeoutRef.current = null;
    }, 40);
  }
  if (ctx.settings.ui?.escapePastedAtSymbols) {
    ctx.buffer.handleInput({
      ...key,
      sequence: escapeAtSymbols(key.sequence || ''),
    });
  } else {
    ctx.buffer.handleInput(key);
  }
  if (key.sequence && isLargePaste(key.sequence)) {
    appEvents.emit(AppEvent.TransientMessage, {
      message: `Press ${formatCommand(Command.EXPAND_PASTE)} to expand pasted text`,
      type: TransientMessageType.Hint,
    });
  }
  return true;
}

function handleEscapeKey(
  ctx: InputHandlerContext,
  cursorPosition: [number, number],
  textBeforeReverseSearch: string,
  setExpandedSuggestionIndex: (v: number) => void,
): boolean {
  if (ctx.reverseSearchActive) {
    ctx.setReverseSearchActive(false);
    ctx.reverseSearchCompletion.resetCompletionState();
    ctx.buffer.setText(textBeforeReverseSearch);
    const offset = logicalPosToOffset(ctx.buffer.lines, cursorPosition[0], cursorPosition[1]);
    ctx.buffer.moveToOffset(offset);
    setExpandedSuggestionIndex(-1);
    return true;
  }
  if (ctx.commandSearchActive) {
    ctx.setCommandSearchActive(false);
    ctx.commandSearchCompletion.resetCompletionState();
    ctx.buffer.setText(textBeforeReverseSearch);
    const offset = logicalPosToOffset(ctx.buffer.lines, cursorPosition[0], cursorPosition[1]);
    ctx.buffer.moveToOffset(offset);
    setExpandedSuggestionIndex(-1);
    return true;
  }
  if (ctx.completion.showSuggestions && ctx.isShellSuggestionsVisible) {
    ctx.completion.resetCompletionState();
    setExpandedSuggestionIndex(-1);
    ctx.resetEscapeState();
    return true;
  }
  if (ctx.shellModeActive) {
    ctx.setShellModeActive(false);
    ctx.resetEscapeState();
    return true;
  }
  if (ctx.isGenerating) {
    return false;
  }
  ctx.handleEscPress();
  return true;
}

function handleSuggestionExpandCollapse(
  ctx: InputHandlerContext,
  key: Key,
  suggestions: Suggestion[],
  activeSuggestionIndex: number,
  setExpandedSuggestionIndex: (v: number) => void,
): boolean {
  if (ctx.keyMatchers[Command.COLLAPSE_SUGGESTION](key)) {
    const suggestion = suggestions.at(activeSuggestionIndex);
    if (suggestion && suggestion.value.length >= MAX_WIDTH) {
      setExpandedSuggestionIndex(-1);
      return true;
    }
  }
  if (ctx.keyMatchers[Command.EXPAND_SUGGESTION](key)) {
    const suggestion = suggestions.at(activeSuggestionIndex);
    if (suggestion && suggestion.value.length >= MAX_WIDTH) {
      setExpandedSuggestionIndex(activeSuggestionIndex);
      return true;
    }
  }
  return false;
}

function handleSearchSuggestionKeys(
  ctx: InputHandlerContext,
  key: Key,
  sc: ReturnType<typeof useReverseSearchCompletion>,
  setActive: (v: boolean) => void,
  setExpandedSuggestionIndex: (v: number) => void,
): boolean {
  const { activeSuggestionIndex, navigateUp, navigateDown, suggestions } = sc;
  if (ctx.keyMatchers[Command.NAVIGATION_UP](key)) {
    navigateUp();
    return true;
  }
  if (ctx.keyMatchers[Command.NAVIGATION_DOWN](key)) {
    navigateDown();
    return true;
  }
  if (
    handleSuggestionExpandCollapse(
      ctx,
      key,
      suggestions,
      activeSuggestionIndex,
      setExpandedSuggestionIndex,
    )
  ) {
    return true;
  }
  if (ctx.keyMatchers[Command.ACCEPT_SUGGESTION_REVERSE_SEARCH](key)) {
    sc.handleAutocomplete(activeSuggestionIndex);
    sc.resetCompletionState();
    setActive(false);
    return true;
  }
  return false;
}

function handleSearchNavigation(
  ctx: InputHandlerContext,
  key: Key,
  setExpandedSuggestionIndex: (v: number) => void,
): boolean {
  if (!ctx.reverseSearchActive && !ctx.commandSearchActive) return false;
  const isCommandSearch = ctx.commandSearchActive;
  const sc = isCommandSearch ? ctx.commandSearchCompletion : ctx.reverseSearchCompletion;
  const setActive = isCommandSearch ? ctx.setCommandSearchActive : ctx.setReverseSearchActive;
  const resetState = sc.resetCompletionState;

  if (sc.showSuggestions) {
    if (handleSearchSuggestionKeys(ctx, key, sc, setActive, setExpandedSuggestionIndex)) {
      return true;
    }
  }
  if (ctx.keyMatchers[Command.SUBMIT_REVERSE_SEARCH](key)) {
    const textToSubmit =
      sc.showSuggestions && sc.activeSuggestionIndex > -1
        ? sc.suggestions[sc.activeSuggestionIndex].value
        : ctx.buffer.text;
    ctx.handleSubmit(textToSubmit);
    resetState();
    setActive(false);
    return true;
  }
  if (
    ctx.keyMatchers[Command.NAVIGATION_UP](key) ||
    ctx.keyMatchers[Command.NAVIGATION_DOWN](key)
  ) {
    return true;
  }
  return false;
}

function handleSlashCommandSubmit(
  ctx: InputHandlerContext,
  suggestion: Suggestion,
  setExpandedSuggestionIndex: (v: number) => void,
): boolean {
  if (suggestion.submitValue) {
    setExpandedSuggestionIndex(-1);
    ctx.handleSubmit(suggestion.submitValue.trim());
    return true;
  }
  const { isArgumentCompletion, leafCommand } = ctx.completion.slashCompletionRange;
  if (isArgumentCompletion && isAutoExecutableCommand(leafCommand)) {
    const completedText = ctx.completion.getCompletedText(suggestion);
    if (completedText) {
      setExpandedSuggestionIndex(-1);
      ctx.handleSubmit(completedText.trim());
      return true;
    }
    return false;
  }
  if (!isArgumentCompletion) {
    const command = ctx.completion.getCommandFromSuggestion(suggestion);
    if (command && isAutoExecutableCommand(command) && !command.completion) {
      const completedText = ctx.completion.getCompletedText(suggestion);
      if (completedText) {
        setExpandedSuggestionIndex(-1);
        ctx.handleSubmit(completedText.trim());
        return true;
      }
    }
  }
  return false;
}

function handleAcceptSuggestion(
  ctx: InputHandlerContext,
  key: Key,
  setExpandedSuggestionIndex: (v: number) => void,
  hasUserNavigatedSuggestions: React.MutableRefObject<boolean>,
): boolean {
  if (ctx.completion.suggestions.length === 0) {
    return false;
  }
  const targetIndex =
    ctx.completion.activeSuggestionIndex === -1 ? 0 : ctx.completion.activeSuggestionIndex;
  if (targetIndex >= ctx.completion.suggestions.length) {
    return true;
  }
  const suggestion = ctx.completion.suggestions.at(targetIndex);
  if (!suggestion) {
    return true;
  }
  const isEnterKey = key.name === 'enter' && !key.ctrl;
  if (isEnterKey && ctx.shellModeActive) {
    if (hasUserNavigatedSuggestions.current) {
      ctx.completion.handleAutocomplete(ctx.completion.activeSuggestionIndex);
      setExpandedSuggestionIndex(-1);
      hasUserNavigatedSuggestions.current = false;
      return true;
    }
    ctx.completion.resetCompletionState();
    setExpandedSuggestionIndex(-1);
    hasUserNavigatedSuggestions.current = false;
    if (ctx.buffer.text.trim()) {
      ctx.handleSubmit(ctx.buffer.text);
    }
    return true;
  }
  if (isEnterKey && ctx.buffer.text.startsWith('/')) {
    if (handleSlashCommandSubmit(ctx, suggestion, setExpandedSuggestionIndex)) {
      return true;
    }
  }
  ctx.completion.handleAutocomplete(targetIndex);
  setExpandedSuggestionIndex(-1);
  return true;
}

function handleSuggestionNavigation(
  ctx: InputHandlerContext,
  key: Key,
  setExpandedSuggestionIndex: (v: number) => void,
  hasUserNavigatedSuggestions: React.MutableRefObject<boolean>,
): boolean {
  if (!ctx.completion.showSuggestions || !ctx.isShellSuggestionsVisible) return false;
  if (ctx.completion.suggestions.length > 1) {
    if (ctx.keyMatchers[Command.COMPLETION_UP](key)) {
      ctx.completion.navigateUp();
      hasUserNavigatedSuggestions.current = true;
      setExpandedSuggestionIndex(-1);
      return true;
    }
    if (ctx.keyMatchers[Command.COMPLETION_DOWN](key)) {
      ctx.completion.navigateDown();
      hasUserNavigatedSuggestions.current = true;
      setExpandedSuggestionIndex(-1);
      return true;
    }
  }
  if (ctx.keyMatchers[Command.ACCEPT_SUGGESTION](key)) {
    return handleAcceptSuggestion(
      ctx,
      key,
      setExpandedSuggestionIndex,
      hasUserNavigatedSuggestions,
    );
  }
  return false;
}

function handleNonShellHistoryNavigation(
  ctx: InputHandlerContext,
  key: Key,
  isHistoryUp: boolean,
  isHistoryDown: boolean,
  tryLoadQueuedMessages: () => boolean,
  inputHistory: ReturnType<typeof useInputHistory>,
  cpLenFn: (s: string) => number,
): boolean {
  if (ctx.keyMatchers[Command.REVERSE_SEARCH](key)) {
    ctx.setCommandSearchActive(true);
    ctx.setTextBeforeReverseSearch(ctx.buffer.text);
    ctx.setCursorPosition(ctx.buffer.cursor);
    return true;
  }
  if (isHistoryUp) {
    if (ctx.keyMatchers[Command.NAVIGATION_UP](key) && ctx.buffer.visualCursor[1] > 0) {
      ctx.buffer.move('home');
      return true;
    }
    if (tryLoadQueuedMessages()) return true;
    inputHistory.navigateUp();
    return true;
  }
  if (isHistoryDown) {
    if (
      ctx.keyMatchers[Command.NAVIGATION_DOWN](key) &&
      ctx.buffer.visualCursor[1] <
        cpLenFn(ctx.buffer.allVisualLines[ctx.buffer.visualCursor[0]] || '')
    ) {
      ctx.buffer.move('end');
      return true;
    }
    inputHistory.navigateDown();
    return true;
  }
  return false;
}

function handleShellHistoryNavigation(
  ctx: InputHandlerContext,
  key: Key,
  shellHistory: ReturnType<typeof useShellHistory>,
  cpLenFn: (s: string) => number,
): boolean {
  if (ctx.keyMatchers[Command.NAVIGATION_UP](key)) {
    if (
      (ctx.buffer.allVisualLines.length === 1 ||
        (ctx.buffer.visualCursor[0] === 0 && ctx.buffer.visualScrollRow === 0)) &&
      ctx.buffer.visualCursor[1] > 0
    ) {
      ctx.buffer.move('home');
      return true;
    }
    const prevCommand = shellHistory.getPreviousCommand();
    if (prevCommand !== null) ctx.buffer.setText(prevCommand);
    return true;
  }
  if (ctx.keyMatchers[Command.NAVIGATION_DOWN](key)) {
    if (
      (ctx.buffer.allVisualLines.length === 1 ||
        ctx.buffer.visualCursor[0] === ctx.buffer.allVisualLines.length - 1) &&
      ctx.buffer.visualCursor[1] <
        cpLenFn(ctx.buffer.allVisualLines[ctx.buffer.visualCursor[0]] || '')
    ) {
      ctx.buffer.move('end');
      return true;
    }
    const nextCommand = shellHistory.getNextCommand();
    if (nextCommand !== null) ctx.buffer.setText(nextCommand);
    return true;
  }
  return false;
}

function handleHistoryNavigation(
  ctx: InputHandlerContext,
  key: Key,
  isHistoryUp: boolean,
  isHistoryDown: boolean,
  tryLoadQueuedMessages: () => boolean,
  inputHistory: ReturnType<typeof useInputHistory>,
  shellHistory: ReturnType<typeof useShellHistory>,
  cpLenFn: (s: string) => number,
): boolean {
  if (!ctx.shellModeActive) {
    return handleNonShellHistoryNavigation(
      ctx,
      key,
      isHistoryUp,
      isHistoryDown,
      tryLoadQueuedMessages,
      inputHistory,
      cpLenFn,
    );
  }
  return handleShellHistoryNavigation(ctx, key, shellHistory, cpLenFn);
}

function handleSubmitKey(ctx: InputHandlerContext, recentUnsafePasteTime: number | null): boolean {
  if (!ctx.buffer.text.trim()) return false;
  if (recentUnsafePasteTime !== null) {
    ctx.buffer.newline();
    return true;
  }
  const [row, col] = ctx.buffer.cursor;
  const line = ctx.buffer.lines.at(row) ?? '';
  const charBefore = col > 0 ? cpSlice(line, col - 1, col) : '';
  if (charBefore === '\\') {
    ctx.buffer.backspace();
    ctx.buffer.newline();
  } else {
    ctx.handleSubmit(ctx.buffer.text);
  }
  return true;
}

function handleEditorAndShellKeys(
  ctx: InputHandlerContext,
  key: Key,
  clipPaste: () => void,
): boolean | undefined {
  if (ctx.keyMatchers[Command.OPEN_EXTERNAL_EDITOR](key)) {
    ctx.buffer.openInExternalEditor();
    return true;
  }
  if (ctx.keyMatchers[Command.DEPRECATED_OPEN_EXTERNAL_EDITOR](key)) {
    const cmdKey = formatCommand(Command.OPEN_EXTERNAL_EDITOR);
    appEvents.emit(AppEvent.TransientMessage, {
      message: `Use ${cmdKey} to open the external editor.`,
      type: TransientMessageType.Hint,
    });
    return true;
  }
  if (ctx.keyMatchers[Command.PASTE_CLIPBOARD](key)) {
    clipPaste();
    return true;
  }
  if (ctx.keyMatchers[Command.TOGGLE_BACKGROUND_SHELL](key)) {
    return false;
  }
  if (ctx.keyMatchers[Command.FOCUS_SHELL_INPUT](key)) {
    if (ctx.activePtyId || (ctx.backgroundTasks.size > 0 && ctx.backgroundTaskHeight > 0)) {
      ctx.setEmbeddedShellFocused(true);
      return true;
    }
    return false;
  }
  return undefined;
}

function handleNavigationKeys(ctx: InputHandlerContext, key: Key): boolean {
  if (ctx.keyMatchers[Command.HOME](key)) {
    ctx.buffer.move('home');
    return true;
  }
  if (ctx.keyMatchers[Command.END](key)) {
    ctx.buffer.move('end');
    return true;
  }
  if (ctx.keyMatchers[Command.KILL_LINE_RIGHT](key)) {
    ctx.buffer.killLineRight();
    return true;
  }
  if (ctx.keyMatchers[Command.KILL_LINE_LEFT](key)) {
    ctx.buffer.killLineLeft();
    return true;
  }
  if (ctx.keyMatchers[Command.DELETE_WORD_BACKWARD](key)) {
    ctx.buffer.deleteWordLeft();
    return true;
  }
  return false;
}

function handlePerfectMatchSubmit(
  ctx: InputHandlerContext,
  key: Key,
  unsafePasteTime: number | null,
  navSuggestionsRef: React.MutableRefObject<boolean>,
): boolean {
  if (
    !ctx.completion.isPerfectMatch ||
    !ctx.keyMatchers[Command.SUBMIT](key) ||
    unsafePasteTime !== null
  ) {
    return false;
  }
  if (
    !(ctx.completion.showSuggestions && ctx.isShellSuggestionsVisible) ||
    (ctx.completion.activeSuggestionIndex <= 0 && !navSuggestionsRef.current)
  ) {
    ctx.handleSubmit(ctx.buffer.text);
    return true;
  }
  return false;
}

function handleRemainingInputKeys(ctx: InputHandlerContext, key: Key): boolean {
  if (ctx.keyMatchers[Command.NEWLINE](key)) {
    ctx.buffer.newline();
    return true;
  }

  if (
    key.name === 'tab' &&
    !key.shift &&
    !(ctx.completion.showSuggestions && ctx.isShellSuggestionsVisible) &&
    ctx.completion.promptCompletion.text
  ) {
    ctx.completion.promptCompletion.accept();
    return true;
  }

  if (ctx.keyMatchers[Command.SUBMIT](key)) {
    return true;
  }

  if (handleNavigationKeys(ctx, key)) return true;

  return false;
}

function handleInputKeyDispatch(
  ctx: InputHandlerContext,
  key: Key,
  expandedSuggestionIdxSetter: (v: number) => void,
  navSuggestionsRef: React.MutableRefObject<boolean>,
  unsafePasteTime: number | null,
  historyUp: boolean,
  historyDown: boolean,
  loadQueuedFn: () => boolean,
  hist: ReturnType<typeof useInputHistory>,
  shellHist: ReturnType<typeof useShellHistory>,
  clipPaste: () => void,
): boolean {
  if (handleSearchNavigation(ctx, key, expandedSuggestionIdxSetter)) {
    return true;
  }

  if (handlePerfectMatchSubmit(ctx, key, unsafePasteTime, navSuggestionsRef)) {
    return true;
  }

  if (handleSuggestionNavigation(ctx, key, expandedSuggestionIdxSetter, navSuggestionsRef)) {
    return true;
  }

  if (
    handleHistoryNavigation(ctx, key, historyUp, historyDown, loadQueuedFn, hist, shellHist, cpLen)
  ) {
    return true;
  }

  if (handleRemainingInputKeys(ctx, key)) {
    if (ctx.keyMatchers[Command.SUBMIT](key)) {
      handleSubmitKey(ctx, unsafePasteTime);
    }
    return true;
  }

  const editorResult = handleEditorAndShellKeys(ctx, key, clipPaste);
  if (editorResult !== undefined) return editorResult;

  const handled = ctx.buffer.handleInput(key);
  if (handled) {
    if (ctx.keyMatchers[Command.CLEAR_INPUT](key)) {
      ctx.resetCompletionState();
    }
    if (
      ctx.completion.promptCompletion.text &&
      key.sequence &&
      key.sequence.length === 1 &&
      !key.alt &&
      !key.ctrl &&
      !key.cmd
    ) {
      ctx.completion.promptCompletion.clear();
      expandedSuggestionIdxSetter(-1);
    }
  }
  return handled;
}

interface KeyClassification {
  isHistoryUp: boolean;
  isHistoryDown: boolean;
  isHistoryNav: boolean;
  isCursorMovement: boolean;
  isSuggestionsNav: boolean;
  isQueueMessageKey: boolean;
  isPlainTab: boolean;
  hasTabCompletionInteraction: boolean;
  isGenerating: boolean;
}

function isHistoryNavKey(
  key: Key,
  km: ReturnType<typeof useKeyMatchers>,
  buf: TextBuffer,
  shellActive: boolean,
  direction: 'up' | 'down',
): boolean {
  if (shellActive) return false;
  const navKey = direction === 'up' ? Command.HISTORY_UP : Command.HISTORY_DOWN;
  const navDir = direction === 'up' ? Command.NAVIGATION_UP : Command.NAVIGATION_DOWN;
  const kmMap = new Map<string, (k: Key) => boolean>(Object.entries(km));
  if (kmMap.get(navKey)?.(key)) return true;
  if (!kmMap.get(navDir)?.(key)) return false;
  if (buf.allVisualLines.length === 1) return true;
  if (direction === 'up') return buf.visualCursor[0] === 0 && buf.visualScrollRow === 0;
  return buf.visualCursor[0] === buf.allVisualLines.length - 1;
}

function classifyKey(
  key: Key,
  km: ReturnType<typeof useKeyMatchers>,
  buf: TextBuffer,
  shellActive: boolean,
  showSuggestions: boolean,
  comp: ReturnType<typeof useCommandCompletion>,
  shellSugVisible: boolean,
  revSearchActive: boolean,
  cmdSearchActive: boolean,
  streamState: StreamingState,
): KeyClassification {
  const isHistoryUp = isHistoryNavKey(key, km, buf, shellActive, 'up');
  const isHistoryDown = isHistoryNavKey(key, km, buf, shellActive, 'down');
  const isCursorMovement =
    km[Command.MOVE_LEFT](key) ||
    km[Command.MOVE_RIGHT](key) ||
    km[Command.MOVE_UP](key) ||
    km[Command.MOVE_DOWN](key) ||
    km[Command.MOVE_WORD_LEFT](key) ||
    km[Command.MOVE_WORD_RIGHT](key) ||
    km[Command.HOME](key) ||
    km[Command.END](key);
  const isSuggestionsNav =
    showSuggestions &&
    (km[Command.COMPLETION_UP](key) ||
      km[Command.COMPLETION_DOWN](key) ||
      km[Command.EXPAND_SUGGESTION](key) ||
      km[Command.COLLAPSE_SUGGESTION](key) ||
      km[Command.ACCEPT_SUGGESTION](key));
  const isGenerating =
    streamState === StreamingState.Responding ||
    streamState === StreamingState.WaitingForConfirmation;

  return {
    isHistoryUp,
    isHistoryDown,
    isHistoryNav: isHistoryUp || isHistoryDown,
    isCursorMovement,
    isSuggestionsNav,
    isGenerating,
    isQueueMessageKey: km[Command.QUEUE_MESSAGE](key),
    isPlainTab: key.name === 'tab' && !key.shift && !key.alt && !key.ctrl && !key.cmd,
    hasTabCompletionInteraction:
      (comp.showSuggestions && shellSugVisible) ||
      Boolean(comp.promptCompletion.text) ||
      revSearchActive ||
      cmdSearchActive,
  };
}

function computePromptMode(params: {
  completionMode: CompletionMode;
  text: string;
  reverseSearchActive: boolean;
  commandSearchActive: boolean;
}): 'reverse' | 'slash' {
  const { completionMode, text, reverseSearchActive, commandSearchActive } = params;
  if (completionMode === CompletionMode.AT || completionMode === CompletionMode.SHELL) {
    return 'reverse';
  }
  if (text.startsWith('/') && !reverseSearchActive && !commandSearchActive) {
    return 'slash';
  }
  return 'reverse';
}

function computePromptPrefix(params: {
  shellModeActive: boolean;
  reverseSearchActive: boolean;
  commandSearchActive: boolean;
  showYoloStyling: boolean;
}): React.ReactNode {
  const { shellModeActive, reverseSearchActive, commandSearchActive, showYoloStyling } = params;
  if (shellModeActive) {
    if (reverseSearchActive) {
      return (
        <Text color={theme.text.link} aria-label={SCREEN_READER_USER_PREFIX}>
          (r:)
        </Text>
      );
    }
    return '!';
  }
  if (commandSearchActive) {
    return <Text color={theme.text.accent}>(r:)</Text>;
  }
  if (showYoloStyling) {
    return '*';
  }
  return '>';
}

function renderPlaceholder(effectivePlaceholder: string, showCursor: boolean): React.ReactNode {
  if (!effectivePlaceholder) {
    return null;
  }
  if (!showCursor) {
    return <Text color={theme.text.secondary}>{effectivePlaceholder}</Text>;
  }
  return (
    <Text terminalCursorFocus={showCursor} terminalCursorPosition={0}>
      {chalk.inverse(effectivePlaceholder.slice(0, 1))}
      <Text color={theme.text.secondary}>{effectivePlaceholder.slice(1)}</Text>
    </Text>
  );
}

function computeInlineGhost(firstLineRaw: string, remainingWidth: number): string {
  if (stringWidth(firstLineRaw) <= remainingWidth) {
    return firstLineRaw;
  }
  const words = firstLineRaw.split(' ');
  let currentLine = '';
  for (const word of words) {
    const prospectiveLine = currentLine ? `${currentLine} ${word}` : word;
    if (stringWidth(prospectiveLine) > remainingWidth) {
      break;
    }
    currentLine = prospectiveLine;
  }
  return currentLine;
}

function computeGhostRemainder(
  firstLineRaw: string,
  remainingWidth: number,
  ghostTextLinesRaw: string[],
): string {
  const words = firstLineRaw.split(' ');
  let currentLine = '';
  let wordIdx = 0;
  for (const word of words) {
    const prospectiveLine = currentLine ? `${currentLine} ${word}` : word;
    if (stringWidth(prospectiveLine) > remainingWidth) {
      break;
    }
    currentLine = prospectiveLine;
    wordIdx++;
  }
  const linesToWrap: string[] = [];
  if (words.length > wordIdx) {
    linesToWrap.push(words.slice(wordIdx).join(' '));
  }
  linesToWrap.push(...ghostTextLinesRaw);
  return linesToWrap.join('\n');
}

function splitWideWord(word: string, maxWidth: number): string[] {
  const parts: string[] = [];
  let remaining = word;
  while (stringWidth(remaining) > maxWidth) {
    let part = '';
    const wordCP = toCodePoints(remaining);
    let partWidth = 0;
    let splitIndex = 0;
    for (let i = 0; i < wordCP.length; i++) {
      const char = wordCP.at(i) ?? '';
      const charWidth = stringWidth(char);
      if (partWidth + charWidth > maxWidth) break;
      part += char;
      partWidth += charWidth;
      splitIndex = i + 1;
    }
    parts.push(part);
    remaining = cpSlice(remaining, splitIndex);
  }
  parts.push(remaining);
  return parts;
}

function appendWrappedWord(
  word: string,
  maxWidth: number,
  currentLine: string,
  additionalLines: string[],
): string {
  const prospectiveLine = currentLine ? `${currentLine} ${word}` : word;
  const prospectiveWidth = stringWidth(prospectiveLine);

  if (prospectiveWidth <= maxWidth) {
    return prospectiveLine;
  }
  if (currentLine) {
    additionalLines.push(currentLine);
  }
  const parts = splitWideWord(word, maxWidth);
  for (const part of parts.slice(0, -1)) {
    additionalLines.push(part);
  }
  return parts.at(-1) ?? '';
}

function computeAdditionalLines(remainingGhostText: string, maxWidth: number): string[] {
  const additionalLines: string[] = [];
  if (!remainingGhostText) {
    return additionalLines;
  }
  const textLines = remainingGhostText.split('\n');
  for (const textLine of textLines) {
    const words = textLine.split(' ');
    let currentLine = '';
    for (const word of words) {
      currentLine = appendWrappedWord(word, maxWidth, currentLine, additionalLines);
    }
    if (currentLine) {
      additionalLines.push(currentLine);
    }
  }
  return additionalLines;
}

function handleShortcutsHelpKeys(ctx: InputHandlerContext, key: Key): boolean {
  if (!ctx.shortcutsHelpVisible) {
    return false;
  }
  if (key.sequence === '?' && key.insertable && (!ctx.vimEnabled || ctx.vimMode === 'INSERT')) {
    ctx.setShortcutsHelpVisible(false);
    ctx.buffer.handleInput(key);
    return true;
  }
  if (key.name === 'backspace' || key.sequence === '\b') {
    ctx.setShortcutsHelpVisible(false);
    return true;
  }
  if (key.insertable) {
    ctx.setShortcutsHelpVisible(false);
  }
  return false;
}

function handleEscapeAndShellModeKeys(
  ctx: InputHandlerContext,
  key: Key,
  expandedIdxSetter: (v: number) => void,
): boolean {
  if (ctx.vimHandleInput && ctx.vimHandleInput(key)) {
    return true;
  }

  if (key.name !== 'escape') {
    ctx.resetEscapeState();
  }

  if (ctx.keyMatchers[Command.EXPAND_PASTE](key)) {
    if (tryTogglePasteExpansion(ctx.buffer)) return true;
  }

  if (
    key.sequence === '!' &&
    ctx.buffer.text === '' &&
    !(ctx.completion.showSuggestions && ctx.isShellSuggestionsVisible)
  ) {
    ctx.setShellModeActive(!ctx.shellModeActive);
    ctx.buffer.setText('');
    ctx.resetTurnBaseline();
    return true;
  }

  if (ctx.keyMatchers[Command.ESCAPE](key)) {
    if (handleEscapeKey(ctx, ctx.cursorPosition, ctx.textBeforeReverseSearch, expandedIdxSetter)) {
      return true;
    }
  }

  if (ctx.keyMatchers[Command.CLEAR_SCREEN](key)) {
    ctx.setBannerVisible(false);
    ctx.onClearScreen();
    return true;
  }

  if (ctx.shellModeActive && ctx.keyMatchers[Command.REVERSE_SEARCH](key)) {
    ctx.setReverseSearchActive(true);
    ctx.setTextBeforeReverseSearch(ctx.buffer.text);
    ctx.setCursorPosition(ctx.buffer.cursor);
    return true;
  }

  return false;
}

function handleShortcutsAndInitialKeys(
  ctx: InputHandlerContext,
  key: Key,
  expandedIdxSetter: (v: number) => void,
): boolean {
  if (handleShortcutsHelpKeys(ctx, key)) {
    return true;
  }

  if (
    key.sequence === '?' &&
    key.insertable &&
    !ctx.shortcutsHelpVisible &&
    ctx.buffer.text.length === 0 &&
    (!ctx.vimEnabled || ctx.vimMode === 'INSERT')
  ) {
    ctx.setShortcutsHelpVisible(true);
    return true;
  }

  return handleEscapeAndShellModeKeys(ctx, key, expandedIdxSetter);
}

async function insertClipboardImageReference(
  config: HiveConfig,
  buffer: TextBuffer,
): Promise<void> {
  if (!(await clipboardHasImage())) {
    return;
  }
  const imagePath = await saveClipboardImage(config.getTargetDir());
  if (!imagePath) {
    return;
  }
  // Clean up old images
  cleanupOldClipboardImages(config.getTargetDir()).catch(() => {
    // Ignore cleanup errors
  });

  // Get relative path from current directory
  const relativePath = path.relative(config.getTargetDir(), imagePath);

  // Insert @path reference at cursor position
  const insertText = `@${relativePath}`;
  const currentText = buffer.text;
  const offset = buffer.getOffset();

  // Add spaces around the path if needed
  let textToInsert = insertText;
  const charBefore = offset > 0 ? (currentText.at(offset - 1) ?? '') : '';
  const charAfter = offset < currentText.length ? (currentText.at(offset) ?? '') : '';

  if (charBefore && charBefore !== ' ' && charBefore !== '\n') {
    textToInsert = ' ' + textToInsert;
  }
  if (!charAfter || (charAfter !== ' ' && charAfter !== '\n')) {
    textToInsert = textToInsert + ' ';
  }

  // Insert at cursor position
  buffer.replaceRangeByOffset(offset, offset, textToInsert);
}

async function pastePlainTextToBuffer(
  settings: ReturnType<typeof useSettings>['merged'],
  stdout: NodeJS.WriteStream,
  buffer: TextBuffer,
): Promise<void> {
  if (settings.experimental?.useOSC52Paste) {
    stdout.write('\x1b]52;c;?\x07');
    return;
  }
  const textToInsert = await clipboardy.read();
  const escapedText = settings.ui?.escapePastedAtSymbols
    ? escapeAtSymbols(textToInsert)
    : textToInsert;
  buffer.insert(escapedText, { paste: true });

  if (isLargePaste(textToInsert)) {
    appEvents.emit(AppEvent.TransientMessage, {
      message: `Press ${formatCommand(Command.EXPAND_PASTE)} to expand pasted text`,
      type: TransientMessageType.Hint,
    });
  }
}

function renderPromptLineItem(params: {
  item: ScrollableItem;
  buffer: TextBuffer;
  focus: boolean;
  cursorVisualRowAbsolute: number;
  cursorVisualColAbsolute: number;
  showCursor: boolean;
  inlineGhost: string;
  inputWidth: number;
}): React.ReactElement {
  const {
    item,
    buffer,
    focus,
    cursorVisualRowAbsolute,
    cursorVisualColAbsolute,
    showCursor,
    inlineGhost,
    inputWidth,
  } = params;
  if (item.type === 'ghostLine') {
    const padding = Math.max(0, inputWidth - stringWidth(item.ghostLine));
    return (
      <Box height={1}>
        <Text color={theme.text.secondary}>
          {item.ghostLine}
          {' '.repeat(padding)}
        </Text>
      </Box>
    );
  }

  const { lineText, absoluteVisualIdx } = item;
  const mapEntry = buffer.visualToLogicalMap.at(absoluteVisualIdx);
  if (!mapEntry) return <Text> </Text>;

  const isOnCursorLine = focus && absoluteVisualIdx === cursorVisualRowAbsolute;
  const renderedLine: React.ReactNode[] = [];
  const [logicalLineIdx] = mapEntry;
  const logicalLine = buffer.lines.at(logicalLineIdx) || '';
  const transformations = buffer.transformationsByLine.at(logicalLineIdx) ?? [];
  const tokens = parseInputForHighlighting(
    logicalLine,
    logicalLineIdx,
    transformations,
    ...(focus && buffer.cursor[0] === logicalLineIdx ? [buffer.cursor[1]] : []),
  );
  const visualStartCol = buffer.visualToTransformedMap.at(absoluteVisualIdx) ?? 0;
  const visualEndCol = visualStartCol + cpLen(lineText);
  const segments = parseSegmentsFromTokens(tokens, visualStartCol, visualEndCol);
  let charCount = 0;
  segments.forEach((seg, segIdx) => {
    const segLen = cpLen(seg.text);
    let display = seg.text;
    if (isOnCursorLine) {
      const relCol = cursorVisualColAbsolute;
      const segStart = charCount;
      const segEnd = segStart + segLen;
      if (relCol >= segStart && relCol < segEnd) {
        const charToHighlight = cpSlice(display, relCol - segStart, relCol - segStart + 1);
        const highlighted = showCursor ? chalk.inverse(charToHighlight) : charToHighlight;
        display =
          cpSlice(display, 0, relCol - segStart) +
          highlighted +
          cpSlice(display, relCol - segStart + 1);
      }
      charCount = segEnd;
    } else {
      charCount += segLen;
    }
    const color =
      seg.type === 'command' || seg.type === 'file' || seg.type === 'paste'
        ? theme.text.accent
        : theme.text.primary;
    renderedLine.push(
      <Text key={`token-${segIdx}`} color={color}>
        {display}
      </Text>,
    );
  });

  const currentLineGhost = isOnCursorLine ? inlineGhost : '';
  if (isOnCursorLine && cursorVisualColAbsolute === cpLen(lineText) && !currentLineGhost) {
    renderedLine.push(
      <Text key={`cursor-end-${cursorVisualColAbsolute}`}>
        {showCursor ? chalk.inverse(' ') : ' '}
      </Text>,
    );
  }
  const showCursorBeforeGhost =
    focus && isOnCursorLine && cursorVisualColAbsolute === cpLen(lineText) && currentLineGhost;
  return (
    <Box height={1}>
      <Text
        terminalCursorFocus={showCursor && isOnCursorLine}
        terminalCursorPosition={cpIndexToOffset(lineText, cursorVisualColAbsolute)}
      >
        {renderedLine}
        {showCursorBeforeGhost && (showCursor ? chalk.inverse(' ') : ' ')}
        {currentLineGhost && <Text color={theme.text.secondary}>{currentLineGhost}</Text>}
      </Text>
    </Box>
  );
}

function useInputPromptCompletions(params: {
  buffer: TextBuffer;
  config: HiveConfig;
  slashCommands: readonly SlashCommand[];
  commandContext: CommandContext;
  suppressCompletion: boolean;
  shellModeActive: boolean;
  reverseSearchActive: boolean;
  commandSearchActive: boolean;
  userMessages: string[];
  placeholder: string;
}) {
  const {
    buffer,
    config,
    slashCommands,
    commandContext,
    suppressCompletion,
    shellModeActive,
    reverseSearchActive,
    commandSearchActive,
    userMessages,
    placeholder,
  } = params;

  const storage = useMemo(() => config.storage ?? new Storage(config.getProjectRoot()), [config]);
  const shellHistory = useShellHistory(config.getProjectRoot(), storage);
  const shellHistoryData = shellHistory.history;

  const completion = useCommandCompletion({
    buffer,
    cwd: config.getTargetDir(),
    slashCommands,
    commandContext,
    reverseSearchActive,
    shellModeActive,
    config,
    active: !suppressCompletion,
  });

  const reverseSearchCompletion = useReverseSearchCompletion(
    buffer,
    shellHistoryData,
    reverseSearchActive,
  );

  const reversedUserMessages = useMemo(() => [...userMessages].reverse(), [userMessages]);

  const commandSearchCompletion = useReverseSearchCompletion(
    buffer,
    reversedUserMessages,
    commandSearchActive,
  );

  const resetCompletionState = completion.resetCompletionState;
  const resetReverseSearchCompletionState = reverseSearchCompletion.resetCompletionState;
  const resetCommandSearchCompletionState = commandSearchCompletion.resetCompletionState;

  const getActiveCompletion = useCallback(() => {
    if (commandSearchActive) return commandSearchCompletion;
    if (reverseSearchActive) return reverseSearchCompletion;
    return completion;
  }, [
    commandSearchActive,
    commandSearchCompletion,
    reverseSearchActive,
    reverseSearchCompletion,
    completion,
  ]);

  const activeCompletion = getActiveCompletion();
  const shouldShowSuggestions = activeCompletion.showSuggestions;
  const { forceShowShellSuggestions, setForceShowShellSuggestions, isShellSuggestionsVisible } =
    completion;
  const effectivePlaceholder = useMemo(() => placeholder, [placeholder]);

  return {
    shellHistory,
    shellHistoryData,
    completion,
    reverseSearchCompletion,
    commandSearchCompletion,
    resetCompletionState,
    resetReverseSearchCompletionState,
    resetCommandSearchCompletionState,
    activeCompletion,
    shouldShowSuggestions,
    forceShowShellSuggestions,
    setForceShowShellSuggestions,
    isShellSuggestionsVisible,
    effectivePlaceholder,
  };
}

function useInputPromptSubmit(params: {
  buffer: TextBuffer;
  userMessages: string[];
  shellModeActive: boolean;
  shellHistory: ReturnType<typeof useShellHistory>;
  completion: ReturnType<typeof useCommandCompletion>;
  isShellSuggestionsVisible: boolean;
  onSubmit: (value: string) => void;
  resetTurnBaseline: () => void;
  resetCompletionState: () => void;
  resetReverseSearchCompletionState: () => void;
  resetCommandSearchCompletionState: () => void;
  setSuppressCompletion: (v: boolean) => void;
  suppressCompletion: boolean;
  setExpandedSuggestionIndex: (v: number) => void;
  streamingState: StreamingState;
  setQueueErrorMessage: (message: string | null) => void;
  slashCommands: readonly SlashCommand[];
  popAllMessages?: () => string | undefined;
}) {
  const {
    buffer,
    userMessages,
    shellModeActive,
    shellHistory,
    completion,
    isShellSuggestionsVisible,
    onSubmit,
    resetTurnBaseline,
    resetCompletionState,
    resetReverseSearchCompletionState,
    resetCommandSearchCompletionState,
    setSuppressCompletion,
    suppressCompletion,
    setExpandedSuggestionIndex,
    streamingState,
    setQueueErrorMessage,
    slashCommands,
    popAllMessages,
  } = params;

  const handleSubmitAndClear = useCallback(
    (submittedValue: string) => {
      let processedValue = submittedValue;
      if (buffer.pastedContent) {
        processedValue = expandPastePlaceholders(processedValue, buffer.pastedContent);
      }

      if (shellModeActive) {
        shellHistory.addCommandToHistory(processedValue);
      }
      // Clear the buffer *before* calling onSubmit to prevent potential re-submission
      // if onSubmit triggers a re-render while the buffer still holds the old value.
      buffer.setText('');
      resetTurnBaseline();
      onSubmit(processedValue);
      resetCompletionState();
      resetReverseSearchCompletionState();
    },
    [
      buffer,
      onSubmit,
      resetCompletionState,
      shellModeActive,
      shellHistory,
      resetReverseSearchCompletionState,
      resetTurnBaseline,
    ],
  );

  const customSetTextAndResetCompletionSignal = useCallback(
    (newText: string, newCursorPosition?: 'start' | 'end' | number) => {
      buffer.setText(newText, newCursorPosition);
      setSuppressCompletion(true);
    },
    [buffer, setSuppressCompletion],
  );

  const inputHistory = useInputHistory({
    userMessages,
    onSubmit: handleSubmitAndClear,
    isActive:
      (!(completion.showSuggestions && isShellSuggestionsVisible) ||
        completion.suggestions.length === 1) &&
      !shellModeActive,
    currentQuery: buffer.text,
    currentCursorOffset: buffer.getOffset(),
    onChange: customSetTextAndResetCompletionSignal,
  });

  const handleSubmit = useCallback(
    (submittedValue: string) => {
      const trimmedMessage = submittedValue.trim();
      const isSlash = isSlashCommand(trimmedMessage);

      const isShell = shellModeActive;
      if ((isSlash || isShell) && streamingState === StreamingState.Responding) {
        if (isSlash) {
          const { commandToExecute } = parseSlashCommand(trimmedMessage, slashCommands);
          if (commandToExecute?.isSafeConcurrent) {
            handleSubmitAndClear(trimmedMessage);
            return;
          }
        }

        setQueueErrorMessage(`${isShell ? 'Shell' : 'Slash'} commands cannot be queued`);
        return;
      }
      inputHistory.handleSubmit(trimmedMessage);
    },
    [
      inputHistory,
      shellModeActive,
      streamingState,
      setQueueErrorMessage,
      slashCommands,
      handleSubmitAndClear,
    ],
  );

  // Effect to reset completion if history navigation just occurred and set the text
  useEffect(() => {
    if (suppressCompletion) {
      resetCompletionState();
      resetReverseSearchCompletionState();
      resetCommandSearchCompletionState();
      setExpandedSuggestionIndex(-1);
    }
  }, [
    suppressCompletion,
    buffer.text,
    resetCompletionState,
    setSuppressCompletion,
    resetReverseSearchCompletionState,
    resetCommandSearchCompletionState,
    setExpandedSuggestionIndex,
  ]);

  // Helper function to handle loading queued messages into input
  // Returns true if we should continue with input history navigation
  const tryLoadQueuedMessages = useCallback(() => {
    if (buffer.text.trim() === '' && popAllMessages) {
      const allMessages = popAllMessages();
      if (allMessages) {
        buffer.setText(allMessages);
        return true;
      } else {
        // No queued messages, proceed with input history
        inputHistory.navigateUp();
      }
      return true; // We handled the up arrow key
    }
    return false;
  }, [buffer, popAllMessages, inputHistory]);

  return {
    handleSubmitAndClear,
    customSetTextAndResetCompletionSignal,
    inputHistory,
    handleSubmit,
    tryLoadQueuedMessages,
  };
}

function useInputPromptPaste(params: {
  buffer: TextBuffer;
  config: HiveConfig;
  stdout: NodeJS.WriteStream;
  settings: ReturnType<typeof useSettings>['merged'];
  shortcutsHelpVisible: boolean;
  setShortcutsHelpVisible: (v: boolean) => void;
  setSuppressCompletion: (v: boolean) => void;
  isEmbeddedShellFocused: boolean | undefined;
  setEmbeddedShellFocused: (v: boolean) => void;
  listRef: React.RefObject<ScrollableListRef<ScrollableItem> | null>;
  innerBoxRef: React.RefObject<DOMElement | null>;
  focus: boolean;
}) {
  const {
    buffer,
    config,
    stdout,
    settings,
    shortcutsHelpVisible,
    setShortcutsHelpVisible,
    setSuppressCompletion,
    isEmbeddedShellFocused,
    setEmbeddedShellFocused,
    listRef,
    innerBoxRef,
    focus,
  } = params;

  // Handle clipboard image pasting with Ctrl+V
  const handleClipboardPaste = useCallback(async () => {
    if (shortcutsHelpVisible) {
      setShortcutsHelpVisible(false);
    }
    try {
      await insertClipboardImageReference(config, buffer);
      await pastePlainTextToBuffer(settings, stdout, buffer);
    } catch (error) {
      debugLogger.error('Error handling paste:', error);
    }
  }, [buffer, config, stdout, settings, shortcutsHelpVisible, setShortcutsHelpVisible]);

  useMouseClick(
    innerBoxRef,
    (_event, relX, relY) => {
      setSuppressCompletion(true);
      if (isEmbeddedShellFocused) {
        setEmbeddedShellFocused(false);
      }
      const currentScrollTop = Math.round(
        listRef.current?.getScrollState().scrollTop ?? buffer.visualScrollRow,
      );
      const visualRow = currentScrollTop + relY;
      buffer.moveToVisualPosition(visualRow, relX);
    },
    { isActive: focus },
  );

  const isAlternateBuffer = useAlternateBuffer();

  // Double-click to expand/collapse paste placeholders
  useMouseClick(
    innerBoxRef,
    (_event, relX, relY) => {
      if (!isAlternateBuffer) return;

      const currentScrollTop = Math.round(
        listRef.current?.getScrollState().scrollTop ?? buffer.visualScrollRow,
      );
      const visualLine = buffer.allVisualLines[currentScrollTop + relY];
      if (!visualLine) return;

      // Even if we click past the end of the line, we might want to collapse an expanded paste
      const isPastEndOfLine = relX >= stringWidth(visualLine);

      const logicalPos = isPastEndOfLine
        ? null
        : buffer.getLogicalPositionFromVisual(currentScrollTop + relY, relX);

      // Check for paste placeholder (collapsed state)
      if (logicalPos) {
        const transform = getTransformUnderCursor(
          logicalPos.row,
          logicalPos.col,
          buffer.transformationsByLine,
          { includeEdge: true },
        );
        if (transform?.type === 'paste' && transform.id) {
          buffer.togglePasteExpansion(transform.id, logicalPos.row, logicalPos.col);
          return;
        }
      }

      // If we didn't click a placeholder to expand, check if we are inside or after
      // an expanded paste region and collapse it.
      const visualRow = currentScrollTop + relY;
      const mapEntry = buffer.visualToLogicalMap.at(visualRow);
      const row = mapEntry ? mapEntry[0] : visualRow;
      const expandedId = buffer.getExpandedPasteAtLine(row);
      if (expandedId) {
        buffer.togglePasteExpansion(
          expandedId,
          row,
          logicalPos?.col ?? relX, // Fallback to relX if past end of line
        );
      }
    },
    { isActive: focus, name: 'double-click' },
  );

  useMouse(
    (event: MouseEvent) => {
      if (event.name === 'right-release') {
        setSuppressCompletion(false);

        handleClipboardPaste();
      }
    },
    { isActive: focus },
  );

  return { handleClipboardPaste };
}

function useInputPromptKeypress(
  deps: Omit<InputHandlerContext, 'isGenerating'> & {
    handleClipboardPaste: () => Promise<void>;
    hasUserNavigatedSuggestions: React.MutableRefObject<boolean>;
    isEmbeddedShellFocused: boolean | undefined;
    copyModeEnabled: boolean;
  },
) {
  const {
    buffer,
    completion,
    keyMatchers,
    shellModeActive,
    shouldShowSuggestions,
    isShellSuggestionsVisible,
    reverseSearchActive,
    commandSearchActive,
    streamingState,
    focus,
    shortcutsHelpVisible,
    setShortcutsHelpVisible,
    setSuppressCompletion,
    setForceShowShellSuggestions,
    hasUserNavigatedSuggestions,
    setExpandedSuggestionIndex,
    tryLoadQueuedMessages,
    inputHistory,
    shellHistory,
    kittyProtocol,
    pasteTimeoutRef,
    recentUnsafePasteTime,
    setRecentUnsafePasteTime,
    handleClipboardPaste,
    isEmbeddedShellFocused,
    copyModeEnabled,
  } = deps;

  const handleInput = useCallback(
    (key: Key) => {
      const kc = classifyKey(
        key,
        keyMatchers,
        buffer,
        shellModeActive,
        shouldShowSuggestions,
        completion,
        isShellSuggestionsVisible,
        reverseSearchActive,
        commandSearchActive,
        streamingState,
      );

      if (!kc.isSuggestionsNav) {
        setSuppressCompletion(
          kc.isHistoryNav || kc.isCursorMovement || keyMatchers[Command.ESCAPE](key),
        );
        hasUserNavigatedSuggestions.current = false;

        if (key.name !== 'tab') {
          setForceShowShellSuggestions(false);
        }
      }

      if (!focus && key.name !== 'paste') {
        return false;
      }

      if (shortcutsHelpVisible && key.name === 'escape') {
        setShortcutsHelpVisible(false);
        return true;
      }

      const ctx: InputHandlerContext = {
        ...deps,
        isGenerating: kc.isGenerating,
      };

      if (handleQueueMessageKey(ctx, key, kc.isQueueMessageKey, kc.hasTabCompletionInteraction)) {
        return true;
      }

      if (handleTabKey(ctx, kc.isPlainTab)) {
        return true;
      }

      if (
        handlePasteKey(
          ctx,
          key,
          kittyProtocol,
          pasteTimeoutRef,
          setRecentUnsafePasteTime,
          recentUnsafePasteTime,
        )
      ) {
        return true;
      }

      if (handleShortcutsAndInitialKeys(ctx, key, setExpandedSuggestionIndex)) {
        return true;
      }

      if (
        handleInputKeyDispatch(
          ctx,
          key,
          setExpandedSuggestionIndex,
          hasUserNavigatedSuggestions,
          recentUnsafePasteTime,
          kc.isHistoryUp,
          kc.isHistoryDown,
          tryLoadQueuedMessages,
          inputHistory,
          shellHistory,
          handleClipboardPaste,
        )
      ) {
        return true;
      }

      return false;
    },
    [
      deps,
      buffer,
      commandSearchActive,
      completion,
      focus,
      handleClipboardPaste,
      hasUserNavigatedSuggestions,
      inputHistory,
      isShellSuggestionsVisible,
      keyMatchers,
      kittyProtocol,
      pasteTimeoutRef,
      recentUnsafePasteTime,
      reverseSearchActive,
      setExpandedSuggestionIndex,
      setForceShowShellSuggestions,
      setRecentUnsafePasteTime,
      setShortcutsHelpVisible,
      setSuppressCompletion,
      shellHistory,
      shellModeActive,
      shortcutsHelpVisible,
      shouldShowSuggestions,
      streamingState,
      tryLoadQueuedMessages,
    ],
  );
  useKeypress(handleInput, {
    isActive: !isEmbeddedShellFocused && !copyModeEnabled,
    priority: true,
  });

  return { handleInput };
}

function useInputPromptView(params: {
  buffer: TextBuffer;
  completion: ReturnType<typeof useCommandCompletion>;
  activeCompletion:
    ReturnType<typeof useCommandCompletion> | ReturnType<typeof useReverseSearchCompletion>;
  shouldShowSuggestions: boolean;
  inputWidth: number;
  focus: boolean;
  listRef: React.RefObject<ScrollableListRef<ScrollableItem> | null>;
  onSuggestionsVisibilityChange?: (visible: boolean) => void;
}) {
  const {
    buffer,
    completion,
    activeCompletion,
    shouldShowSuggestions,
    inputWidth,
    focus,
    listRef,
    onSuggestionsVisibilityChange,
  } = params;

  const [cursorVisualRowAbsolute, cursorVisualColAbsolute] = buffer.visualCursor;

  const getGhostTextLines = useCallback(() => {
    if (
      !completion.promptCompletion.text ||
      !buffer.text ||
      !completion.promptCompletion.text.startsWith(buffer.text)
    ) {
      return { inlineGhost: '', additionalLines: [] };
    }

    const ghostSuffix = completion.promptCompletion.text.slice(buffer.text.length);
    if (!ghostSuffix) {
      return { inlineGhost: '', additionalLines: [] };
    }

    const currentLogicalLine = buffer.lines[buffer.cursor[0]] || '';
    const cursorCol = buffer.cursor[1];

    const textBeforeCursor = cpSlice(currentLogicalLine, 0, cursorCol);
    const usedWidth = stringWidth(textBeforeCursor);
    const remainingWidth = Math.max(0, inputWidth - usedWidth);

    const ghostTextLinesRaw = ghostSuffix.split('\n');
    const firstLineRaw = ghostTextLinesRaw.shift() || '';

    const inlineGhost = computeInlineGhost(firstLineRaw, remainingWidth);
    const remainingGhostText = computeGhostRemainder(
      firstLineRaw,
      remainingWidth,
      ghostTextLinesRaw,
    );
    const additionalLines = computeAdditionalLines(remainingGhostText, inputWidth);

    return { inlineGhost, additionalLines };
  }, [completion.promptCompletion.text, buffer.text, buffer.lines, buffer.cursor, inputWidth]);

  const { inlineGhost, additionalLines } = getGhostTextLines();

  const scrollableData = useMemo(() => {
    const items: ScrollableItem[] = buffer.allVisualLines.map((lineText, index) => ({
      type: 'visualLine',
      lineText,
      absoluteVisualIdx: index,
    }));

    additionalLines.forEach((ghostLine, index) => {
      items.push({
        type: 'ghostLine',
        ghostLine,
        index,
      });
    });

    return items;
  }, [buffer.allVisualLines, additionalLines]);

  const renderItem = useCallback(
    ({ item }: { item: ScrollableItem; index: number }) =>
      renderPromptLineItem({
        item,
        buffer,
        focus,
        cursorVisualRowAbsolute,
        cursorVisualColAbsolute,
        showCursor: false,
        inlineGhost,
        inputWidth,
      }),
    [buffer, focus, cursorVisualRowAbsolute, cursorVisualColAbsolute, inlineGhost, inputWidth],
  );

  const prevCursorRef = useRef(buffer.visualCursor);
  const prevTextRef = useRef(buffer.text);

  // Effect to ensure cursor remains visible after interactions
  useEffect(() => {
    const cursorChanged = prevCursorRef.current !== buffer.visualCursor;
    const textChanged = prevTextRef.current !== buffer.text;

    prevCursorRef.current = buffer.visualCursor;
    prevTextRef.current = buffer.text;

    if (!cursorChanged && !textChanged) return;

    if (!listRef.current || !focus) return;
    const { scrollTop, innerHeight } = listRef.current.getScrollState();
    if (innerHeight === 0) return;

    const cursorVisualRow = buffer.visualCursor[0];
    const actualScrollTop = Math.round(scrollTop);

    // If cursor is out of the currently visible viewport...
    if (cursorVisualRow < actualScrollTop || cursorVisualRow >= actualScrollTop + innerHeight) {
      // Calculate minimal scroll to make it visible
      let newScrollTop = actualScrollTop;
      if (cursorVisualRow < actualScrollTop) {
        newScrollTop = cursorVisualRow;
      } else if (cursorVisualRow >= actualScrollTop + innerHeight) {
        newScrollTop = cursorVisualRow - innerHeight + 1;
      }

      listRef.current.scrollToIndex({ index: newScrollTop });
    }
  }, [buffer.visualCursor, buffer.text, focus, listRef]);

  const prevShowSuggestionsRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (onSuggestionsVisibilityChange && prevShowSuggestionsRef.current !== shouldShowSuggestions) {
      prevShowSuggestionsRef.current = shouldShowSuggestions;
      onSuggestionsVisibilityChange(shouldShowSuggestions);
    }
  }, [shouldShowSuggestions, onSuggestionsVisibilityChange]);

  return {
    cursorVisualRowAbsolute,
    cursorVisualColAbsolute,
    inlineGhost,
    additionalLines,
    scrollableData,
    renderItem,
    activeCompletion,
  };
}

function computeStatus(params: { shellModeActive: boolean; approvalMode: ApprovalMode }): {
  statusColor: string | undefined;
  statusText: string;
  showYoloStyling: boolean;
} {
  const { shellModeActive, approvalMode } = params;
  const showAutoAcceptStyling = !shellModeActive && approvalMode === ApprovalMode.AUTO_EDIT;
  const showYoloStyling = !shellModeActive && approvalMode === ApprovalMode.YOLO;
  const showPlanStyling = !shellModeActive && approvalMode === ApprovalMode.PLAN;

  if (shellModeActive) {
    return { statusColor: theme.ui.symbol, statusText: 'Shell mode', showYoloStyling };
  }
  if (showYoloStyling) {
    return { statusColor: theme.status.error, statusText: 'YOLO mode', showYoloStyling };
  }
  if (showPlanStyling) {
    return { statusColor: theme.status.success, statusText: 'Plan mode', showYoloStyling };
  }
  if (showAutoAcceptStyling) {
    return { statusColor: theme.status.warning, statusText: 'Accepting edits', showYoloStyling };
  }
  return { statusColor: undefined, statusText: '', showYoloStyling };
}

function renderScrollableLines(params: {
  buffer: TextBuffer;
  config: HiveConfig;
  focus: boolean;
  listRef: React.RefObject<ScrollableListRef<ScrollableItem> | null>;
  scrollableData: ScrollableItem[];
  renderItem: (info: { item: ScrollableItem; index: number }) => React.ReactElement;
  inputWidth: number;
  listBackgroundColor: string | undefined;
}): React.ReactElement {
  const {
    buffer,
    config,
    focus,
    listRef,
    scrollableData,
    renderItem,
    inputWidth,
    listBackgroundColor,
  } = params;

  if (!config.getUseTerminalBuffer()) {
    return (
      <>
        {scrollableData
          .slice(buffer.visualScrollRow, buffer.visualScrollRow + buffer.viewportHeight)
          .map((item, index) => {
            const actualIndex = buffer.visualScrollRow + index;
            const key =
              item.type === 'visualLine' ? `line-${item.absoluteVisualIdx}` : `ghost-${item.index}`;
            return <Fragment key={key}>{renderItem({ item, index: actualIndex })}</Fragment>;
          })}
      </>
    );
  }
  return (
    <ScrollableList
      ref={listRef}
      hasFocus={focus}
      data={scrollableData}
      renderItem={renderItem}
      estimatedItemHeight={() => 1}
      fixedItemHeight={true}
      keyExtractor={(item) =>
        item.type === 'visualLine' ? `line-${item.absoluteVisualIdx}` : `ghost-${item.index}`
      }
      width={inputWidth + SCROLLBAR_GUTTER_WIDTH}
      backgroundColor={listBackgroundColor}
      containerHeight={Math.min(buffer.viewportHeight, scrollableData.length)}
    />
  );
}

function renderTopBorder(params: {
  useLineFallback: boolean;
  useBackgroundColor: boolean;
  borderColor: string;
  terminalWidth: number;
}): React.ReactElement | null {
  const { useLineFallback, useBackgroundColor, borderColor, terminalWidth } = params;
  if (!useLineFallback && useBackgroundColor) {
    return null;
  }
  return (
    <Box
      borderStyle="round"
      borderTop={true}
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor={borderColor}
      width={terminalWidth}
      flexDirection="row"
      alignItems="flex-start"
      height={0}
    />
  );
}

function renderBottomBorder(params: {
  useLineFallback: boolean;
  useBackgroundColor: boolean;
  borderColor: string;
  terminalWidth: number;
}): React.ReactElement | null {
  const { useLineFallback, useBackgroundColor, borderColor, terminalWidth } = params;
  if (!useLineFallback && useBackgroundColor) {
    return null;
  }
  return (
    <Box
      borderStyle="round"
      borderTop={false}
      borderBottom={true}
      borderLeft={false}
      borderRight={false}
      borderColor={borderColor}
      width={terminalWidth}
      flexDirection="row"
      alignItems="flex-start"
      height={0}
    />
  );
}

function renderSuggestionsNode(params: {
  shouldShowSuggestions: boolean;
  activeCompletion:
    ReturnType<typeof useCommandCompletion> | ReturnType<typeof useReverseSearchCompletion>;
  suggestionsWidth: number;
  buffer: TextBuffer;
  completion: ReturnType<typeof useCommandCompletion>;
  reverseSearchActive: boolean;
  commandSearchActive: boolean;
  expandedSuggestionIndex: number;
}): React.ReactElement | null {
  const {
    shouldShowSuggestions,
    activeCompletion,
    suggestionsWidth,
    buffer,
    completion,
    reverseSearchActive,
    commandSearchActive,
    expandedSuggestionIndex,
  } = params;
  if (!shouldShowSuggestions) {
    return null;
  }
  return (
    <Box paddingRight={2}>
      <SuggestionsDisplay
        suggestions={activeCompletion.suggestions}
        activeIndex={activeCompletion.activeSuggestionIndex}
        isLoading={activeCompletion.isLoadingSuggestions}
        width={suggestionsWidth}
        scrollOffset={activeCompletion.visibleStartIndex}
        userInput={buffer.text}
        mode={computePromptMode({
          completionMode: completion.completionMode,
          text: buffer.text,
          reverseSearchActive,
          commandSearchActive,
        })}
        expandedIndex={expandedSuggestionIndex}
      />
    </Box>
  );
}

function renderInputBody(params: {
  buffer: TextBuffer;
  config: HiveConfig;
  focus: boolean;
  listRef: React.RefObject<ScrollableListRef<ScrollableItem> | null>;
  scrollableData: ScrollableItem[];
  renderItem: (info: { item: ScrollableItem; index: number }) => React.ReactElement;
  inputWidth: number;
  listBackgroundColor: string | undefined;
  statusColor: string | undefined;
  statusText: string;
  shellModeActive: boolean;
  reverseSearchActive: boolean;
  commandSearchActive: boolean;
  showYoloStyling: boolean;
  effectivePlaceholder: string;
  showCursor: boolean;
  innerBoxRef: React.RefObject<DOMElement | null>;
  useBackgroundColor: boolean;
}): React.ReactElement {
  const {
    buffer,
    config,
    focus,
    listRef,
    scrollableData,
    renderItem,
    inputWidth,
    listBackgroundColor,
    statusColor,
    statusText,
    shellModeActive,
    reverseSearchActive,
    commandSearchActive,
    showYoloStyling,
    effectivePlaceholder,
    showCursor,
    innerBoxRef,
    useBackgroundColor,
  } = params;

  return (
    <HalfLinePaddedBox
      backgroundBaseColor={theme.background.input}
      backgroundOpacity={1}
      useBackgroundColor={useBackgroundColor}
    >
      <Box flexGrow={1} flexDirection="row" paddingX={1}>
        <Text color={statusColor ?? theme.text.accent} aria-label={statusText || undefined}>
          {computePromptPrefix({
            shellModeActive,
            reverseSearchActive,
            commandSearchActive,
            showYoloStyling,
          })}{' '}
        </Text>
        <Box flexGrow={1} flexDirection="column" ref={innerBoxRef}>
          {buffer.text.length === 0 ? (
            renderPlaceholder(effectivePlaceholder, showCursor)
          ) : (
            <Box
              flexDirection="column"
              height={Math.min(buffer.viewportHeight, scrollableData.length)}
              width="100%"
            >
              {renderScrollableLines({
                buffer,
                config,
                focus,
                listRef,
                scrollableData,
                renderItem,
                inputWidth,
                listBackgroundColor,
              })}
            </Box>
          )}
        </Box>
      </Box>
    </HalfLinePaddedBox>
  );
}

function InputPromptView(params: {
  buffer: TextBuffer;
  config: HiveConfig;
  completion: ReturnType<typeof useCommandCompletion>;
  activeCompletion:
    ReturnType<typeof useCommandCompletion> | ReturnType<typeof useReverseSearchCompletion>;
  shouldShowSuggestions: boolean;
  suggestionsWidth: number;
  inputWidth: number;
  terminalWidth: number;
  expandedSuggestionIndex: number;
  reverseSearchActive: boolean;
  commandSearchActive: boolean;
  shellModeActive: boolean;
  focus: boolean;
  isShellFocused: boolean;
  isEmbeddedShellFocused: boolean | undefined;
  showCursor: boolean;
  effectivePlaceholder: string;
  innerBoxRef: React.RefObject<DOMElement | null>;
  listRef: React.RefObject<ScrollableListRef<ScrollableItem> | null>;
  suggestionsPosition: 'above' | 'below';
  scrollableData: ScrollableItem[];
  renderItem: (info: { item: ScrollableItem; index: number }) => React.ReactElement;
  approvalMode: ApprovalMode;
}) {
  const {
    buffer,
    config,
    completion,
    activeCompletion,
    shouldShowSuggestions,
    suggestionsWidth,
    inputWidth,
    terminalWidth,
    expandedSuggestionIndex,
    reverseSearchActive,
    commandSearchActive,
    shellModeActive,
    focus,
    isShellFocused,
    isEmbeddedShellFocused,
    showCursor,
    effectivePlaceholder,
    innerBoxRef,
    listRef,
    suggestionsPosition,
    scrollableData,
    renderItem,
    approvalMode,
  } = params;

  const useBackgroundColor = config.getUseBackgroundColor();
  const listBackgroundColor = !useBackgroundColor ? undefined : theme.background.input;
  const useLineFallback = !!process.env['NO_COLOR'];

  const { statusColor, statusText, showYoloStyling } = computeStatus({
    shellModeActive,
    approvalMode,
  });

  const borderColor =
    isShellFocused && !isEmbeddedShellFocused
      ? (statusColor ?? theme.ui.focus)
      : theme.border.default;

  const suggestionsNode = renderSuggestionsNode({
    shouldShowSuggestions,
    activeCompletion,
    suggestionsWidth,
    buffer,
    completion,
    reverseSearchActive,
    commandSearchActive,
    expandedSuggestionIndex,
  });

  return (
    <>
      {suggestionsPosition === 'above' && suggestionsNode}
      {renderTopBorder({ useLineFallback, useBackgroundColor, borderColor, terminalWidth })}
      {renderInputBody({
        buffer,
        config,
        focus,
        listRef,
        scrollableData,
        renderItem,
        inputWidth,
        listBackgroundColor,
        statusColor,
        statusText,
        shellModeActive,
        reverseSearchActive,
        commandSearchActive,
        showYoloStyling,
        effectivePlaceholder,
        showCursor,
        innerBoxRef,
        useBackgroundColor,
      })}
      {renderBottomBorder({ useLineFallback, useBackgroundColor, borderColor, terminalWidth })}
      {suggestionsPosition === 'below' && suggestionsNode}
    </>
  );
}

function useInputPromptEffects(params: {
  buffer: TextBuffer;
  showEscapePrompt: boolean;
  onEscapePromptChange?: (showPrompt: boolean) => void;
  pasteTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
}) {
  const { buffer, showEscapePrompt, onEscapePromptChange, pasteTimeoutRef } = params;

  useEffect(() => {
    appEvents.emit(AppEvent.ScrollToBottom);
  }, [buffer.text, buffer.cursor]);

  const prevShowEscapePromptRef = useRef<boolean | undefined>(undefined);
  // Notify parent component about escape prompt state changes
  useEffect(() => {
    if (onEscapePromptChange && prevShowEscapePromptRef.current !== showEscapePrompt) {
      prevShowEscapePromptRef.current = showEscapePrompt;
      onEscapePromptChange(showEscapePrompt);
    }
  }, [showEscapePrompt, onEscapePromptChange]);

  // Clear paste timeout on unmount
  useEffect(
    () => () => {
      if (pasteTimeoutRef.current) {
        clearTimeout(pasteTimeoutRef.current);
      }
    },
    [pasteTimeoutRef],
  );
}

function useInputPromptBaseStates(params: {
  buffer: TextBuffer;
  history: HistoryItem[];
  onSubmit: (value: string) => void;
  resetTurnBaseline: () => void;
  resetCompletionState: () => void;
}) {
  const { buffer, history, onSubmit, resetTurnBaseline, resetCompletionState } = params;

  const [suppressCompletion, setSuppressCompletion] = useState(false);
  const { handlePress: registerPlainTabPress, resetCount: resetPlainTabPress } =
    useRepeatedKeyPress({
      windowMs: DOUBLE_TAB_CLEAN_UI_TOGGLE_WINDOW_MS,
    });
  const [showEscapePrompt, setShowEscapePrompt] = useState(false);
  const { handlePress: handleEscPress, resetCount: resetEscapeState } = useRepeatedKeyPress({
    windowMs: 500,
    onRepeat: (count) => {
      if (count === 1) {
        setShowEscapePrompt(true);
      } else if (count === 2) {
        resetEscapeState();
        if (buffer.text.length > 0) {
          buffer.setText('');
          resetTurnBaseline();
          resetCompletionState();
        } else if (history.length > 0) {
          onSubmit('/rewind');
        } else {
          coreEvents.emitFeedback('info', 'Nothing to rewind to');
        }
      }
    },
    onReset: () => setShowEscapePrompt(false),
  });
  const [recentUnsafePasteTime, setRecentUnsafePasteTime] = useState<number | null>(null);
  const pasteTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const innerBoxRef = useRef<DOMElement>(null);
  const hasUserNavigatedSuggestions = useRef(false);
  const listRef = useRef<ScrollableListRef<ScrollableItem>>(null);

  const [reverseSearchActive, setReverseSearchActive] = useState(false);
  const [commandSearchActive, setCommandSearchActive] = useState(false);
  const [textBeforeReverseSearch, setTextBeforeReverseSearch] = useState('');
  const [cursorPosition, setCursorPosition] = useState<[number, number]>([0, 0]);
  const [expandedSuggestionIndex, setExpandedSuggestionIndex] = useState<number>(-1);

  return {
    suppressCompletion,
    setSuppressCompletion,
    registerPlainTabPress,
    resetPlainTabPress,
    showEscapePrompt,
    setShowEscapePrompt,
    handleEscPress,
    resetEscapeState,
    recentUnsafePasteTime,
    setRecentUnsafePasteTime,
    pasteTimeoutRef,
    innerBoxRef,
    hasUserNavigatedSuggestions,
    listRef,
    reverseSearchActive,
    setReverseSearchActive,
    commandSearchActive,
    setCommandSearchActive,
    textBeforeReverseSearch,
    setTextBeforeReverseSearch,
    cursorPosition,
    setCursorPosition,
    expandedSuggestionIndex,
    setExpandedSuggestionIndex,
  };
}

function useInputPromptBehavior(params: {
  props: Omit<InputPromptProps, 'commandContext' | 'approvalMode' | 'suggestionsPosition'>;
  suggestionsPosition: 'above' | 'below';
  inputState: ReturnType<typeof useInputState>;
  uiState: {
    terminalWidth: number;
    activePtyId: number | undefined;
    backgroundTasks: Map<number, unknown>;
    backgroundTaskHeight: number;
    shortcutsHelpVisible: boolean;
  };
  baseStates: ReturnType<typeof useInputPromptBaseStates>;
  completions: ReturnType<typeof useInputPromptCompletions>;
  stdout: NodeJS.WriteStream;
  settings: ReturnType<typeof useSettings>['merged'];
  isShellFocused: boolean;
  resetTurnBaseline: () => void;
  kittyProtocol: { enabled: boolean };
  keyMatchers: ReturnType<typeof useKeyMatchers>;
  isHelpDismissKey: (key: Key) => boolean;
  setEmbeddedShellFocused: (v: boolean) => void;
  setShortcutsHelpVisible: (v: boolean) => void;
  toggleCleanUiDetailsVisible: () => void;
  focus: boolean;
  approvalMode: ApprovalMode;
  showCursor: boolean;
}) {
  const {
    props,
    suggestionsPosition,
    inputState,
    uiState,
    baseStates,
    completions,
    stdout,
    settings,
    isShellFocused,
    resetTurnBaseline,
    kittyProtocol,
    keyMatchers,
    isHelpDismissKey,
    setEmbeddedShellFocused,
    setShortcutsHelpVisible,
    toggleCleanUiDetailsVisible,
    focus,
    approvalMode,
    showCursor,
  } = params;
  const { buffer, userMessages, shellModeActive, copyModeEnabled, inputWidth, suggestionsWidth } =
    inputState;
  const { terminalWidth, shortcutsHelpVisible } = uiState;
  const {
    suppressCompletion,
    setSuppressCompletion,
    handleEscPress,
    pasteTimeoutRef,
    innerBoxRef,
    hasUserNavigatedSuggestions,
    listRef,
    reverseSearchActive,
    commandSearchActive,
    expandedSuggestionIndex,
  } = baseStates;
  const {
    shellHistory,
    completion,
    resetCompletionState,
    resetReverseSearchCompletionState,
    resetCommandSearchCompletionState,
    activeCompletion,
    shouldShowSuggestions,
    isShellSuggestionsVisible,
    effectivePlaceholder,
  } = completions;
  const {
    onSubmit,
    config,
    slashCommands,
    onSuggestionsVisibilityChange,
    streamingState,
    popAllMessages,
  } = props;
  const { inputHistory, handleSubmit, tryLoadQueuedMessages } = useInputPromptSubmit({
    buffer,
    userMessages,
    shellModeActive,
    shellHistory,
    completion,
    isShellSuggestionsVisible,
    onSubmit,
    resetTurnBaseline,
    resetCompletionState,
    resetReverseSearchCompletionState,
    resetCommandSearchCompletionState,
    setSuppressCompletion,
    suppressCompletion,
    setExpandedSuggestionIndex: baseStates.setExpandedSuggestionIndex,
    streamingState,
    setQueueErrorMessage: props.setQueueErrorMessage,
    slashCommands,
    popAllMessages,
  });
  const { handleClipboardPaste } = useInputPromptPaste({
    buffer,
    config,
    stdout,
    settings,
    shortcutsHelpVisible,
    setShortcutsHelpVisible,
    setSuppressCompletion,
    isEmbeddedShellFocused: props.isEmbeddedShellFocused,
    setEmbeddedShellFocused,
    listRef,
    innerBoxRef,
    focus,
  });
  useInputPromptKeypress({
    ...inputState,
    ...uiState,
    ...baseStates,
    ...completions,
    setShellModeActive: props.setShellModeActive,
    onClearScreen: props.onClearScreen,
    setBannerVisible: props.setBannerVisible,
    setQueueErrorMessage: props.setQueueErrorMessage,
    onQueueMessage: props.onQueueMessage,
    vimHandleInput: props.vimHandleInput,
    vimEnabled: !!props.vimEnabled,
    vimMode: props.vimMode || 'INSERT',
    isEmbeddedShellFocused: props.isEmbeddedShellFocused,
    streamingState: props.streamingState,
    resetTurnBaseline,
    keyMatchers,
    isHelpDismissKey,
    setEmbeddedShellFocused,
    setShortcutsHelpVisible,
    toggleCleanUiDetailsVisible,
    settings,
    kittyProtocol,
    focus,
    handleEscPress,
    registerPlainTabPress: baseStates.registerPlainTabPress,
    resetPlainTabPress: baseStates.resetPlainTabPress,
    recentUnsafePasteTime: baseStates.recentUnsafePasteTime,
    setRecentUnsafePasteTime: baseStates.setRecentUnsafePasteTime,
    pasteTimeoutRef,
    hasUserNavigatedSuggestions,
    copyModeEnabled: !!copyModeEnabled,
    activePtyId: uiState.activePtyId !== undefined ? uiState.activePtyId.toString() : undefined,
    handleSubmit,
    handleClipboardPaste,
    tryLoadQueuedMessages,
    inputHistory,
    shellHistory,
  });

  const view = useInputPromptView({
    buffer,
    completion,
    activeCompletion,
    shouldShowSuggestions,
    inputWidth,
    focus,
    listRef,
    onSuggestionsVisibilityChange,
  });

  return (
    <InputPromptView
      buffer={buffer}
      config={config}
      completion={completion}
      activeCompletion={view.activeCompletion}
      shouldShowSuggestions={shouldShowSuggestions}
      suggestionsWidth={suggestionsWidth}
      inputWidth={inputWidth}
      terminalWidth={terminalWidth}
      expandedSuggestionIndex={expandedSuggestionIndex}
      reverseSearchActive={reverseSearchActive}
      commandSearchActive={commandSearchActive}
      shellModeActive={shellModeActive}
      focus={focus}
      isShellFocused={isShellFocused}
      isEmbeddedShellFocused={props.isEmbeddedShellFocused}
      showCursor={showCursor}
      effectivePlaceholder={effectivePlaceholder}
      innerBoxRef={innerBoxRef}
      listRef={listRef}
      suggestionsPosition={suggestionsPosition}
      scrollableData={view.scrollableData}
      renderItem={view.renderItem}
      approvalMode={approvalMode}
    />
  );
}

export const InputPrompt: React.FC<InputPromptProps> = ({
  onSubmit,
  onClearScreen,
  config,
  slashCommands,
  commandContext,
  placeholder = '  Type your message or @path/to/file',
  focus = true,
  setShellModeActive,
  approvalMode,
  onEscapePromptChange,
  onSuggestionsVisibilityChange,
  vimHandleInput,
  vimEnabled,
  vimMode,
  isEmbeddedShellFocused,
  setQueueErrorMessage,
  streamingState,
  popAllMessages,
  onQueueMessage,
  suggestionsPosition = 'below',
  setBannerVisible,
}) => {
  const inputState = useInputState();
  const { buffer, shellModeActive, copyModeEnabled } = inputState;
  const isHelpDismissKey = useIsHelpDismissKey();
  const keyMatchers = useKeyMatchers();
  const { stdout } = useStdout();
  const { merged: settings } = useSettings();
  const kittyProtocol = useKittyKeyboardProtocol();
  const isShellFocused = useShellFocusState();
  const { setEmbeddedShellFocused, setShortcutsHelpVisible, toggleCleanUiDetailsVisible } =
    useUIActions();
  const {
    terminalWidth,
    activePtyId,
    history,
    backgroundTasks,
    backgroundTaskHeight,
    shortcutsHelpVisible,
  } = useUIState();
  const uiState = {
    terminalWidth,
    activePtyId,
    backgroundTasks,
    backgroundTaskHeight,
    shortcutsHelpVisible,
  };

  const resetTurnBaseline = useCallback(() => {}, []);
  const resetCompletionStateRef = useRef<() => void>(() => {});

  const baseStates = useInputPromptBaseStates({
    buffer,
    history,
    onSubmit,
    resetTurnBaseline,
    resetCompletionState: resetCompletionStateRef.current,
  });
  const { suppressCompletion, showEscapePrompt, pasteTimeoutRef } = baseStates;

  const completions = useInputPromptCompletions({
    buffer,
    config,
    slashCommands,
    commandContext,
    suppressCompletion,
    shellModeActive,
    reverseSearchActive: baseStates.reverseSearchActive,
    commandSearchActive: baseStates.commandSearchActive,
    userMessages: inputState.userMessages,
    placeholder,
  });
  const { resetCompletionState } = completions;
  resetCompletionStateRef.current = resetCompletionState;

  const showCursor = focus && isShellFocused && !isEmbeddedShellFocused && !copyModeEnabled;

  useInputPromptEffects({
    buffer,
    showEscapePrompt,
    onEscapePromptChange,
    pasteTimeoutRef,
  });

  return useInputPromptBehavior({
    props: {
      onSubmit,
      onClearScreen,
      config,
      slashCommands,
      setShellModeActive,
      onSuggestionsVisibilityChange,
      vimHandleInput,
      vimEnabled,
      vimMode,
      isEmbeddedShellFocused,
      setQueueErrorMessage,
      streamingState,
      popAllMessages,
      onQueueMessage,
      setBannerVisible,
    },
    suggestionsPosition,
    inputState,
    uiState,
    baseStates,
    completions,
    stdout,
    settings,
    isShellFocused,
    resetTurnBaseline,
    kittyProtocol,
    keyMatchers,
    isHelpDismissKey,
    setEmbeddedShellFocused,
    setShortcutsHelpVisible,
    toggleCleanUiDetailsVisible,
    focus,
    approvalMode,
    showCursor,
  });
};
