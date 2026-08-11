import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { ThoughtSummary, displayContentToString, parseThought } from '../utils/formatters.js';
import {
  CoreToolCallStatus,
  Kind,
  Part,
  ApprovalMode,
  RetryAttemptPayload,
  StreamingState,
  MessageType,
  HistoryItemWithoutId,
  IndividualToolCallDisplay,
  LoopDetectionConfirmationRequest,
  MessageSenderType,
  geminiPartsToContentParts,
  AgentEvent,
  AgentProtocol,
  Logger,
} from '../contexts/UIStateContext.js';
import { getErrorMessage, debugLogger } from '../../utils/errors.js';
import { getToolGroupBorderAppearance } from '../utils/borderStyles.js';
import { type BackgroundTask } from '../types/backgroundTask.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import { useSessionStats } from '../contexts/SessionContext.js';
import { useStateAndRef } from './useStateAndRef.js';
import { type MinimalTrackedToolCall } from './useTurnActivityMonitor.js';
import { useKeypress } from './useKeypress.js';

export interface UseAgentStreamOptions {
  agent?: AgentProtocol;
  addItem: UseHistoryManagerReturn['addItem'];
  onCancelSubmit: (shouldRestorePrompt?: boolean, clearBuffer?: boolean) => void;
  isShellFocused?: boolean;
  logger?: Logger | null;
}

function parsePtyId(pid: unknown, defaultPtyId?: number): number | undefined {
  if (typeof pid === 'number') return pid;
  if (typeof pid === 'string') return parseInt(pid, 10);
  return defaultPtyId;
}

function handleMessageEvent(
  event: AgentEvent,
  addItem: UseHistoryManagerReturn['addItem'],
  geminiMessageBufferRef: React.MutableRefObject<string>,
  userMessageTimestampRef: React.MutableRefObject<number>,
  setPendingHistoryItem: (item: HistoryItemWithoutId | null) => void,
  setThought: (thought: ThoughtSummary | null) => void,
): void {
  if (event.role !== 'agent' || !event.content) return;
  for (const part of event.content) {
    if (part.type === 'text') {
      geminiMessageBufferRef.current += part.text;
      addItem(
        { type: 'assistant', text: geminiMessageBufferRef.current },
        userMessageTimestampRef.current,
      );
      geminiMessageBufferRef.current = '';
      setPendingHistoryItem(null);
    } else if (part.type === 'thought') {
      setThought(parseThought(part.thought));
    }
  }
}

function handleToolRequestEvent(
  event: AgentEvent,
  setTrackedTools: React.Dispatch<React.SetStateAction<IndividualToolCallDisplay[]>>,
): void {
  const legacyState = event._meta?.legacyState;
  const isAwaitingApproval =
    legacyState?.status === 'awaiting_approval' || !!event.confirmationDetails;
  const newCall: IndividualToolCallDisplay = {
    callId: event.requestId ?? '',
    name: legacyState?.displayName ?? event.name ?? '',
    originalRequestName: event.name,
    description: legacyState?.description ?? '',
    display: event.display,
    status: isAwaitingApproval ? CoreToolCallStatus.AwaitingApproval : CoreToolCallStatus.Scheduled,
    isClientInitiated: false,
    renderOutputAsMarkdown: legacyState?.isOutputMarkdown ?? false,
    kind: legacyState?.kind ?? Kind.Other,
    confirmationDetails: event.confirmationDetails,
    resultDisplay: undefined,
  };
  setTrackedTools((prev) => [...prev, newCall]);
}

function handleToolUpdateEvent(
  event: AgentEvent,
  setTrackedTools: React.Dispatch<React.SetStateAction<IndividualToolCallDisplay[]>>,
): void {
  setTrackedTools((prev) =>
    prev.map((tc): IndividualToolCallDisplay => {
      if (tc.callId !== event.requestId) return tc;
      const ls = event._meta?.legacyState;
      let status = tc.status;
      if (ls?.status === 'executing') status = CoreToolCallStatus.Executing;
      else if (ls?.status === 'error') status = CoreToolCallStatus.Error;
      else if (ls?.status === 'success') status = CoreToolCallStatus.Success;
      return {
        ...tc,
        status,
        display: event.display ? { ...tc.display, ...event.display } : tc.display,
        resultDisplay: displayContentToString(event.display?.result) ?? tc.resultDisplay,
        progressMessage: ls?.progressMessage ?? tc.progressMessage,
        progress: ls?.progress ?? tc.progress,
        progressTotal: ls?.progressTotal ?? tc.progressTotal,
        ptyId: parsePtyId(ls?.pid, tc.ptyId),
        description: ls?.description ?? tc.description,
      };
    }),
  );
}

function handleToolResponseEvent(
  event: AgentEvent,
  setTrackedTools: React.Dispatch<React.SetStateAction<IndividualToolCallDisplay[]>>,
): void {
  setTrackedTools((prev) =>
    prev.map((tc): IndividualToolCallDisplay => {
      if (tc.callId !== event.requestId) return tc;
      return {
        ...tc,
        status: event.isError ? CoreToolCallStatus.Error : CoreToolCallStatus.Success,
        display: event.display ? { ...tc.display, ...event.display } : tc.display,
        resultDisplay: displayContentToString(event.display?.result) ?? tc.resultDisplay,
        outputFile: event._meta?.legacyState?.outputFile,
      };
    }),
  );
}

/**
 * useAgentStream implements the interactive agent loop using an AgentProtocol.
 * It is completely agnostic to the specific agent implementation.
 */
function handleAgentEvent(
  event: AgentEvent,
  addItem: UseHistoryManagerReturn['addItem'],
  geminiMessageBufferRef: React.MutableRefObject<string>,
  userMessageTimestampRef: React.MutableRefObject<number>,
  setPendingHistoryItem: (item: HistoryItemWithoutId | null) => void,
  setTrackedTools: React.Dispatch<React.SetStateAction<IndividualToolCallDisplay[]>>,
  setStreamingState: (state: StreamingState) => void,
  setThought: (thought: ThoughtSummary | null) => void,
  setLastOutputTime: (time: number) => void,
  flushPendingText: () => void,
): void {
  if (!event?.type) return;
  const isActivityEvent = [
    'agent_start',
    'agent_end',
    'message',
    'tool_request',
    'tool_update',
    'tool_response',
  ].includes(event.type);
  if (isActivityEvent) {
    setLastOutputTime(Date.now());
  }
  switch (event.type) {
    case 'agent_start':
      setStreamingState(StreamingState.Responding);
      break;
    case 'agent_end':
      setStreamingState(StreamingState.Idle);
      flushPendingText();
      break;
    case 'message':
      handleMessageEvent(
        event,
        addItem,
        geminiMessageBufferRef,
        userMessageTimestampRef,
        setPendingHistoryItem,
        setThought,
      );
      break;
    case 'tool_request':
      flushPendingText();
      handleToolRequestEvent(event, setTrackedTools);
      break;
    case 'tool_update':
      handleToolUpdateEvent(event, setTrackedTools);
      break;
    case 'tool_response':
      handleToolResponseEvent(event, setTrackedTools);
      break;
    case 'error': {
      const message =
        event._meta?.['code'] === 'AGENT_EXECUTION_BLOCKED'
          ? `Agent execution blocked: ${event.message}`
          : event.message;
      addItem({ type: MessageType.ERROR, text: message }, userMessageTimestampRef.current);
      break;
    }
    default:
      break;
  }
}

function buildPendingToolGroupItems(
  trackedTools: IndividualToolCallDisplay[],
  pushedToolCallIds: Set<string>,
  pushedToolCallIdsRef: React.MutableRefObject<Set<string>>,
  hasEmittedBoxInTurnRef: React.MutableRefObject<boolean>,
  activePtyId: undefined,
  isShellFocused: boolean | undefined,
  backgroundTasks: Map<number, BackgroundTask>,
): HistoryItemWithoutId[] {
  const remainingTools = trackedTools.filter((tc) => !pushedToolCallIdsRef.current.has(tc.callId));
  const items: HistoryItemWithoutId[] = [];
  const appearance = getToolGroupBorderAppearance(
    { type: 'tool_group', tools: trackedTools },
    activePtyId,
    !!isShellFocused,
    [],
    backgroundTasks,
  );

  if (remainingTools.length > 0) {
    const hasBoxInPending = remainingTools.some((tc) => tc.display?.format !== 'notice');
    const shouldStartNewBlock =
      pushedToolCallIds.size === 0 || (!hasEmittedBoxInTurnRef.current && hasBoxInPending);
    items.push({
      type: 'tool_display_group',
      tools: remainingTools.map((tc) => ({
        name: tc.name,
        description: tc.description,
        ...tc.display,
        status: tc.status,
        originalRequestName: tc.originalRequestName,
      })),
      borderTop: shouldStartNewBlock,
      borderBottom: false,
      ...appearance,
    });
  }

  const allTerminal =
    trackedTools.length > 0 &&
    trackedTools.every(
      (tc) => tc.status === 'success' || tc.status === 'error' || tc.status === 'cancelled',
    );
  const allPushed =
    trackedTools.length > 0 && trackedTools.every((tc) => pushedToolCallIds.has(tc.callId));
  const anyVisibleInHistory = pushedToolCallIds.size > 0;
  const anyVisibleInPending = remainingTools.length > 0;

  if (
    trackedTools.length > 0 &&
    !(allTerminal && allPushed) &&
    (anyVisibleInHistory || anyVisibleInPending)
  ) {
    items.push({
      type: 'tool_display_group',
      tools: [],
      borderTop: false,
      borderBottom: true,
      ...appearance,
    });
  }

  return items;
}

function pushCompletedToolsToHistoryEffect(
  trackedTools: IndividualToolCallDisplay[],
  pushedToolCallIdsRef: React.MutableRefObject<Set<string>>,
  isFirstToolInGroupRef: React.MutableRefObject<boolean>,
  hasEmittedBoxInTurnRef: React.MutableRefObject<boolean>,
  setPushedToolCallIds: (value: Set<string>) => void,
  setIsFirstToolInGroup: (value: boolean) => void,
  setHasEmittedBoxInTurn: (value: boolean) => void,
  addItem: UseHistoryManagerReturn['addItem'],
  activePtyId: undefined,
  isShellFocused: boolean | undefined,
  backgroundTasks: Map<number, BackgroundTask>,
): void {
  if (trackedTools.length === 0) return;

  const allTerminal = trackedTools.every(
    (tc) => tc.status === 'success' || tc.status === 'error' || tc.status === 'cancelled',
  );

  const toolsToPush = trackedTools.filter((tc) => !pushedToolCallIdsRef.current.has(tc.callId));

  if (allTerminal && toolsToPush.length > 0) {
    const newPushed = new Set(pushedToolCallIdsRef.current);
    for (const tc of toolsToPush) {
      newPushed.add(tc.callId);
    }
    pushedToolCallIdsRef.current = newPushed;

    const appearance = getToolGroupBorderAppearance(
      { type: 'tool_group', tools: trackedTools },
      activePtyId,
      !!isShellFocused,
      [],
      backgroundTasks,
    );

    const hasBoxInBatch = toolsToPush.some((tc) => tc.display?.format !== 'notice');
    const shouldStartNewBlock =
      isFirstToolInGroupRef.current || (!hasEmittedBoxInTurnRef.current && hasBoxInBatch);

    const historyItem: HistoryItemWithoutId = {
      type: 'tool_display_group',
      tools: toolsToPush.map((tc) => ({
        name: tc.name,
        description: tc.description,
        ...tc.display,
        status: tc.status,
        originalRequestName: tc.originalRequestName,
      })),
      borderTop: shouldStartNewBlock,
      borderBottom: true,
      ...appearance,
    };

    addItem(historyItem);
    setPushedToolCallIds(newPushed);

    if (hasBoxInBatch) {
      setHasEmittedBoxInTurn(true);
    }
    setIsFirstToolInGroup(false);
  }
}

function useShellToolState(trackedTools: IndividualToolCallDisplay[]) {
  const activePtyId = undefined;
  const backgroundTaskCount = 0;
  const isBackgroundTaskVisible = false;
  const toggleBackgroundTasks = useCallback(() => {}, []);
  const backgroundCurrentExecution = undefined;
  const backgroundTasks = useMemo(() => new Map<number, BackgroundTask>(), []);
  const dismissBackgroundTask = useCallback(async (_pid: number) => {}, []);

  const pendingToolCalls = useMemo(
    (): MinimalTrackedToolCall[] =>
      trackedTools.map((t) => ({
        request: {
          name: t.originalRequestName || t.name,
          args: { command: t.description },
          callId: t.callId,
          isClientInitiated: t.isClientInitiated ?? false,
          prompt_id: '',
        },
        status: t.status as CoreToolCallStatus,
      })),
    [trackedTools],
  );

  const [loopDetectionConfirmationRequest] = useState<LoopDetectionConfirmationRequest | null>(
    null,
  );

  return {
    activePtyId,
    backgroundTaskCount,
    isBackgroundTaskVisible,
    toggleBackgroundTasks,
    backgroundCurrentExecution,
    backgroundTasks,
    dismissBackgroundTask,
    pendingToolCalls,
    loopDetectionConfirmationRequest,
  };
}

function useMergedPendingItems(
  pendingHistoryItem: HistoryItemWithoutId | null,
  trackedTools: IndividualToolCallDisplay[],
  pushedToolCallIds: Set<string>,
  pushedToolCallIdsRef: React.MutableRefObject<Set<string>>,
  hasEmittedBoxInTurnRef: React.MutableRefObject<boolean>,
  activePtyId: undefined,
  isShellFocused: boolean | undefined,
  backgroundTasks: Map<number, BackgroundTask>,
): HistoryItemWithoutId[] {
  const pendingToolGroupItems = useMemo(
    (): HistoryItemWithoutId[] =>
      buildPendingToolGroupItems(
        trackedTools,
        pushedToolCallIds,
        pushedToolCallIdsRef,
        hasEmittedBoxInTurnRef,
        activePtyId,
        isShellFocused,
        backgroundTasks,
      ),
    [
      trackedTools,
      pushedToolCallIds,
      pushedToolCallIdsRef,
      hasEmittedBoxInTurnRef,
      activePtyId,
      isShellFocused,
      backgroundTasks,
    ],
  );

  return useMemo(
    () =>
      [pendingHistoryItem, ...pendingToolGroupItems].filter(
        (i): i is HistoryItemWithoutId => i !== undefined && i !== null,
      ),
    [pendingHistoryItem, pendingToolGroupItems],
  );
}

function useToolCallSync(
  trackedTools: IndividualToolCallDisplay[],
  pushedToolCallIdsRef: React.MutableRefObject<Set<string>>,
  setPushedToolCallIds: (value: Set<string>) => void,
  setIsFirstToolInGroup: (value: boolean) => void,
  isFirstToolInGroupRef: React.MutableRefObject<boolean>,
  hasEmittedBoxInTurnRef: React.MutableRefObject<boolean>,
  setHasEmittedBoxInTurn: (value: boolean) => void,
  streamingState: StreamingState,
  addItem: UseHistoryManagerReturn['addItem'],
  activePtyId: undefined,
  isShellFocused: boolean | undefined,
  backgroundTasks: Map<number, BackgroundTask>,
): void {
  useEffect(() => {
    if (trackedTools.length > 0) {
      const isNewBatch = !trackedTools.some((tc) => pushedToolCallIdsRef.current.has(tc.callId));
      if (isNewBatch && pushedToolCallIdsRef.current.size > 0) {
        setPushedToolCallIds(new Set());
        setIsFirstToolInGroup(true);
      }
    } else if (streamingState === StreamingState.Idle && pushedToolCallIdsRef.current.size > 0) {
      setPushedToolCallIds(new Set());
      setIsFirstToolInGroup(true);
    }
  }, [
    trackedTools,
    pushedToolCallIdsRef,
    setPushedToolCallIds,
    setIsFirstToolInGroup,
    streamingState,
  ]);

  useEffect(() => {
    pushCompletedToolsToHistoryEffect(
      trackedTools,
      pushedToolCallIdsRef,
      isFirstToolInGroupRef,
      hasEmittedBoxInTurnRef,
      setPushedToolCallIds,
      setIsFirstToolInGroup,
      setHasEmittedBoxInTurn,
      addItem,
      activePtyId,
      isShellFocused,
      backgroundTasks,
    );
  }, [
    trackedTools,
    pushedToolCallIdsRef,
    isFirstToolInGroupRef,
    hasEmittedBoxInTurnRef,
    setPushedToolCallIds,
    setIsFirstToolInGroup,
    setHasEmittedBoxInTurn,
    addItem,
    activePtyId,
    isShellFocused,
    backgroundTasks,
  ]);
}

export const useAgentStream = ({
  agent,
  addItem,
  onCancelSubmit,
  isShellFocused,
  logger,
}: UseAgentStreamOptions) => {
  const [initError] = useState<string | null>(null);
  const [retryStatus] = useState<RetryAttemptPayload | null>(null);
  const [streamingState, setStreamingState] = useState<StreamingState>(StreamingState.Idle);
  const [thought, setThought] = useState<ThoughtSummary | null>(null);
  const [lastOutputTime, setLastOutputTime] = useState<number>(Date.now());

  const currentStreamIdRef = useRef<string | null>(null);
  const userMessageTimestampRef = useRef<number>(0);
  const geminiMessageBufferRef = useRef<string>('');
  const [pendingHistoryItem, pendingHistoryItemRef, setPendingHistoryItem] =
    useStateAndRef<HistoryItemWithoutId | null>(null);

  const [trackedTools, , setTrackedTools] = useStateAndRef<IndividualToolCallDisplay[]>([]);
  const [pushedToolCallIds, pushedToolCallIdsRef, setPushedToolCallIds] = useStateAndRef<
    Set<string>
  >(new Set());
  const [, isFirstToolInGroupRef, setIsFirstToolInGroup] = useStateAndRef<boolean>(true);
  const [, hasEmittedBoxInTurnRef, setHasEmittedBoxInTurn] = useStateAndRef<boolean>(false);

  const { startNewPrompt } = useSessionStats();

  const {
    activePtyId,
    backgroundTaskCount,
    isBackgroundTaskVisible,
    toggleBackgroundTasks,
    backgroundCurrentExecution,
    backgroundTasks,
    dismissBackgroundTask,
    pendingToolCalls,
    loopDetectionConfirmationRequest,
  } = useShellToolState(trackedTools);

  const flushPendingText = useCallback(() => {
    if (pendingHistoryItemRef.current) {
      addItem(pendingHistoryItemRef.current, userMessageTimestampRef.current);
      setPendingHistoryItem(null);
      geminiMessageBufferRef.current = '';
    }
  }, [addItem, pendingHistoryItemRef, setPendingHistoryItem]);

  const cancelOngoingRequest = useCallback(
    async (clearBuffer: boolean = true) => {
      if (agent) {
        await agent.abort();
        setStreamingState(StreamingState.Idle);
        onCancelSubmit(false, clearBuffer);
      }
    },
    [agent, onCancelSubmit],
  );

  // Support native handleApprovalModeChange for Plan Mode
  const handleApprovalModeChange = useCallback(async (newApprovalMode: ApprovalMode) => {
    debugLogger.debug(`Approval mode changed to ${newApprovalMode} (stub)`);
  }, []);

  const handleEvent = useCallback(
    (event: AgentEvent) => {
      handleAgentEvent(
        event,
        addItem,
        geminiMessageBufferRef,
        userMessageTimestampRef,
        setPendingHistoryItem,
        setTrackedTools,
        setStreamingState,
        setThought,
        setLastOutputTime,
        flushPendingText,
      );
    },
    [
      addItem,
      flushPendingText,
      setPendingHistoryItem,
      setTrackedTools,
      setStreamingState,
      setThought,
      setLastOutputTime,
    ],
  );

  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  useEffect(() => {
    const unsubscribe = agent?.subscribe((event) => {
      handleEventRef.current(event);
    });
    return () => unsubscribe?.();
  }, [agent]);

  useKeypress(
    (key) => {
      if (key.name === 'escape' && !isShellFocused) {
        void cancelOngoingRequest(false);
        return true;
      }
      return false;
    },
    {
      isActive:
        streamingState === StreamingState.Responding ||
        streamingState === StreamingState.WaitingForConfirmation,
    },
  );

  const submitQuery = useCallback(
    async (query: Part[] | string, options?: { isContinuation: boolean }, _prompt_id?: string) => {
      if (!agent) return;

      const timestamp = Date.now();
      setLastOutputTime(timestamp);
      userMessageTimestampRef.current = timestamp;

      geminiMessageBufferRef.current = '';

      if (!options?.isContinuation) {
        if (typeof query === 'string') {
          addItem({ type: MessageType.USER, text: query }, timestamp);
          void logger?.logMessage(MessageSenderType.USER, query);
        }
        startNewPrompt();
      }

      const parts = geminiPartsToContentParts(
        typeof query === 'string' ? [{ text: query }] : query,
      );

      try {
        const { streamId } = await agent.send({
          message: { content: parts },
        });
        currentStreamIdRef.current = streamId;
      } catch (err) {
        addItem({ type: MessageType.ERROR, text: getErrorMessage(err) }, timestamp);
      }
    },
    [agent, addItem, logger, startNewPrompt],
  );

  useToolCallSync(
    trackedTools,
    pushedToolCallIdsRef,
    setPushedToolCallIds,
    setIsFirstToolInGroup,
    isFirstToolInGroupRef,
    hasEmittedBoxInTurnRef,
    setHasEmittedBoxInTurn,
    streamingState,
    addItem,
    activePtyId,
    isShellFocused,
    backgroundTasks,
  );

  const pendingHistoryItems = useMergedPendingItems(
    pendingHistoryItem,
    trackedTools,
    pushedToolCallIds,
    pushedToolCallIdsRef,
    hasEmittedBoxInTurnRef,
    activePtyId,
    isShellFocused,
    backgroundTasks,
  );

  return {
    streamingState,
    submitQuery,
    initError,
    pendingHistoryItems,
    thought,
    cancelOngoingRequest,
    pendingToolCalls,
    handleApprovalModeChange,
    activePtyId,
    loopDetectionConfirmationRequest,
    lastOutputTime,
    backgroundTaskCount,
    isBackgroundTaskVisible,
    toggleBackgroundTasks,
    backgroundCurrentExecution,
    backgroundTasks,
    retryStatus,
    dismissBackgroundTask,
  };
};
