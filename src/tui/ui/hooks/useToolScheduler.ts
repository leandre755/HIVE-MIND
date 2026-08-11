import {
  CoreToolCallStatus,
  ToolCallRequestInfo,
  CompletedToolCall,
  MessageBusType,
  ROOT_SCHEDULER_ID,
  EditorType,
  SubagentActivityItem,
  AGENT_TOOL_NAME,
} from '../contexts/UIStateContext.js';
import type { ToolCall } from '../../../core/types/BotTypes.js';
import { HiveConfig } from '../../config/hiveConfig.js';
import { useCallback, useState, useMemo, useEffect, useRef } from 'react';

// Re-exporting types compatible with hook expectations
export type ScheduleFn = (
  request: ToolCallRequestInfo | ToolCallRequestInfo[],
  signal: AbortSignal,
) => Promise<CompletedToolCall[]>;

export type MarkToolsAsSubmittedFn = (callIds: string[]) => void;
export type CancelAllFn = (signal: AbortSignal) => void;

/**
 * The shape expected by useGeminiStream.
 * It matches the Core ToolCall structure + the UI metadata flag.
 */
export type TrackedToolCall = ToolCall & {
  request: ToolCallRequestInfo;
  responseSubmittedToLLM?: boolean;
  subagentHistory?: SubagentActivityItem[];
  status?: string;
  pid?: number | string;
  schedulerId?: string;
};

// Narrowed types for specific statuses (used by useGeminiStream)
export type TrackedScheduledToolCall = Extract<TrackedToolCall, { status: 'scheduled' }>;
export type TrackedValidatingToolCall = Extract<TrackedToolCall, { status: 'validating' }>;
export type TrackedWaitingToolCall = Extract<TrackedToolCall, { status: 'awaiting_approval' }>;
export type TrackedExecutingToolCall = Extract<TrackedToolCall, { status: 'executing' }>;
export type TrackedCompletedToolCall = Extract<TrackedToolCall, { status: 'success' | 'error' }>;
export type TrackedCancelledToolCall = Extract<TrackedToolCall, { status: 'cancelled' }>;

interface CoreScheduler {
  schedule: ScheduleFn;
  cancelAll: (signal?: AbortSignal) => void;
  dispose: () => void;
}

interface ToolCallsUpdateEventPayload {
  schedulerId?: string;
  toolCalls?: ToolCall[];
  calls?: ToolCall[];
}

interface SubagentActivityEventPayload {
  subagentName?: string;
  activity?: unknown;
  items?: unknown[];
}

function resolveSubagentName(tc: TrackedToolCall): string {
  if (tc.request.name !== AGENT_TOOL_NAME) return tc.request.name;
  const argsObj = tc.request.args;
  let parsedArgs: unknown = argsObj;
  if (typeof argsObj === 'string') {
    try {
      parsedArgs = JSON.parse(argsObj);
    } catch {
      return tc.request.name;
    }
  }
  if (typeof parsedArgs === 'object' && parsedArgs !== null) {
    const record = parsedArgs as Record<string, unknown>;
    if (typeof record['agent_name'] === 'string') {
      return record['agent_name'];
    }
  }
  return tc.request.name;
}

function extractActivityItems(event: SubagentActivityEventPayload): SubagentActivityItem[] {
  if (Array.isArray(event.activity)) return event.activity as SubagentActivityItem[];
  if (event.activity) return [event.activity as SubagentActivityItem];
  if (Array.isArray(event.items)) return event.items as SubagentActivityItem[];
  return [];
}

/**
 * ADAPTER: Merges UI metadata (submitted flag).
 */
function adaptToolCalls(coreCalls: ToolCall[], prevTracked: TrackedToolCall[]): TrackedToolCall[] {
  const prevMap = new Map(prevTracked.map((t) => [t.request.callId, t]));

  return coreCalls.map((coreCall): TrackedToolCall => {
    const cCall = coreCall as TrackedToolCall & { tailToolCallRequest?: unknown };
    const prev = prevMap.get(cCall.request.callId);
    const responseSubmittedToLLM = prev?.responseSubmittedToLLM ?? false;
    let status = cCall.status;
    if (
      (status === CoreToolCallStatus.Success || status === CoreToolCallStatus.Error) &&
      cCall.tailToolCallRequest != null
    ) {
      status = CoreToolCallStatus.Executing;
    }

    return {
      ...cCall,
      status,
      responseSubmittedToLLM,
    };
  });
}

function updateToolCallsMap(
  prev: Map<string, TrackedToolCall[]>,
  schedulerId: string,
  toolCallsList: ToolCall[],
  isRoot: boolean,
): Map<string, TrackedToolCall[]> {
  const prevCalls = prev.get(schedulerId) ?? [];
  const prevCallIds = new Set(prevCalls.map((tc) => tc.request?.callId));

  const filteredToolCalls = isRoot
    ? toolCallsList
    : toolCallsList.filter((tc) => {
        const trackedTc = tc as unknown as TrackedToolCall;
        return (
          trackedTc.status === CoreToolCallStatus.AwaitingApproval ||
          prevCallIds.has(trackedTc.request?.callId)
        );
      });

  if (!isRoot && filteredToolCalls.length === 0 && prevCalls.length === 0) {
    return prev;
  }

  const adapted = adaptToolCalls(filteredToolCalls, prevCalls);
  const nextMap = new Map(prev);
  nextMap.set(schedulerId, adapted);
  return nextMap;
}

function updateSubagentHistoryMap(
  prev: Map<string, SubagentActivityItem[]>,
  subagentName: string,
  activityItems: SubagentActivityItem[],
): Map<string, SubagentActivityItem[]> {
  const history = prev.get(subagentName) ?? [];
  const nextHistory = [...history];

  for (const activity of activityItems) {
    const index = nextHistory.findIndex((item) => item.id === activity.id);
    if (index >= 0) {
      nextHistory.splice(index, 1, activity);
    } else {
      nextHistory.push(activity);
    }
  }

  const nextMap = new Map(prev);
  nextMap.set(subagentName, nextHistory);
  return nextMap;
}

/**
 * Modern tool scheduler hook using the event-driven Core Scheduler.
 */
export function useToolScheduler(
  onComplete: (tools: CompletedToolCall[]) => Promise<void>,
  config: HiveConfig,
  getPreferredEditor: () => EditorType | undefined,
): [
  TrackedToolCall[],
  ScheduleFn,
  MarkToolsAsSubmittedFn,
  React.Dispatch<React.SetStateAction<TrackedToolCall[]>>,
  CancelAllFn,
  number,
  CoreScheduler,
] {
  // State stores tool calls organized by their originating schedulerId
  const [toolCallsMap, setToolCallsMap] = useState<Map<string, TrackedToolCall[]>>(() => new Map());
  const [lastToolOutputTime, setLastToolOutputTime] = useState<number>(0);
  const [subagentHistoryMap, setSubagentHistoryMap] = useState<Map<string, SubagentActivityItem[]>>(
    () => new Map(),
  );

  const messageBus = useMemo(() => config.getMessageBus(), [config]);

  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  }, [onComplete]);

  const getPreferredEditorRef = useRef(getPreferredEditor);
  useEffect(() => {
    getPreferredEditorRef.current = getPreferredEditor;
  }, [getPreferredEditor]);

  const scheduler = useMemo(
    () =>
      new (Scheduler as unknown as new (options: unknown) => CoreScheduler)({
        context: config,
        messageBus,
        getPreferredEditor: () => getPreferredEditorRef.current(),
        schedulerId: ROOT_SCHEDULER_ID,
      }),
    [config, messageBus],
  );

  useEffect(() => () => scheduler.dispose(), [scheduler]);

  useEffect(() => {
    const handler = (payload: unknown) => {
      const event = payload as ToolCallsUpdateEventPayload;
      const schedulerId = event.schedulerId ?? ROOT_SCHEDULER_ID;
      const isRoot = schedulerId === ROOT_SCHEDULER_ID;
      const toolCallsList: ToolCall[] = event.toolCalls ?? event.calls ?? [];

      const hasExecuting = toolCallsList.some((tc) => {
        const trackedTc = tc as unknown as TrackedToolCall;
        return (
          trackedTc.status === CoreToolCallStatus.Executing ||
          ((trackedTc.status === CoreToolCallStatus.Success ||
            trackedTc.status === CoreToolCallStatus.Error) &&
            'tailToolCallRequest' in tc &&
            (tc as { tailToolCallRequest?: unknown }).tailToolCallRequest != null)
        );
      });

      if (hasExecuting) {
        setLastToolOutputTime(Date.now());
      }

      setToolCallsMap((prev) => updateToolCallsMap(prev, schedulerId, toolCallsList, isRoot));
    };

    messageBus.subscribe(MessageBusType.TOOL_CALLS_UPDATE, handler);
    return () => {
      messageBus.unsubscribe(MessageBusType.TOOL_CALLS_UPDATE, handler);
    };
  }, [messageBus]);

  useEffect(() => {
    const handler = (payload: unknown) => {
      const event = payload as SubagentActivityEventPayload;
      const subagentName = event.subagentName;
      if (!subagentName) return;

      const activityItems = extractActivityItems(event);
      if (activityItems.length === 0) return;

      setSubagentHistoryMap((prev) => updateSubagentHistoryMap(prev, subagentName, activityItems));
    };

    messageBus.subscribe(MessageBusType.SUBAGENT_ACTIVITY, handler);
    return () => {
      messageBus.unsubscribe(MessageBusType.SUBAGENT_ACTIVITY, handler);
    };
  }, [messageBus]);

  const schedule: ScheduleFn = useCallback(
    async (request, signal) => {
      setToolCallsMap(new Map());
      setSubagentHistoryMap(new Map());

      const results = await scheduler.schedule(request, signal);
      await onCompleteRef.current(results);

      return results;
    },
    [scheduler],
  );

  const cancelAll: CancelAllFn = useCallback(
    (signal) => {
      scheduler.cancelAll(signal);
    },
    [scheduler],
  );

  const markToolsAsSubmitted: MarkToolsAsSubmittedFn = useCallback((callIdsToMark: string[]) => {
    setToolCallsMap((prevMap) => {
      const nextMap = new Map<string, TrackedToolCall[]>();
      for (const [sid, calls] of prevMap.entries()) {
        nextMap.set(
          sid,
          calls.map((tc) =>
            callIdsToMark.includes(tc.request.callId)
              ? { ...tc, responseSubmittedToLLM: true }
              : tc,
          ),
        );
      }
      return nextMap;
    });
  }, []);

  // Flatten the map for the UI components that expect a single list of tools.
  const toolCalls = useMemo(() => {
    const flattened = Array.from(toolCallsMap.values()).flat();
    return flattened.map((tc) => {
      const subagentName = resolveSubagentName(tc);
      return {
        ...tc,
        subagentHistory: subagentHistoryMap.get(subagentName) ?? tc.subagentHistory,
      };
    });
  }, [toolCallsMap, subagentHistoryMap]);

  // Provide a setter that maintains compatibility with legacy [].
  const setToolCallsForDisplay = useCallback((action: React.SetStateAction<TrackedToolCall[]>) => {
    setToolCallsMap((prev) => {
      const currentFlattened = Array.from(prev.values()).flat();
      const nextFlattened = typeof action === 'function' ? action(currentFlattened) : action;

      if (nextFlattened.length === 0) {
        return new Map();
      }

      const nextMap = new Map<string, TrackedToolCall[]>();
      for (const call of nextFlattened) {
        const sid = call.schedulerId ?? ROOT_SCHEDULER_ID;
        const existing = nextMap.get(sid) ?? [];
        nextMap.set(sid, [...existing, call]);
      }
      return nextMap;
    });
  }, []);

  return [
    toolCalls,
    schedule,
    markToolsAsSubmitted,
    setToolCallsForDisplay,
    cancelAll,
    lastToolOutputTime,
    scheduler,
  ];
}
