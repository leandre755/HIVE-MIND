import { useCallback, useEffect, useRef, useState } from 'react';
import { HiveConfig } from '../../config/hiveConfig.js';
import {
  ResumedSessionData,
  HistoryItemWithoutId,
  convertSessionToClientHistory,
} from '../contexts/UIStateContext.js';
import { coreEvents } from '../../utils/coreEvents.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import { convertSessionToHistoryFormats, type MessageRecord } from '../../utils/sessionUtils.js';

interface UseSessionResumeParams {
  config: HiveConfig | null;
  historyManager: UseHistoryManagerReturn;
  refreshStatic: () => void;
  isCoreConnected: boolean;
  setQuittingMessages: (messages: null) => void;
  resumedSessionData?: ResumedSessionData;
}

/**
 * Hook to handle session resumption logic.
 * Provides a callback to load history for resume and automatically
 * handles command-line resume on mount.
 */
export function useSessionResume({
  config,
  historyManager,
  refreshStatic,
  isCoreConnected,
  setQuittingMessages,
  resumedSessionData,
}: UseSessionResumeParams) {
  const [isResuming, setIsResuming] = useState(false);

  // Use refs to avoid dependency chain that causes infinite loop
  const historyManagerRef = useRef(historyManager);
  historyManagerRef.current = historyManager;
  const refreshStaticRef = useRef(refreshStatic);
  refreshStaticRef.current = refreshStatic;

  const loadHistoryForResume = useCallback(
    async (
      uiHistory: HistoryItemWithoutId[],
      _clientHistory: unknown,
      resumedData: ResumedSessionData,
    ) => {
      // Wait for the client.
      if (!isCoreConnected) {
        return;
      }

      setIsResuming(true);
      try {
        // Now that we have the client, load the history into the UI and the client.
        setQuittingMessages(null);
        historyManagerRef.current.clearItems();
        uiHistory.forEach((item, index) => {
          historyManagerRef.current.addItem(item, index, true);
        });
        refreshStaticRef.current(); // Force Static component to re-render with the updated history.

        // Restore directories from the resumed session
        if (
          resumedData.conversation?.directories &&
          resumedData.conversation.directories.length > 0
        ) {
          const workspaceContext = config?.getWorkspaceContext() as
            { addDirectories?: (dirs: string[]) => void } | undefined;
          // Add back any directories that were saved in the session
          // but filter out ones that no longer exist
          workspaceContext?.addDirectories?.(resumedData.conversation.directories);
        }
      } catch (error) {
        coreEvents.emitFeedback('error', 'Failed to resume session. Please try again.', error);
      } finally {
        setIsResuming(false);
      }
    },
    [config, isCoreConnected, setQuittingMessages],
  );

  // Handle interactive resume from the command line (-r/--resume without -p/--prompt-interactive).
  // Only if we're not authenticating and the client is initialized, though.
  const hasLoadedResumedSession = useRef(false);
  useEffect(() => {
    if (resumedSessionData && isCoreConnected && !hasLoadedResumedSession.current) {
      hasLoadedResumedSession.current = true;
      const rawMessages = (resumedSessionData.conversation?.messages ?? []) as unknown[];
      const historyData = convertSessionToHistoryFormats(rawMessages as MessageRecord[]);
      void loadHistoryForResume(
        historyData.uiHistory,
        convertSessionToClientHistory(rawMessages),
        resumedSessionData,
      );
    }
  }, [resumedSessionData, isCoreConnected, loadHistoryForResume]);

  return { loadHistoryForResume, isResuming };
}
