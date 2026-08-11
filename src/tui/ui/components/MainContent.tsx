/**
 * @license
 * Copyright 2025 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Static } from 'ink';
import { HistoryItemDisplay } from './HistoryItemDisplay.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useAppContext } from '../contexts/AppContext.js';
import { AppHeader } from './AppHeader.js';

import { useAlternateBuffer } from '../hooks/useAlternateBuffer.js';
import { useConfig } from '../contexts/ConfigContext.js';
import { SCROLL_TO_ITEM_END, type VirtualizedListRef } from './shared/VirtualizedList.js';
import { ScrollableList } from './shared/ScrollableList.js';
import React, { useMemo, memo, useCallback, useEffect, useRef } from 'react';
import { MAX_HIVE_MESSAGE_LINES } from '../constants.js';
import { useConfirmingTool } from '../hooks/useConfirmingTool.js';
import { ToolConfirmationQueue } from './ToolConfirmationQueue.js';
import { appEvents, AppEvent } from '../../utils/events.js';

const MemoizedHistoryItemDisplay = memo(HistoryItemDisplay);

export interface HistoryItemLike {
  id?: number | string;
  type: string;
  [key: string]: unknown;
}

export interface ConfirmingToolLike {
  tool: {
    callId: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const buildPendingItems = (
  pendingHistoryItems: HistoryItemLike[],
  history: HistoryItemLike[],
  constrainHeight: boolean,
  availableTerminalHeight: number | undefined,
  mainAreaWidth: number,
  showConfirmationQueue: boolean,
  confirmingTool: unknown,
): React.ReactNode => (
  <Box flexDirection="column" key="pending-items-group">
    {pendingHistoryItems.map((item, i) => {
      const prevType = i === 0 ? history.at(-1)?.type : pendingHistoryItems.at(i - 1)?.type;
      const isFirstThinking = item.type === 'thinking' && prevType !== 'thinking';
      const isFirstAfterThinking = item.type !== 'thinking' && prevType === 'thinking';
      const isToolGroupBoundary =
        (item.type !== 'tool_group' && prevType === 'tool_group') ||
        (item.type === 'tool_group' && prevType !== 'tool_group');
      return (
        <HistoryItemDisplay
          key={`pending-${i}`}
          availableTerminalHeight={
            constrainHeight && availableTerminalHeight !== undefined
              ? availableTerminalHeight
              : undefined
          }
          terminalWidth={mainAreaWidth}
          item={item as unknown as Parameters<typeof HistoryItemDisplay>[0]['item']}
          isPending={true}
          isExpandable={true}
          isFirstThinking={isFirstThinking}
          isFirstAfterThinking={isFirstAfterThinking}
          isToolGroupBoundary={isToolGroupBoundary}
        />
      );
    })}
    {showConfirmationQueue && confirmingTool ? (
      <ToolConfirmationQueue
        key="confirmation-queue"
        confirmingTool={
          confirmingTool as unknown as Parameters<typeof ToolConfirmationQueue>[0]['confirmingTool']
        }
      />
    ) : null}
  </Box>
);

const augmentHistory = (history: HistoryItemLike[], lastUserPromptIndex: number) =>
  history.map((item, i) => {
    const prevItem = i > 0 ? history.at(i - 1) : undefined;
    const prevType = prevItem?.type;
    const isFirstThinking = item.type === 'thinking' && prevType !== 'thinking';
    const isFirstAfterThinking = item.type !== 'thinking' && prevType === 'thinking';
    const isToolGroupBoundary =
      (item.type !== 'tool_group' && prevType === 'tool_group') ||
      (item.type === 'tool_group' && prevType !== 'tool_group');
    return {
      item,
      isExpandable: i > lastUserPromptIndex,
      isFirstThinking,
      isFirstAfterThinking,
      isToolGroupBoundary,
    };
  });

const findLastUserPromptIndex = (history: Array<{ type: string }>): number => {
  for (let i = history.length - 1; i >= 0; i--) {
    const hItem = history.at(i);
    if (hItem?.type === 'user' || hItem?.type === 'user_shell') {
      return i;
    }
  }
  return -1;
};

export type VirtualizedDataItem =
  | { type: 'header' }
  | { type: 'history'; item: HistoryItemLike; element: React.ReactNode }
  | { type: 'pending' };

const buildScrollableList = (
  scrollableListRef: React.RefObject<VirtualizedListRef<VirtualizedDataItem> | null>,
  isEditorDialogOpen: boolean,
  embeddedShellFocused: boolean,
  terminalWidth: number,
  virtualizedData: VirtualizedDataItem[],
  renderItem: ({ item }: { item: VirtualizedDataItem }) => React.ReactNode,
  estimatedItemHeight: () => number,
  keyExtractor: (item: VirtualizedDataItem, index: number) => string,
  useTerminalBuffer: boolean,
  isAlternateBuffer: boolean,
  isStaticItem: (item: VirtualizedDataItem) => boolean,
  mouseMode: boolean,
): React.ReactNode => (
  <ScrollableList
    ref={scrollableListRef}
    hasFocus={!isEditorDialogOpen && !embeddedShellFocused}
    width={terminalWidth}
    data={virtualizedData}
    renderItem={
      renderItem as unknown as (info: {
        item: VirtualizedDataItem;
        index: number;
      }) => React.ReactElement
    }
    estimatedItemHeight={estimatedItemHeight}
    keyExtractor={keyExtractor}
    initialScrollIndex={SCROLL_TO_ITEM_END}
    initialScrollOffsetInIndex={SCROLL_TO_ITEM_END}
    renderStatic={useTerminalBuffer}
    isStaticItem={useTerminalBuffer ? isStaticItem : undefined}
    overflowToBackbuffer={useTerminalBuffer && !isAlternateBuffer}
    scrollbar={mouseMode}
  />
);

export const MainContent = () => {
  const { version } = useAppContext();
  const uiState = useUIState();
  const isAlternateBufferOrTerminalBuffer = useAlternateBuffer();
  const config = useConfig();
  const useTerminalBuffer = config.getUseTerminalBuffer();
  const isAlternateBuffer = config.getUseAlternateBuffer();

  const confirmingTool = useConfirmingTool();
  const showConfirmationQueue = confirmingTool !== null;
  const confirmingToolCallId = confirmingTool?.tool.callId;

  const scrollableListRef = useRef<VirtualizedListRef<VirtualizedDataItem>>(null);

  useEffect(() => {
    if (showConfirmationQueue) {
      scrollableListRef.current?.scrollToEnd();
    }
  }, [showConfirmationQueue, confirmingToolCallId]);

  useEffect(() => {
    const handleScroll = () => {
      scrollableListRef.current?.scrollToEnd();
    };
    appEvents.on(AppEvent.ScrollToBottom, handleScroll);
    return () => {
      appEvents.off(AppEvent.ScrollToBottom, handleScroll);
    };
  }, []);

  const {
    pendingHistoryItems,
    mainAreaWidth,
    staticAreaMaxItemHeight,
    availableTerminalHeight,
    cleanUiDetailsVisible,
    mouseMode,
  } = uiState;
  const showHeaderDetails = cleanUiDetailsVisible;

  const lastUserPromptIndex = useMemo(
    () => findLastUserPromptIndex(uiState.history),
    [uiState.history],
  );

  const augmentedHistory = useMemo(
    () => augmentHistory(uiState.history, lastUserPromptIndex),
    [uiState.history, lastUserPromptIndex],
  );

  const historyItems = useMemo(
    () =>
      augmentedHistory.map(
        ({ item, isExpandable, isFirstThinking, isFirstAfterThinking, isToolGroupBoundary }) => (
          <MemoizedHistoryItemDisplay
            terminalWidth={mainAreaWidth}
            availableTerminalHeight={
              uiState.constrainHeight || !isExpandable ? staticAreaMaxItemHeight : undefined
            }
            availableTerminalHeightHive={MAX_HIVE_MESSAGE_LINES}
            key={item.id}
            item={item as unknown as Parameters<typeof HistoryItemDisplay>[0]['item']}
            isPending={false}
            commands={uiState.slashCommands}
            isExpandable={isExpandable}
            isFirstThinking={isFirstThinking}
            isFirstAfterThinking={isFirstAfterThinking}
            isToolGroupBoundary={isToolGroupBoundary}
          />
        ),
      ),
    [
      augmentedHistory,
      mainAreaWidth,
      staticAreaMaxItemHeight,
      uiState.slashCommands,
      uiState.constrainHeight,
    ],
  );

  const staticHistoryItems = useMemo(
    () => historyItems.slice(0, lastUserPromptIndex + 1),
    [historyItems, lastUserPromptIndex],
  );

  const lastResponseHistoryItems = useMemo(
    () => historyItems.slice(lastUserPromptIndex + 1),
    [historyItems, lastUserPromptIndex],
  );

  const pendingItems = useMemo(
    () =>
      buildPendingItems(
        pendingHistoryItems as HistoryItemLike[],
        uiState.history,
        uiState.constrainHeight,
        availableTerminalHeight,
        mainAreaWidth,
        showConfirmationQueue,
        confirmingTool,
      ),
    [
      pendingHistoryItems,
      uiState.constrainHeight,
      availableTerminalHeight,
      mainAreaWidth,
      showConfirmationQueue,
      confirmingTool,
      uiState.history,
    ],
  );

  const virtualizedData: VirtualizedDataItem[] = useMemo(
    () => [
      { type: 'header' as const },
      ...augmentedHistory.map((data, index) => ({
        type: 'history' as const,
        item: data.item,
        element: historyItems.at(index),
      })),
      { type: 'pending' as const },
    ],
    [augmentedHistory, historyItems],
  );

  const renderItem = useCallback(
    ({ item }: { item: VirtualizedDataItem }) => {
      if (item.type === 'header') {
        return <AppHeader key="app-header" version={version} showDetails={showHeaderDetails} />;
      } else if (item.type === 'history') {
        return item.element;
      } else {
        return pendingItems;
      }
    },
    [showHeaderDetails, version, pendingItems],
  );

  const estimatedItemHeight = useCallback(() => 100, []);

  const keyExtractor = useCallback((item: VirtualizedDataItem, index: number) => {
    if (item.type === 'header') return 'header';
    if (item.type === 'history') return (item.item.id ?? index).toString();
    return 'pending';
  }, []);

  const isStaticItem = useCallback((item: VirtualizedDataItem) => item.type === 'header', []);

  const scrollableList = useMemo(() => {
    if (!isAlternateBufferOrTerminalBuffer) return null;
    return buildScrollableList(
      scrollableListRef,
      uiState.isEditorDialogOpen,
      uiState.embeddedShellFocused,
      uiState.terminalWidth,
      virtualizedData,
      renderItem,
      estimatedItemHeight,
      keyExtractor,
      useTerminalBuffer,
      isAlternateBuffer,
      isStaticItem,
      mouseMode,
    );
  }, [
    isAlternateBufferOrTerminalBuffer,
    uiState.isEditorDialogOpen,
    uiState.embeddedShellFocused,
    uiState.terminalWidth,
    virtualizedData,
    renderItem,
    estimatedItemHeight,
    keyExtractor,
    useTerminalBuffer,
    isStaticItem,
    mouseMode,
    isAlternateBuffer,
  ]);

  if (!uiState.isConfigInitialized) {
    return null;
  }

  if (isAlternateBufferOrTerminalBuffer) {
    return scrollableList;
  }

  return (
    <>
      <Static
        key={uiState.historyRemountKey}
        items={[
          <AppHeader key="app-header" version={version} />,
          ...staticHistoryItems,
          ...lastResponseHistoryItems,
        ]}
      >
        {(item) => item}
      </Static>
      {pendingItems}
    </>
  );
};
