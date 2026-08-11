import { useState, useCallback } from 'react';
import {
  HistoryItemWithoutId,
  type HistoryTurn,
  uiTelemetryService,
  convertSessionToClientHistory,
} from '../contexts/UIStateContext.js';
import path from 'node:path';
import { coreEvents } from '../../utils/coreEvents.js';
import {
  convertSessionToHistoryFormats,
  type SessionInfo,
  loadConversationRecord,
} from '../../utils/sessionUtils.js';
import type { HiveConfig } from '../../config/hiveConfig.js';

export { convertSessionToHistoryFormats };

import type { Part } from '@google/genai';

export const useSessionBrowser = (
  config: HiveConfig,
  onLoadHistory: (
    uiHistory: HistoryItemWithoutId[],
    clientHistory: Array<{ role: 'user' | 'model'; parts: Part[] } | HistoryTurn>,
    resumedSessionData: ResumedSessionData,
  ) => Promise<void>,
) => {
  const [isSessionBrowserOpen, setIsSessionBrowserOpen] = useState(false);

  return {
    isSessionBrowserOpen,

    openSessionBrowser: useCallback(() => {
      setIsSessionBrowserOpen(true);
    }, []),

    closeSessionBrowser: useCallback(() => {
      setIsSessionBrowserOpen(false);
    }, []),

    /**
     * Loads a conversation by ID, and reinitializes the chat recording service with it.
     */
    handleResumeSession: useCallback(
      async (session: SessionInfo) => {
        try {
          const chatsDir = path.join(config.storage.getProjectTempDir(), 'chats');

          const fileName = session.fileName;

          const originalFilePath = path.join(chatsDir, fileName);

          // Load up the conversation.
          const conversation = await loadConversationRecord(originalFilePath);
          if (!conversation) {
            throw new Error(`Failed to parse conversation from ${originalFilePath}`);
          }

          // Use the old session's ID to continue it.
          const existingSessionId = conversation.sessionId;
          config.setSessionId(existingSessionId);
          uiTelemetryService.hydrate(conversation);

          const resumedSessionData = {
            conversation,
            filePath: originalFilePath,
          };

          // We've loaded it; tell the UI about it.
          setIsSessionBrowserOpen(false);
          const historyData = convertSessionToHistoryFormats(conversation.messages);
          await onLoadHistory(
            historyData.uiHistory,
            convertSessionToClientHistory((conversation.messages ?? []) as unknown[]) as Array<
              { role: 'user' | 'model'; parts: Part[] } | HistoryTurn
            >,
            resumedSessionData,
          );
        } catch (error) {
          coreEvents.emitFeedback('error', 'Error resuming session:', error);
          setIsSessionBrowserOpen(false);
        }
      },
      [config, onLoadHistory],
    ),

    /**
     * Deletes a session by ID using the ChatRecordingService.
     */
    handleDeleteSession: useCallback(async (_session: SessionInfo) => {
      // Session deletion is handled by Core / SessionManager
    }, []),
  };
};
