import { debugLogger } from '../../utils/errors.js';
import { useState, useCallback, useRef } from 'react';

interface Logger {
  getPreviousUserMessages(): Promise<string[]>;
}

export interface UseInputHistoryStoreReturn {
  inputHistory: string[];
  addInput: (input: string) => void;
  initializeFromLogger: (logger: Logger | null) => Promise<void>;
}

/**
 * Hook for independently managing input history.
 * Completely separated from chat history and unaffected by /clear commands.
 */
export function useInputHistoryStore(): UseInputHistoryStoreReturn {
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const pastSessionMessagesRef = useRef<string[]>([]);
  const currentSessionMessagesRef = useRef<string[]>([]);
  const [isInitialized, setIsInitialized] = useState(false);

  /**
   * Recalculate the complete input history from past and current sessions.
   * Applies the same deduplication logic as the previous implementation.
   */
  const recalculateHistory = useCallback((currentSession: string[], pastSession: string[]) => {
    // Combine current session (newest first) + past session (newest first)
    const combinedMessages = [...currentSession, ...pastSession];

    // Deduplicate consecutive identical messages (same algorithm as before)
    const deduplicatedMessages: string[] = [];
    const firstMsg = combinedMessages.at(0);
    if (firstMsg !== undefined) {
      deduplicatedMessages.push(firstMsg); // Add the newest one unconditionally
      for (let i = 1; i < combinedMessages.length; i++) {
        const currentMsg = combinedMessages.at(i);
        const prevMsg = combinedMessages.at(i - 1);
        if (currentMsg !== undefined && currentMsg !== prevMsg) {
          deduplicatedMessages.push(currentMsg);
        }
      }
    }

    // Reverse to oldest first for useInputHistory
    setInputHistory(deduplicatedMessages.reverse());
  }, []);

  /**
   * Initialize input history from logger with past session data.
   * Executed only once at app startup.
   */
  const initializeFromLogger = useCallback(
    async (logger: Logger | null) => {
      if (isInitialized || !logger) return;

      try {
        const pastMessages = (await logger.getPreviousUserMessages()) || [];
        pastSessionMessagesRef.current = pastMessages; // Store as newest first
        recalculateHistory([], pastMessages);
        setIsInitialized(true);
      } catch (error) {
        // Start with empty history even if logger initialization fails
        debugLogger.warn('Failed to initialize input history from logger:', error);
        pastSessionMessagesRef.current = [];
        recalculateHistory([], []);
        setIsInitialized(true);
      }
    },
    [isInitialized, recalculateHistory],
  );

  /**
   * Add new input to history.
   * Recalculates the entire history with deduplication.
   */
  const addInput = useCallback(
    (input: string) => {
      const trimmedInput = input.trim();
      if (!trimmedInput) return; // Filter empty/whitespace-only inputs

      currentSessionMessagesRef.current.push(trimmedInput);
      recalculateHistory(
        currentSessionMessagesRef.current.slice().reverse(), // Convert to newest first
        pastSessionMessagesRef.current,
      );
    },
    [recalculateHistory],
  );

  return {
    inputHistory,
    addInput,
    initializeFromLogger,
  };
}
