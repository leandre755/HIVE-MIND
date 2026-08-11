import {
  CoreToolCallStatus,
  belongsInConfirmationQueue,
  HistoryItemWithoutId,
  IndividualToolCallDisplay,
} from '../contexts/UIStateContext.js';
import { getAllToolCalls, buildToolVisibilityContextFromDisplay } from './historyUtils.js';

export interface ConfirmingToolState {
  tool: IndividualToolCallDisplay;
  index: number;
  total: number;
}

/**
 * Selects the "head" of the confirmation queue.
 */
export function getConfirmingToolState(
  pendingHistoryItems: HistoryItemWithoutId[],
): ConfirmingToolState | null {
  const allPendingTools = getAllToolCalls(pendingHistoryItems);

  const confirmingTools = allPendingTools.filter(
    (tool) => tool.status === CoreToolCallStatus.AwaitingApproval,
  );

  if (confirmingTools.length === 0) {
    return null;
  }

  const actionablePendingTools = allPendingTools.filter((tool) =>
    belongsInConfirmationQueue(buildToolVisibilityContextFromDisplay(tool)),
  );

  const head = confirmingTools[0];
  const headIndexInFullList = actionablePendingTools.findIndex(
    (tool) => tool.callId === head.callId,
  );

  return {
    tool: head,
    index: headIndexInFullList + 1,
    total: actionablePendingTools.length,
  };
}
