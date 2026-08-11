/**
 * @license
 * Copyright 2025 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { Colors } from '../colors.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useKeypress } from '../hooks/useKeypress.js';
import path from 'node:path';
import { HiveConfig } from '../../config/hiveConfig.js';
import type { SessionInfo } from '../../utils/sessionUtils.js';

import type {
  SessionSortOrder,
  SessionBrowserProps,
  SessionBrowserState,
} from './SessionBrowser/types.js';
export type { SessionSortOrder, SessionBrowserProps, SessionBrowserState };

const SESSIONS_PER_PAGE = 20;
// Approximate total width reserved for non-message columns and separators
// (prefix, index, message count, age, pipes, and padding) in a session row.
// If the SessionItem layout changes, update this accordingly.
const FIXED_SESSION_COLUMNS_WIDTH = 30;

import {
  SearchModeDisplay,
  NavigationHelpDisplay,
  NoResultsDisplay,
} from './SessionBrowser/SessionBrowserNav.js';
import { SessionListHeader } from './SessionBrowser/SessionListHeader.js';
import { SessionBrowserLoading } from './SessionBrowser/SessionBrowserLoading.js';
import { SessionBrowserError } from './SessionBrowser/SessionBrowserError.js';
import { SessionBrowserEmpty } from './SessionBrowser/SessionBrowserEmpty.js';
import { sortSessions, filterSessions } from './SessionBrowser/utils.js';

/**
 * Table header component with column labels and scroll indicators.
 */
const SessionTableHeader = ({ state }: { state: SessionBrowserState }): React.JSX.Element => (
  <Box flexDirection="row" marginTop={1}>
    <Text>{state.scrollOffset > 0 ? <Text>▲ </Text> : '  '}</Text>

    <Box width={5} flexShrink={0}>
      <Text color={Colors.Gray} bold>
        Index
      </Text>
    </Box>
    <Text color={Colors.Gray}> │ </Text>
    <Box width={4} flexShrink={0}>
      <Text color={Colors.Gray} bold>
        Msgs
      </Text>
    </Box>
    <Text color={Colors.Gray}> │ </Text>
    <Box width={4} flexShrink={0}>
      <Text color={Colors.Gray} bold>
        Age
      </Text>
    </Box>
    <Text color={Colors.Gray}> │ </Text>
    <Box flexShrink={0}>
      <Text color={Colors.Gray} bold>
        {state.searchQuery ? 'Match' : 'Name'}
      </Text>
    </Box>
  </Box>
);

/**
 * Match snippet display component for search results.
 */
const MatchSnippetDisplay = ({
  session,
  textColor,
}: {
  session: SessionInfo;
  textColor: (color?: string) => string;
}): React.JSX.Element | null => {
  if (!session.matchSnippets || session.matchSnippets.length === 0) {
    return null;
  }

  const firstMatch = session.matchSnippets[0];
  const rolePrefix = firstMatch.role === 'user' ? 'You:   ' : 'Hive:  ';
  const roleColor = textColor(firstMatch.role === 'user' ? Colors.AccentGreen : Colors.AccentBlue);

  return (
    <>
      <Text color={roleColor} bold>
        {rolePrefix}{' '}
      </Text>
      {firstMatch.before}
      <Text color={textColor(Colors.AccentRed)} bold>
        {firstMatch.match}
      </Text>
      {firstMatch.after}
    </>
  );
};

/**
 * Individual session row component.
 */
const SessionItem = ({
  session,
  state,
  terminalWidth,
  formatRelativeTime,
}: {
  session: SessionInfo;
  state: SessionBrowserState;
  terminalWidth: number;
  formatRelativeTime: (dateString: string, style: 'short' | 'long') => string;
}): React.JSX.Element => {
  const originalIndex = state.startIndex + state.visibleSessions.indexOf(session);
  const isActive = originalIndex === state.activeIndex;
  const isDisabled = session.isCurrentSession;
  const textColor = (c: string = Colors.Foreground) => {
    if (isDisabled) {
      return Colors.Gray;
    }
    return isActive ? theme.ui.focus : c;
  };

  const prefix = isActive ? '❯ ' : '  ';
  let additionalInfo = '';
  let matchDisplay = null;

  // Add "(current)" label for the current session
  if (session.isCurrentSession) {
    additionalInfo = ' (current)';
  }

  // Show match snippets if searching and matches exist
  if (state.searchQuery && session.matchSnippets && session.matchSnippets.length > 0) {
    matchDisplay = <MatchSnippetDisplay session={session} textColor={textColor} />;

    if (session.matchCount && session.matchCount > 1) {
      additionalInfo += ` (+${session.matchCount - 1} more)`;
    }
  }

  // Reserve a few characters for metadata like " (current)" so the name doesn't wrap awkwardly.
  const reservedForMeta = additionalInfo ? additionalInfo.length + 1 : 0;
  const availableMessageWidth = Math.max(
    20,
    terminalWidth - FIXED_SESSION_COLUMNS_WIDTH - reservedForMeta,
  );

  let truncatedMessage: React.ReactNode;
  if (matchDisplay) {
    truncatedMessage = matchDisplay;
  } else if (session.displayName.length === 0) {
    truncatedMessage = (
      <Text color={textColor(Colors.Gray)} dimColor>
        (No messages)
      </Text>
    );
  } else if (session.displayName.length > availableMessageWidth) {
    truncatedMessage = session.displayName.slice(0, availableMessageWidth - 1) + '…';
  } else {
    truncatedMessage = session.displayName;
  }

  return (
    <Box flexDirection="row" backgroundColor={isActive ? theme.background.focus : undefined}>
      <Text color={textColor()} dimColor={isDisabled}>
        {prefix}
      </Text>
      <Box width={5}>
        <Text color={textColor()} dimColor={isDisabled}>
          #{originalIndex + 1}
        </Text>
      </Box>
      <Text color={textColor(Colors.Gray)} dimColor={isDisabled}>
        {' '}
        │{' '}
      </Text>
      <Box width={4}>
        <Text color={textColor()} dimColor={isDisabled}>
          {session.messageCount}
        </Text>
      </Box>
      <Text color={textColor(Colors.Gray)} dimColor={isDisabled}>
        {' '}
        │{' '}
      </Text>
      <Box width={4}>
        <Text color={textColor()} dimColor={isDisabled}>
          {formatRelativeTime(session.lastUpdated, 'short')}
        </Text>
      </Box>
      <Text color={textColor(Colors.Gray)} dimColor={isDisabled}>
        {' '}
        │{' '}
      </Text>
      <Box flexGrow={1}>
        <Text color={textColor(Colors.Comment)} dimColor={isDisabled}>
          {truncatedMessage}
          {additionalInfo && (
            <Text color={textColor(Colors.Gray)} dimColor bold={false}>
              {additionalInfo}
            </Text>
          )}
        </Text>
      </Box>
    </Box>
  );
};

/**
 * Session list container component.
 */
const SessionList = ({
  state,
  formatRelativeTime,
}: {
  state: SessionBrowserState;
  formatRelativeTime: (dateString: string, style: 'short' | 'long') => string;
}): React.JSX.Element => (
  <Box flexDirection="column">
    {/* Table Header */}
    <Box flexDirection="column">
      {!state.isSearchMode && <NavigationHelpDisplay />}
      <SessionTableHeader state={state} />
    </Box>

    {state.visibleSessions.map((session) => (
      <SessionItem
        key={session.id}
        session={session}
        state={state}
        terminalWidth={state.terminalWidth}
        formatRelativeTime={formatRelativeTime}
      />
    ))}

    <Text color={Colors.Gray}>
      {state.endIndex < state.totalSessions ? <>▼</> : <Text dimColor>▼</Text>}
    </Text>
  </Box>
);

/**
 * Hook to manage all SessionBrowser state.
 */
export const useSessionBrowserState = (
  initialSessions: SessionInfo[] = [],
  initialLoading = true,
  initialError: string | null = null,
): SessionBrowserState => {
  const { columns: terminalWidth } = useTerminalSize();
  const [sessions, setSessions] = useState<SessionInfo[]>(initialSessions);
  const [loading, setLoading] = useState(initialLoading);
  const [error, setError] = useState<string | null>(initialError);
  const [activeIndex, setActiveIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [sortOrder, setSortOrder] = useState<'date' | 'messages' | 'name'>('date');
  const [sortReverse, setSortReverse] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [hasLoadedFullContent, setHasLoadedFullContent] = useState(false);
  const loadingFullContentRef = useRef(false);

  const filteredAndSortedSessions = useMemo(() => {
    const filtered = filterSessions(sessions, searchQuery);
    return sortSessions(filtered, sortOrder, sortReverse);
  }, [sessions, searchQuery, sortOrder, sortReverse]);

  // Reset full content flag when search is cleared
  useEffect(() => {
    if (!searchQuery) {
      setHasLoadedFullContent(false);
      loadingFullContentRef.current = false;
    }
  }, [searchQuery]);

  const totalSessions = filteredAndSortedSessions.length;
  const startIndex = scrollOffset;
  const endIndex = Math.min(scrollOffset + SESSIONS_PER_PAGE, totalSessions);
  const visibleSessions = filteredAndSortedSessions.slice(startIndex, endIndex);
  const { rows: terminalHeight } = useTerminalSize();

  const state: SessionBrowserState = {
    terminalHeight,
    sessions,
    setSessions,
    loading,
    setLoading,
    error,
    setError,
    activeIndex,
    setActiveIndex,
    scrollOffset,
    setScrollOffset,
    searchQuery,
    setSearchQuery,
    isSearchMode,
    setIsSearchMode,
    hasLoadedFullContent,
    setHasLoadedFullContent,
    sortOrder,
    setSortOrder,
    sortReverse,
    setSortReverse,
    terminalWidth,
    filteredAndSortedSessions,
    totalSessions,
    startIndex,
    endIndex,
    visibleSessions,
  };

  return state;
};

/**
 * Hook to load sessions on mount.
 */
const useLoadSessions = (config: HiveConfig, state: SessionBrowserState) => {
  const {
    setSessions,
    setLoading,
    setError,
    isSearchMode,
    hasLoadedFullContent,
    setHasLoadedFullContent,
  } = state;

  useEffect(() => {
    const loadSessions = async () => {
      try {
        const chatsDir = path.join(config.storage.getProjectTempDir(), 'chats');
        const sessionData = await getSessionFiles(chatsDir, config.getSessionId());
        setSessions(sessionData);
        setLoading(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load sessions');
        setLoading(false);
      }
    };

    loadSessions();
  }, [config, setSessions, setLoading, setError]);

  useEffect(() => {
    const loadFullContent = async () => {
      if (isSearchMode && !hasLoadedFullContent) {
        try {
          const chatsDir = path.join(config.storage.getProjectTempDir(), 'chats');
          const sessionData = await getSessionFiles(chatsDir, config.getSessionId(), {
            includeFullContent: true,
          });
          setSessions(sessionData);
          setHasLoadedFullContent(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load full session content');
        }
      }
    };

    loadFullContent();
  }, [isSearchMode, hasLoadedFullContent, config, setSessions, setHasLoadedFullContent, setError]);
};

/**
 * Hook to handle selection movement.
 */
export const useMoveSelection = (state: SessionBrowserState) => {
  const { totalSessions, activeIndex, scrollOffset, setActiveIndex, setScrollOffset } = state;

  return useCallback(
    (delta: number) => {
      const newIndex = Math.max(0, Math.min(totalSessions - 1, activeIndex + delta));
      setActiveIndex(newIndex);

      // Adjust scroll offset if needed
      if (newIndex < scrollOffset) {
        setScrollOffset(newIndex);
      } else if (newIndex >= scrollOffset + SESSIONS_PER_PAGE) {
        setScrollOffset(newIndex - SESSIONS_PER_PAGE + 1);
      }
    },
    [totalSessions, activeIndex, scrollOffset, setActiveIndex, setScrollOffset],
  );
};

/**
 * Hook to handle sort order cycling.
 */
export const useCycleSortOrder = (state: SessionBrowserState) => {
  const { sortOrder, setSortOrder } = state;

  return useCallback(() => {
    const orders: SessionSortOrder[] = ['date', 'messages', 'name'];
    const currentIndex = orders.indexOf(sortOrder);
    const nextIndex = (currentIndex + 1) % orders.length;
    setSortOrder(orders.at(nextIndex) ?? 'date');
  }, [sortOrder, setSortOrder]);
};

function handleSearchKey(
  key: { name?: string; sequence?: string; alt?: boolean; ctrl?: boolean; cmd?: boolean },
  state: SessionBrowserState,
): boolean {
  if (key.name === 'escape') {
    state.setIsSearchMode(false);
    state.setSearchQuery('');
    state.setActiveIndex(0);
    state.setScrollOffset(0);
    return true;
  }
  if (key.name === 'backspace') {
    state.setSearchQuery((prev) => prev.slice(0, -1));
    state.setActiveIndex(0);
    state.setScrollOffset(0);
    return true;
  }
  if (key.name === 'enter') {
    return true;
  }
  if (key.sequence && key.sequence.length === 1 && !key.alt && !key.ctrl && !key.cmd) {
    state.setSearchQuery((prev) => prev + key.sequence);
    state.setActiveIndex(0);
    state.setScrollOffset(0);
    return true;
  }
  return false;
}

function handleSessionActionKeys(
  key: { name?: string; sequence?: string },
  state: SessionBrowserState,
  cycleSortOrder: () => void,
  onExit: () => void,
  onDeleteSession: (session: SessionInfo) => Promise<void>,
): boolean {
  if (key.sequence === 's') {
    cycleSortOrder();
    return true;
  }
  if (key.sequence === 'r') {
    state.setSortReverse(!state.sortReverse);
    return true;
  }
  if (key.sequence === '/') {
    state.setIsSearchMode(true);
    return true;
  }
  if (key.sequence === 'q' || key.sequence === 'Q' || key.name === 'escape') {
    onExit();
    return true;
  }
  if (key.sequence === 'x' || key.sequence === 'X') {
    const selectedSession = state.filteredAndSortedSessions.at(state.activeIndex);
    if (selectedSession && !selectedSession.isCurrentSession) {
      onDeleteSession(selectedSession)
        .then(() => {
          state.setSessions(state.sessions.filter((s) => s.id !== selectedSession.id));
          if (state.activeIndex >= state.filteredAndSortedSessions.length - 1) {
            state.setActiveIndex(Math.max(0, state.filteredAndSortedSessions.length - 2));
          }
        })
        .catch((error) => {
          state.setError(
            `Failed to delete session: ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        });
    }
    return true;
  }
  return false;
}

function handleNavigationKey(
  key: { name?: string; sequence?: string },
  state: SessionBrowserState,
  cycleSortOrder: () => void,
  onResumeSession: (session: SessionInfo) => void,
  onDeleteSession: (session: SessionInfo) => Promise<void>,
  onExit: () => void,
  moveSelection: (delta: number) => void,
): boolean {
  if (key.sequence === 'g') {
    state.setActiveIndex(0);
    state.setScrollOffset(0);
    return true;
  }
  if (key.sequence === 'G') {
    state.setActiveIndex(state.totalSessions - 1);
    state.setScrollOffset(Math.max(0, state.totalSessions - SESSIONS_PER_PAGE));
    return true;
  }
  if (handleSessionActionKeys(key, state, cycleSortOrder, onExit, onDeleteSession)) {
    return true;
  }
  if (key.sequence === 'u') {
    moveSelection(-Math.round(SESSIONS_PER_PAGE / 2));
    return true;
  }
  if (key.sequence === 'd') {
    moveSelection(Math.round(SESSIONS_PER_PAGE / 2));
    return true;
  }
  const selectedSession = state.filteredAndSortedSessions.at(state.activeIndex);
  if (key.name === 'enter' && selectedSession) {
    if (!selectedSession.isCurrentSession) onResumeSession(selectedSession);
    return true;
  }
  if (key.name === 'up') {
    moveSelection(-1);
    return true;
  }
  if (key.name === 'down') {
    moveSelection(1);
    return true;
  }
  if (key.name === 'pageup') {
    moveSelection(-SESSIONS_PER_PAGE);
    return true;
  }
  if (key.name === 'pagedown') {
    moveSelection(SESSIONS_PER_PAGE);
    return true;
  }
  return false;
}

/**
 * Hook to handle SessionBrowser input.
 */
export const useSessionBrowserInput = (
  state: SessionBrowserState,
  moveSelection: (delta: number) => void,
  cycleSortOrder: () => void,
  onResumeSession: (session: SessionInfo) => void,
  onDeleteSession: (session: SessionInfo) => Promise<void>,
  onExit: () => void,
) => {
  useKeypress(
    (key) =>
      state.isSearchMode
        ? handleSearchKey(key, state)
        : handleNavigationKey(
            key,
            state,
            cycleSortOrder,
            onResumeSession,
            onDeleteSession,
            onExit,
            moveSelection,
          ),
    { isActive: true },
  );
};

export function SessionBrowserView({ state }: { state: SessionBrowserState }): React.JSX.Element {
  if (state.loading) {
    return <SessionBrowserLoading />;
  }

  if (state.error) {
    return <SessionBrowserError state={state} />;
  }

  if (state.sessions.length === 0) {
    return <SessionBrowserEmpty />;
  }
  return (
    <Box flexDirection="column" paddingX={1}>
      <SessionListHeader state={state} />

      {state.isSearchMode && <SearchModeDisplay state={state} />}

      {state.totalSessions === 0 ? (
        <NoResultsDisplay state={state} />
      ) : (
        <SessionList state={state} formatRelativeTime={formatRelativeTime} />
      )}
    </Box>
  );
}

export function SessionBrowser({
  config,
  onResumeSession,
  onDeleteSession,
  onExit,
}: SessionBrowserProps): React.JSX.Element {
  // Use all our custom hooks
  const state = useSessionBrowserState();
  useLoadSessions(config, state);
  const moveSelection = useMoveSelection(state);
  const cycleSortOrder = useCycleSortOrder(state);
  useSessionBrowserInput(
    state,
    moveSelection,
    cycleSortOrder,
    onResumeSession,
    onDeleteSession,
    onExit,
  );

  return <SessionBrowserView state={state} />;
}
