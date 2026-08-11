import {
  CoreToolCallStatus,
  HistoryItem,
  HistoryItemWithoutId,
  IndividualToolCallDisplay,
  HistoryItemToolGroup,
} from '../contexts/UIStateContext.js';
import { isShellTool } from '../components/messages/ToolShared.js';
import { theme } from '../semantic-colors.js';
import type { BackgroundTask } from '../hooks/shellReducer.js';
import type { TrackedToolCall } from '../hooks/useToolScheduler.js';

function isTrackedToolCall(
  tool: IndividualToolCallDisplay | TrackedToolCall,
): tool is TrackedToolCall {
  return 'request' in tool;
}

/**
 * Calculates the border color and dimming state for a tool group message.
 */
export function getToolGroupBorderAppearance(
  item:
    | HistoryItem
    | HistoryItemWithoutId
    | {
        type: 'tool_group';
        tools: Array<IndividualToolCallDisplay | TrackedToolCall>;
      },
  activeShellPtyId: number | null | undefined,
  embeddedShellFocused: boolean | undefined,
  allPendingItems: HistoryItemWithoutId[] = [],
  backgroundTasks: Map<number, BackgroundTask> = new Map(),
): { borderColor: string; borderDimColor: boolean } {
  if (item.type !== 'tool_group') {
    return { borderColor: '', borderDimColor: false };
  }

  const itemTools: Array<IndividualToolCallDisplay | TrackedToolCall> =
    (item as HistoryItemToolGroup).tools ?? [];

  // If this item has no tools, it's a closing slice for the current batch.
  // We need to look at the last pending item to determine the batch's appearance.
  const toolsToInspect: Array<IndividualToolCallDisplay | TrackedToolCall> =
    itemTools.length > 0
      ? itemTools
      : allPendingItems
          .filter(
            (i): i is HistoryItemToolGroup =>
              i !== null &&
              i !== undefined &&
              i.type === 'tool_group' &&
              Array.isArray(i.tools) &&
              i.tools.length > 0,
          )
          .slice(-1)
          .flatMap((i) => i.tools);

  const hasPending = toolsToInspect.some((t) => {
    if (isTrackedToolCall(t)) {
      return t.status !== 'success' && t.status !== 'error' && t.status !== 'cancelled';
    } else {
      const displayTool = t as IndividualToolCallDisplay;
      return (
        displayTool.status !== CoreToolCallStatus.Success &&
        displayTool.status !== CoreToolCallStatus.Error &&
        displayTool.status !== CoreToolCallStatus.Cancelled
      );
    }
  });

  const isEmbeddedShellFocused = toolsToInspect.some((t) => {
    if (isTrackedToolCall(t)) {
      return (
        isShellTool(t.request.name) &&
        t.status === 'executing' &&
        t.pid === activeShellPtyId &&
        !!embeddedShellFocused
      );
    } else {
      const displayTool = t as IndividualToolCallDisplay;
      return (
        isShellTool(displayTool.name) &&
        displayTool.status === CoreToolCallStatus.Executing &&
        displayTool.ptyId === activeShellPtyId &&
        !!embeddedShellFocused
      );
    }
  });

  const isShellCommand = toolsToInspect.some((t) => {
    if (isTrackedToolCall(t)) {
      return isShellTool(t.request.name);
    } else {
      const displayTool = t as IndividualToolCallDisplay;
      return isShellTool(displayTool.name);
    }
  });

  // If we have an active PTY that isn't a background shell, then the current
  // pending batch is definitely a shell batch.
  const isCurrentlyInShellTurn = !!activeShellPtyId && !backgroundTasks.has(activeShellPtyId);

  const isShell = isShellCommand || (itemTools.length === 0 && isCurrentlyInShellTurn);
  const isPending = hasPending || (itemTools.length === 0 && isCurrentlyInShellTurn);

  const isEffectivelyFocused =
    isEmbeddedShellFocused ||
    (itemTools.length === 0 && isCurrentlyInShellTurn && !!embeddedShellFocused);

  let borderColor = theme.border.default;
  if (isEffectivelyFocused) {
    borderColor = theme.ui.focus;
  } else if (isShell && isPending) {
    borderColor = theme.ui.active;
  } else if (isPending) {
    borderColor = theme.status.warning;
  }

  const borderDimColor = isPending && (!isShell || !isEffectivelyFocused);

  return { borderColor, borderDimColor };
}
