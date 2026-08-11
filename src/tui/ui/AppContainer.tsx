/**
 * @license
 * Copyright 2026 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo, useState, useCallback, useEffect, useRef, useContext } from 'react';
import {
  type DOMElement,
  ResizeObserver,
  useApp,
  useStdout,
  useStdin,
  type AppProps,
  AppContext as InkAppContext,
} from 'ink';
import { App } from './App.js';
import { AppContext } from './contexts/AppContext.js';
import {
  UIStateContext,
  type UIState,
  HistoryItem,
  HistoryItemWithoutId,
  ConfirmationRequest,
  PermissionConfirmationRequest,
  StreamingState,
  IdeInfo,
  IdeContext,
  ApprovalMode,
  AgentDefinition,
  SlashCommand,
  UserFeedbackPayload,
  MessageType,
  StartupWarning,
  HookSystemMessagePayload,
  NewAgentsChoice,
  IdeClient,
  PartListUnion,
  isValidEditorType,
  enableMouseEvents,
  disableMouseEvents,
  type CommandContext,
  type AccountSuspensionInfo,
  type ThoughtSummary,
  type LoopDetectionConfirmationRequest,
  type FolderDiscoveryResults,
  type PolicyUpdateConfirmationRequest,
  type ActiveHook,
  type UpdateObject,
  type ExtensionUpdateState,
  type ExtensionUpdateStatus,
  type RetryAttemptPayload,
} from './contexts/UIStateContext.js';
import { QuotaContext, type QuotaState } from './contexts/QuotaContext.js';
import { useSessionStats, type SessionStatsState } from './contexts/SessionContext.js';
import {
  terminalCapabilityManager,
  type TerminalBackgroundColor,
} from './utils/terminalCapabilityManager.js';

const EMPTY_QUOTA_STATE: QuotaState = Object.freeze({});
import { UIActionsContext, type UIActions } from './contexts/UIActionsContext.js';
import { ConfigContext } from './contexts/ConfigContext.js';
import { checkPermissions } from './hooks/atCommandProcessor.js';
import { ToolActionsProvider } from './contexts/ToolActionsContext.js';
import { MouseProvider } from './contexts/MouseContext.js';
import { ScrollProvider } from './contexts/ScrollProvider.js';
import { getErrorMessage, debugLogger } from '../utils/errors.js';
import { HiveConfig } from '../config/hiveConfig.js';
import { coreEvents, CoreEvent } from '../utils/coreEvents.js';

// validateAuthMethod supprimé — non nécessaire pour HIVE-MIND
import process from 'node:process';
import { useHistory } from './hooks/useHistoryManager.js';
import { useMemoryMonitor } from './hooks/useMemoryMonitor.js';
import { useThemeCommand } from './hooks/useThemeCommand.js';
import { useEditorSettings } from './hooks/useEditorSettings.js';
import { useSettingsCommand } from './hooks/useSettingsCommand.js';
import { useModelCommand } from './hooks/useModelCommand.js';
// useVoiceModelCommand removed
import { useSlashCommandProcessor } from './hooks/slashCommandProcessor.js';
import { useVimMode } from './contexts/VimModeContext.js';
import { useOverflowActions, useOverflowState } from './contexts/OverflowContext.js';
import { useErrorCount } from './hooks/useConsoleMessages.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { calculatePromptWidths } from './components/InputPrompt.js';
import { calculateMainAreaWidth } from './utils/ui-sizing.js';
import { basename } from 'node:path';
import { computeTerminalTitle } from '../utils/windowTitle.js';
import { useTextBuffer } from './components/shared/text-buffer.js';
import { useLogger } from './hooks/useLogger.js';

// NOTE: les anciens mocks locaux (useConfirmUpdateRequests, useExtensionUpdates,
// requestConsentInteractive, setUpdateHandler, relaunchApp, ideContextStore,
// getAllHiveMdFilenames, clearCachedCredentialFile, ResumedSessionData, recordExitFail,
// ShellExecutionService, saveApiKey, isValidEditorType, flattenMemory,
// MemoryChangedPayload, writeToStdout, disableMouseEvents, enterAlternateScreen,
// enableMouseEvents, disableLineWrapping, shouldEnterAlternateScreen, startupProfiler,
// generateSummary, ConsentRequestPayload, AgentsDiscoveredPayload,
// ChangeAuthRequestedError, ProjectIdRequiredError, buildUserSteeringHintPrompt,
// logBillingEvent, ApiKeyUpdatedEvent, LegacyAgentProtocol, InjectionSource,
// ExtensionManager, IdeIntegrationNudgeResult, UpdateObject, SessionStartSource,
// SessionEndReason) ont été retirés : ils dupliquaient les vraies implémentations
// de UIStateContext / TerminalScreenService ou n'avaient aucun appelant.

import { useAgentStream } from './hooks/useAgentStream.js';
import { hiveCoreConnection } from '../core/connection.js';
import { type BackgroundTask } from './types/backgroundTask.js';
import { useVim } from './hooks/vim.js';
import { type LoadableSettingScope, SettingScope } from '../config/settings.js';
import { type InitializationResult } from '../core/initializer.js';
import { startAutoMemoryIfEnabled } from '../utils/autoMemory.js';
import { useFocus } from './hooks/useFocus.js';
import { useKeypress, type Key } from './hooks/useKeypress.js';
import { KeypressPriority } from './contexts/KeypressContext.js';
import { Command } from './key/keyMatchers.js';
import { useLoadingIndicator } from './hooks/useLoadingIndicator.js';
import { useShellInactivityStatus } from './hooks/useShellInactivityStatus.js';
import type { MinimalTrackedToolCall } from './hooks/useTurnActivityMonitor.js';
import { appEvents, AppEvent, TransientMessageType } from '../utils/events.js';
import { registerCleanup, removeCleanup, runExitCleanup } from '../utils/cleanup.js';
import type { SessionInfo } from '../utils/sessionUtils.js';
import { useMessageQueue } from './hooks/useMessageQueue.js';
import { useMcpStatus } from './hooks/useMcpStatus.js';
import { useApprovalModeIndicator } from './hooks/useApprovalModeIndicator.js';
import { useGitBranchName } from './hooks/useGitBranchName.js';
import { ShellFocusContext } from './contexts/ShellFocusContext.js';
import { useSessionBrowser } from './hooks/useSessionBrowser.js';
import { useSessionResume } from './hooks/useSessionResume.js';
import { useSettings } from './contexts/SettingsContext.js';
import { useInputHistoryStore } from './hooks/useInputHistoryStore.js';
import { useHeaderBanner } from './hooks/useHeaderBanner.js';
import { TUIOverlayProvider, useTUIOverlay } from './contexts/TUIOverlayContext.js';
import { useTerminalSetupPrompt } from './utils/terminalSetup.js';
import { useHookDisplayState } from './hooks/useHookDisplayState.js';
import { useBackgroundTaskManager } from './hooks/useBackgroundTaskManager.js';
import {
  WARNING_PROMPT_DURATION_MS,
  QUEUE_ERROR_DISPLAY_DURATION_MS,
  EXPAND_HINT_DURATION_MS,
} from './constants.js';
import { isSlashCommand } from './utils/commandUtils.js';
import { parseSlashCommand } from '../utils/commands.js';
import { useTerminalTheme } from './hooks/useTerminalTheme.js';
import { useTimedMessage } from './hooks/useTimedMessage.js';
import { useIsHelpDismissKey } from './utils/shortcutsHelp.js';
import { useSuspend } from './hooks/useSuspend.js';
import { useRunEventNotifications } from './hooks/useRunEventNotifications.js';
import {
  isNotificationsEnabled,
  getNotificationMethod,
  type TerminalNotificationMethod,
} from '../utils/terminalNotifications.js';
import {
  getLastTurnToolCallIds,
  isToolExecuting,
  isToolAwaitingConfirmation,
  getAllToolCalls,
} from './utils/historyUtils.js';

interface AppContainerProps {
  config: HiveConfig;
  startupWarnings?: StartupWarning[];
  version: string;
  initializationResult: InitializationResult;
  resumedSessionData?: ResumedSessionData;
}

interface AgentsDiscoveredPayload {
  agents: AgentDefinition[];
}

interface ConsentRequestPayload {
  prompt: string;
  onConfirm: (confirmed: boolean) => void;
}

interface MemoryChangedPayload {
  fileCount: number;
}

// Enums de session (sources de vérité locales du composant)
enum SessionStartSource {
  CLI = 'cli',
  TUI = 'tui',
  Resume = 'resume',
  Startup = 'startup',
  Clear = 'clear',
}

enum SessionEndReason {
  QUIT = 'quit',
  ERROR = 'error',
  Clear = 'clear',
  Exit = 'exit',
}

// Mocks de fonctionnalités non encore câblées dans HIVE-MIND (extensions, IDE, profiler)
interface IdeIntegrationNudgeResult {
  userSelection: 'yes' | 'no' | 'dismiss';
}

export const ideContextStore = {
  subscribe: (_callback: (state: IdeContext) => void) => {
    // noop
    return () => {};
  },
  get: (): IdeContext => ({ editors: [], trustLevel: 'trusted' }),
};

export const getAllHiveMdFilenames = (): string[] => [];
export const recordExitFail = (_config: HiveConfig): void => {};
export const startupProfiler = {
  start: () => {},
  stop: () => {},
  mark: () => {},
  flush: (_config?: unknown) => {},
};
export const buildUserSteeringHintPrompt = (_hint?: string): string => '';
export const shouldEnterAlternateScreen = (isAlt?: boolean, screenReader?: boolean): boolean =>
  TerminalScreenService.shouldEnterAlternateScreen(isAlt, screenReader);
export const enterAlternateScreen = (): void => TerminalScreenService.enterAlternateScreen();
export const disableLineWrapping = (): void => TerminalScreenService.disableLineWrapping();
const setUpdateHandler = (
  _addItem: unknown,
  _setUpdateInfo: (u: UpdateObject | null) => void,
) => {};
import { requestConsentInteractive } from '../config/extensions/consent.js';
import { relaunchApp } from '../utils/processUtils.js';
import { TerminalScreenService } from '../services/terminalScreenService.js';

import { useRepeatedKeyPress } from './hooks/useRepeatedKeyPress.js';
import {
  useVisibilityToggle,
  APPROVAL_MODE_REVEAL_DURATION_MS,
} from './hooks/useVisibilityToggle.js';
import { useKeyMatchers } from './hooks/useKeyMatchers.js';

import { InputContext } from './contexts/InputContext.js';

/**
 * The fraction of the terminal width to allocate to the shell.
 * This provides horizontal padding.
 */
const SHELL_WIDTH_FRACTION = 0.89;

/**
 * The number of lines to subtract from the available terminal height
 * for the shell. This provides vertical padding and space for other UI elements.
 */
const SHELL_HEIGHT_PADDING = 10;

interface GlobalKeypressContext {
  // Settings
  debugKeystrokeLogging: boolean;
  devtoolsEnabled: boolean;
  // State
  shortcutsHelpVisible: boolean;
  mouseMode: boolean;
  constrainHeight: boolean;
  isAlternateBuffer: boolean;
  embeddedShellFocused: boolean;
  isBackgroundTaskVisible: boolean;
  activePtyId: string | null | undefined;
  ideContextState: unknown;
  showErrorDetails: boolean;
  // Refs
  bufferRef: React.RefObject<{ text: string }>;
  recordingFilenameRef: React.RefObject<string | null>;
  lastOutputTimeRef: React.RefObject<number>;
  tabFocusTimeoutRef: React.RefObject<ReturnType<typeof setTimeout> | null>;
  backgroundTasks: Map<number, unknown>;
  // Actions
  setShortcutsHelpVisible: (v: boolean) => void;
  setMouseMode: (fn: boolean | ((prev: boolean) => boolean)) => void;
  setConstrainHeight: (fn: boolean | ((prev: boolean) => boolean)) => void;
  setCopyModeEnabled: (v: boolean) => void;
  setShowErrorDetails: (fn: boolean | ((prev: boolean) => boolean)) => void;
  setShowFullTodos: (fn: boolean | ((prev: boolean) => boolean)) => void;
  setRenderMarkdown: (fn: boolean | ((prev: boolean) => boolean)) => void;
  setEmbeddedShellFocused: (v: boolean) => void;
  setIsBackgroundTaskListOpen: (v: boolean) => void;
  handleCtrlCPress: () => void;
  handleCtrlDPress: () => void;
  handleSuspend: () => void;
  handleSlashCommand: (cmd: PartListUnion | string) => void;
  cancelOngoingRequest?: () => void;
  backgroundCurrentExecution?: () => void;
  toggleBackgroundTasks: () => void;
  refreshStatic: () => void;
  showTransientMessage: (msg: { text: string; type: TransientMessageType }) => void;
  triggerExpandHint: (v: boolean) => void;
  toggleAllExpansion: (callIds: string[]) => void;
  dumpCurrentFrame?: (filename: string) => void;
  startRecording?: (filename: string) => void;
  stopRecording?: () => void;
  keyMatchers: Record<string, (key: Key) => boolean>;
  isHelpDismissKey: (key: Key) => boolean;
  history: HistoryItem[];
  pendingHistoryItems: HistoryItemWithoutId[];
  TransientMessageType: typeof TransientMessageType;
  config: HiveConfig;
}

function handleDebugAndHelpKeys(ctx: GlobalKeypressContext, key: Key): boolean | null {
  if (ctx.debugKeystrokeLogging) {
    debugLogger.log('[DEBUG] Keystroke:', JSON.stringify(key));
  }
  if (ctx.shortcutsHelpVisible && ctx.isHelpDismissKey(key)) {
    ctx.setShortcutsHelpVisible(false);
  }
  return null; // Continue to next handlers
}

function handleMouseAndCopyKeys(ctx: GlobalKeypressContext, key: Key): boolean | null {
  if (ctx.keyMatchers[Command.TOGGLE_MOUSE_MODE](key)) {
    ctx.setMouseMode((prev: boolean) => !prev);
    if (ctx.mouseMode && !ctx.isAlternateBuffer) {
      appEvents.emit(AppEvent.ScrollToBottom);
    }
    return true;
  }
  if (ctx.isAlternateBuffer && ctx.keyMatchers[Command.TOGGLE_COPY_MODE](key)) {
    ctx.setCopyModeEnabled(true);
    disableMouseEvents();
    return true;
  }
  return null;
}

function handleAppControlKeys(ctx: GlobalKeypressContext, key: Key): boolean | null {
  if (ctx.keyMatchers[Command.QUIT](key)) {
    void ctx.cancelOngoingRequest?.();
    ctx.handleCtrlCPress();
    return true;
  }
  if (ctx.keyMatchers[Command.EXIT](key)) {
    if (ctx.bufferRef.current.text.length > 0) {
      return false;
    }
    ctx.handleCtrlDPress();
    return true;
  }
  if (ctx.keyMatchers[Command.SUSPEND_APP](key)) {
    ctx.handleSuspend();
    return null;
  }
  if (handleDumpAndRecordingKeys(ctx, key)) {
    return true;
  }
  if (ctx.keyMatchers[Command.TOGGLE_COPY_MODE](key) && !ctx.isAlternateBuffer) {
    ctx.showTransientMessage({
      text: 'Use Ctrl+O to expand and collapse blocks of content.',
      type: ctx.TransientMessageType.Warning,
    });
    return true;
  }
  return null;
}

function handleDumpAndRecordingKeys(ctx: GlobalKeypressContext, key: Key): boolean {
  if (ctx.keyMatchers[Command.DUMP_FRAME](key)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `snapshot-${timestamp}.json`;
    if (ctx.dumpCurrentFrame) {
      ctx.dumpCurrentFrame(filename);
      debugLogger.log(`Dumped frame to: ${filename}`);
    }
    return true;
  }
  if (ctx.keyMatchers[Command.START_RECORDING](key)) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `recording-${timestamp}.json`;
    if (ctx.startRecording) {
      ctx.startRecording(filename);
      ctx.recordingFilenameRef.current = filename;
      debugLogger.log(`Started recording to: ${filename}`);
    }
    return true;
  }
  if (ctx.keyMatchers[Command.STOP_RECORDING](key)) {
    if (ctx.stopRecording) {
      ctx.stopRecording();
      debugLogger.log(
        `Stopped recording, saved to: ${ctx.recordingFilenameRef.current ?? 'unknown'}`,
      );
      ctx.recordingFilenameRef.current = null;
    }
    return true;
  }
  return false;
}

function handleDisplayKeys(ctx: GlobalKeypressContext, key: Key): boolean | null {
  const toggleLastTurnTools = () => {
    ctx.triggerExpandHint(true);
    const targetToolCallIds = getLastTurnToolCallIds(ctx.history, ctx.pendingHistoryItems);
    if (targetToolCallIds.length > 0) {
      ctx.toggleAllExpansion(targetToolCallIds);
    }
  };

  let enteringConstrainHeightMode = false;
  if (!ctx.constrainHeight) {
    enteringConstrainHeightMode = true;
    ctx.setConstrainHeight(true);
    if (ctx.keyMatchers[Command.SHOW_MORE_LINES](key)) {
      toggleLastTurnTools();
    }
    if (!ctx.isAlternateBuffer) {
      ctx.refreshStatic();
    }
  }

  if (ctx.keyMatchers[Command.SHOW_ERROR_DETAILS](key)) {
    ctx.setShowErrorDetails((prev: boolean) => !prev);
    return true;
  }
  if (ctx.keyMatchers[Command.SHOW_FULL_TODOS](key)) {
    ctx.setShowFullTodos((prev: boolean) => !prev);
    return true;
  }
  if (ctx.keyMatchers[Command.TOGGLE_MARKDOWN](key)) {
    ctx.setRenderMarkdown((prev: boolean) => {
      const newValue = !prev;
      ctx.refreshStatic();
      return newValue;
    });
    return true;
  }
  if (
    ctx.keyMatchers[Command.SHOW_IDE_CONTEXT_DETAIL](key) &&
    ctx.config.getIdeMode() &&
    ctx.ideContextState
  ) {
    ctx.handleSlashCommand('/ide status');
    return true;
  }
  if (ctx.keyMatchers[Command.SHOW_MORE_LINES](key) && !enteringConstrainHeightMode) {
    ctx.setConstrainHeight(false);
    toggleLastTurnTools();
    ctx.refreshStatic();
    return true;
  }
  return null;
}

function handleShellFocusKeys(ctx: GlobalKeypressContext, key: Key): boolean | null {
  if (
    ctx.keyMatchers[Command.FOCUS_SHELL_INPUT](key) ||
    ctx.keyMatchers[Command.UNFOCUS_BACKGROUND_SHELL_LIST](key)
  ) {
    return handleFocusShellInput(ctx);
  }
  if (
    ctx.keyMatchers[Command.UNFOCUS_SHELL_INPUT](key) ||
    ctx.keyMatchers[Command.UNFOCUS_BACKGROUND_SHELL](key)
  ) {
    if (ctx.embeddedShellFocused) {
      ctx.setEmbeddedShellFocused(false);
      return true;
    }
    return false;
  }
  if (ctx.keyMatchers[Command.TOGGLE_BACKGROUND_SHELL](key)) {
    return handleToggleBackgroundShell(ctx);
  }
  if (ctx.keyMatchers[Command.TOGGLE_BACKGROUND_SHELL_LIST](key)) {
    return handleToggleBackgroundShellList(ctx);
  }
  return null;
}

function handleFocusShellInput(ctx: GlobalKeypressContext): boolean | null {
  if (!ctx.activePtyId && !(ctx.isBackgroundTaskVisible && ctx.backgroundTasks.size > 0)) {
    return null;
  }
  if (ctx.embeddedShellFocused) {
    const capturedTime = ctx.lastOutputTimeRef.current;
    if (ctx.tabFocusTimeoutRef.current) clearTimeout(ctx.tabFocusTimeoutRef.current);
    ctx.tabFocusTimeoutRef.current = setTimeout(() => {
      if (ctx.lastOutputTimeRef.current === capturedTime) {
        ctx.setEmbeddedShellFocused(false);
      } else {
        ctx.showTransientMessage({
          text: 'Use Shift+Tab to unfocus',
          type: ctx.TransientMessageType.Warning,
        });
      }
    }, 150);
    return false;
  }

  const isIdle = Date.now() - ctx.lastOutputTimeRef.current >= 100;
  if (isIdle && !ctx.activePtyId && !ctx.isBackgroundTaskVisible) {
    if (ctx.tabFocusTimeoutRef.current) clearTimeout(ctx.tabFocusTimeoutRef.current);
    ctx.toggleBackgroundTasks();
    ctx.setEmbeddedShellFocused(true);
    if (ctx.backgroundTasks.size > 1) ctx.setIsBackgroundTaskListOpen(true);
    return true;
  }

  ctx.setEmbeddedShellFocused(true);
  return true;
}

function handleToggleBackgroundShell(ctx: GlobalKeypressContext): boolean {
  if (ctx.activePtyId) {
    ctx.backgroundCurrentExecution?.();
  } else {
    ctx.toggleBackgroundTasks();
    if (!ctx.isBackgroundTaskVisible && ctx.backgroundTasks.size > 0) {
      ctx.setEmbeddedShellFocused(true);
      if (ctx.backgroundTasks.size > 1) {
        ctx.setIsBackgroundTaskListOpen(true);
      }
    } else {
      ctx.setEmbeddedShellFocused(false);
    }
  }
  return true;
}

function handleToggleBackgroundShellList(ctx: GlobalKeypressContext): boolean {
  if (ctx.backgroundTasks.size > 0 && ctx.isBackgroundTaskVisible) {
    if (!ctx.embeddedShellFocused) {
      ctx.setEmbeddedShellFocused(true);
    }
    ctx.setIsBackgroundTaskListOpen(true);
  }
  return true;
}

interface SubmitContext {
  isSlash: boolean;
  isIdle: boolean;
  isAgentRunning: boolean;
  isMcpOrConfigReady: boolean;
  isCompressing: boolean;
  isConfigInitialized: boolean;
  config: HiveConfig;
  submittedValue: string;
  slashCommands: readonly SlashCommand[] | null | undefined;
  handleSlashCommand: (cmd: PartListUnion | string) => void;
  handleHintSubmit: (hint: string) => void;
  submitQuery: (
    query: Part[] | string,
    options?: { isContinuation: boolean },
    _prompt_id?: string,
  ) => void | Promise<void>;
  addInput: (input: string) => void;
  addMessage: (msg: string) => void;
  setPermissionConfirmationRequest: (req: PermissionConfirmationRequest | null) => void;
  messageQueueLength: number;
}

type SubmitResult = 'handled' | 'queued' | 'pending';

function trySlashCommandWhileRunning(ctx: SubmitContext): SubmitResult | null {
  if (!ctx.isSlash || !ctx.isAgentRunning) return null;
  const { commandToExecute } = parseSlashCommand(ctx.submittedValue, ctx.slashCommands ?? []);
  if (commandToExecute?.isSafeConcurrent) {
    void ctx.handleSlashCommand(ctx.submittedValue);
    return 'handled';
  }
  return null;
}

function tryHintWhileRunning(ctx: SubmitContext): SubmitResult | null {
  if (!ctx.config.isModelSteeringEnabled() || !ctx.isAgentRunning || ctx.isSlash) return null;
  ctx.handleHintSubmit(ctx.submittedValue);
  return 'handled';
}

async function trySubmitWithPermissions(ctx: SubmitContext): Promise<SubmitResult> {
  const canSubmit =
    (ctx.isSlash && ctx.isConfigInitialized) ||
    (!ctx.isCompressing && ctx.isIdle && ctx.isMcpOrConfigReady);
  if (!canSubmit) return 'queued';

  if (!ctx.isSlash) {
    const permissions = await checkPermissions(ctx.submittedValue, ctx.config);
    if (permissions.length > 0) {
      ctx.setPermissionConfirmationRequest({
        id: `permission-${Date.now()}`,
        permission: 'read_only_paths',
        files: permissions,
        onAllow: () => {
          ctx.setPermissionConfirmationRequest(null);
          permissions.forEach((p: string) => ctx.config.getWorkspaceContext().addReadOnlyPath(p));
          void ctx.submitQuery(ctx.submittedValue);
        },
        onDeny: () => {
          ctx.setPermissionConfirmationRequest(null);
          void ctx.submitQuery(ctx.submittedValue);
        },
        onComplete: (result: { allowed: boolean }) => {
          ctx.setPermissionConfirmationRequest(null);
          if (result.allowed) {
            permissions.forEach((p: string) => ctx.config.getWorkspaceContext().addReadOnlyPath(p));
          }
          void ctx.submitQuery(ctx.submittedValue);
        },
      });
      return 'pending';
    }
  }
  ctx.submitQuery(ctx.submittedValue);
  return 'handled';
}

function handleQueuedSubmit(ctx: SubmitContext): void {
  if (ctx.isIdle && !ctx.isCompressing && !ctx.isMcpOrConfigReady && ctx.messageQueueLength === 0) {
    coreEvents.emitFeedback(
      'info',
      !ctx.isConfigInitialized
        ? 'Initializing... Prompts will be queued.'
        : 'Waiting for MCP servers to initialize... Slash commands are still available and prompts will be queued.',
    );
  }
  ctx.addMessage(ctx.submittedValue);
}

interface CoreEventSubscriptionsParams {
  config: HiveConfig;
  setCurrentModel: (model: string) => void;
  setSettingsNonce: React.Dispatch<React.SetStateAction<number>>;
  setAdminSettingsChanged: React.Dispatch<React.SetStateAction<boolean>>;
  setNewAgents: React.Dispatch<React.SetStateAction<AgentDefinition[] | null>>;
  setAuthConsentRequest: React.Dispatch<React.SetStateAction<ConfirmationRequest | null>>;
  setHiveMdFileCount: React.Dispatch<React.SetStateAction<number>>;
  historyManager: ReturnType<typeof useHistory>;
}

function useCoreEventSubscriptions(params: CoreEventSubscriptionsParams): void {
  const {
    config,
    setCurrentModel,
    setSettingsNonce,
    setAdminSettingsChanged,
    setNewAgents,
    setAuthConsentRequest,
    setHiveMdFileCount,
    historyManager,
  } = params;

  // Subscribe to fallback mode and model changes from core
  useEffect(() => {
    const handleModelChanged = () => {
      setCurrentModel(config.getModel());
    };

    coreEvents.on(CoreEvent.ModelChanged, handleModelChanged);
    return () => {
      coreEvents.off(CoreEvent.ModelChanged, handleModelChanged);
    };
  }, [config, setCurrentModel]);

  useEffect(() => {
    const handleSettingsChanged = () => {
      setSettingsNonce((prev) => prev + 1);
    };

    const handleAdminSettingsChanged = () => {
      setAdminSettingsChanged(true);
    };

    const handleAgentsDiscovered = (payload: AgentsDiscoveredPayload) => {
      setNewAgents(payload.agents);
    };

    coreEvents.on(CoreEvent.SettingsChanged, handleSettingsChanged);
    coreEvents.on(CoreEvent.AdminSettingsChanged, handleAdminSettingsChanged);
    coreEvents.on(CoreEvent.AgentsDiscovered, handleAgentsDiscovered);
    return () => {
      coreEvents.off(CoreEvent.SettingsChanged, handleSettingsChanged);
      coreEvents.off(CoreEvent.AdminSettingsChanged, handleAdminSettingsChanged);
      coreEvents.off(CoreEvent.AgentsDiscovered, handleAgentsDiscovered);
    };
  }, [setSettingsNonce, setAdminSettingsChanged, setNewAgents]);

  useEffect(() => {
    const handleConsentRequest = (payload: ConsentRequestPayload) => {
      setAuthConsentRequest({
        prompt: payload.prompt,
        onConfirm: (confirmed: boolean) => {
          setAuthConsentRequest(null);
          payload.onConfirm(confirmed);
        },
      });
    };

    coreEvents.on(CoreEvent.ConsentRequest, handleConsentRequest);
    return () => {
      coreEvents.off(CoreEvent.ConsentRequest, handleConsentRequest);
    };
  }, [setAuthConsentRequest]);

  useEffect(() => {
    const handleMemoryChanged = (result: MemoryChangedPayload) => {
      setHiveMdFileCount(result.fileCount);
    };
    coreEvents.on(CoreEvent.MemoryChanged, handleMemoryChanged);
    return () => {
      coreEvents.off(CoreEvent.MemoryChanged, handleMemoryChanged);
    };
  }, [setHiveMdFileCount]);

  useEffect(() => {
    const handleUserFeedback = (payload: UserFeedbackPayload) => {
      let type: MessageType;
      switch (payload.severity) {
        case 'error':
          type = MessageType.ERROR;
          break;
        case 'warning':
          type = MessageType.WARNING;
          break;
        case 'info':
          type = MessageType.INFO;
          break;
        default:
          throw new Error(`Unexpected severity for user feedback: ${payload.severity}`);
      }

      historyManager.addItem(
        {
          type,
          text: payload.message,
        },
        Date.now(),
      );

      // If there is an attached error object, log it to the debug drawer.
      if (payload.error) {
        debugLogger.warn(`[Feedback Details for "${payload.message}"]`, payload.error);
      }
    };

    const handleHookSystemMessage = (payload: HookSystemMessagePayload) => {
      historyManager.addItem(
        {
          type: MessageType.INFO,
          text: payload.message,
          source: payload.hookName,
        },
        Date.now(),
      );
    };

    coreEvents.on(CoreEvent.UserFeedback, handleUserFeedback);
    coreEvents.on(CoreEvent.HookSystemMessage, handleHookSystemMessage);

    // Flush any messages that happened during startup before this component
    // mounted.
    coreEvents.drainBacklogs();

    return () => {
      coreEvents.off(CoreEvent.UserFeedback, handleUserFeedback);
      coreEvents.off(CoreEvent.HookSystemMessage, handleHookSystemMessage);
    };
  }, [historyManager]);
}

interface UiStateDeps {
  history: HistoryItem[];
  historyManager: ReturnType<typeof useHistory>;
  isThemeDialogOpen: boolean;
  themeError: string | null;
  isConfigInitialized: boolean;
  accountSuspensionInfo: AccountSuspensionInfo | null;
  isAwaitingLoginRestart: boolean;
  loginRestartMessage?: string;
  apiKeyDefaultValue?: string;
  editorError: string | null;
  isEditorDialogOpen: boolean;
  showPrivacyNotice: boolean;
  mouseMode: boolean;
  corgiMode: boolean;
  debugMessage: string;
  quittingMessages: HistoryItem[] | null;
  isSettingsDialogOpen: boolean;
  isSessionBrowserOpen: boolean;
  isModelDialogOpen: boolean;
  isAgentConfigDialogOpen: boolean;
  selectedAgentName: string | undefined;
  selectedAgentDisplayName: string | undefined;
  selectedAgentDefinition: AgentDefinition | undefined;
  isPermissionsDialogOpen: boolean;
  permissionsDialogProps: { targetDirectory?: string } | null;
  slashCommands: readonly SlashCommand[] | undefined;
  pendingSlashCommandHistoryItems: HistoryItemWithoutId[];
  commandContext: CommandContext;
  commandConfirmationRequest: ConfirmationRequest | null;
  authConsentRequest: ConfirmationRequest | null;
  confirmUpdateExtensionRequests: ConfirmationRequest[];
  loopDetectionConfirmationRequest: LoopDetectionConfirmationRequest | null;
  permissionConfirmationRequest: PermissionConfirmationRequest | null;
  hiveMdFileCount: number;
  streamingState: StreamingState;
  initError: string | null;
  pendingAssistantHistoryItems: HistoryItemWithoutId[];
  thought: ThoughtSummary | null;
  isInputActive: boolean;
  isResuming: boolean;
  shouldShowIdePrompt: boolean;
  isFolderTrustDialogOpen: boolean;
  folderDiscoveryResults: FolderDiscoveryResults | null;
  isPolicyUpdateDialogOpen: boolean;
  policyUpdateConfirmationRequest: PolicyUpdateConfirmationRequest | undefined;
  isTrustedFolder: boolean | undefined;
  constrainHeight: boolean;
  showErrorDetails: boolean;
  showFullTodos: boolean;
  ideContextState: IdeContext | undefined;
  renderMarkdown: boolean;
  ctrlCPressCount: number;
  ctrlDPressCount: number;
  shortcutsHelpVisible: boolean;
  cleanUiDetailsVisible: boolean;
  elapsedTime: number;
  currentLoadingPhrase: string | undefined;
  currentTip: string | undefined;
  currentWittyPhrase: string | undefined;
  historyRemountKey: number;
  activeHooks: ActiveHook[];
  messageQueue: string[];
  queueErrorMessage: string | null;
  showApprovalModeIndicator: ApprovalMode;
  allowPlanMode: boolean;
  currentModel: string;
  contextFileNames: string[];
  errorCount: number;
  availableTerminalHeight: number;
  stableControlsHeight: number;
  mainAreaWidth: number;
  staticAreaMaxItemHeight: number;
  staticExtraHeight: number;
  dialogsVisible: boolean;
  pendingHistoryItems: HistoryItemWithoutId[];
  nightly: boolean;
  branchName: string | undefined;
  sessionStats: SessionStatsState;
  terminalWidth: number;
  terminalHeight: number;
  mainControlsRef: (node: DOMElement | null) => void;
  rootUiRef: React.MutableRefObject<DOMElement | null>;
  currentIDE: IdeInfo | null;
  updateInfo: UpdateObject | null;
  showIdeRestartPrompt: boolean;
  ideTrustRestartReason: string | undefined;
  isRestarting: boolean;
  extensionsUpdateState: Map<string, ExtensionUpdateState>;
  activePtyId: number | undefined;
  backgroundTaskCount: number;
  isBackgroundTaskVisible: boolean;
  embeddedShellFocused: boolean;
  showDebugProfiler: boolean;
  customDialog: React.ReactNode | null;
  transientMessage: { text: string; type: TransientMessageType } | null;
  bannerData: { defaultText: string; warningText: string };
  bannerVisible: boolean;
  terminalBackgroundColor: TerminalBackgroundColor;
  settingsNonce: number;
  backgroundTasks: Map<number, BackgroundTask>;
  activeBackgroundTaskPid: number | null;
  backgroundTaskHeight: number;
  isBackgroundTaskListOpen: boolean;
  adminSettingsChanged: boolean;
  newAgents: AgentDefinition[] | null;
  showIsExpandableHint: boolean;
  hintMode: boolean;
  config: HiveConfig;
  isToolExecutingValue: boolean;
}

function buildUiState(deps: UiStateDeps): UIState {
  return {
    history: deps.history,
    historyManager: deps.historyManager,
    isThemeDialogOpen: deps.isThemeDialogOpen,
    themeError: deps.themeError,
    isConfigInitialized: deps.isConfigInitialized,
    accountSuspensionInfo: deps.accountSuspensionInfo,
    isAwaitingApiKeyInput: false,
    isAwaitingLoginRestart: deps.isAwaitingLoginRestart,
    loginRestartMessage: deps.loginRestartMessage,
    apiKeyDefaultValue: deps.apiKeyDefaultValue,
    editorError: deps.editorError,
    isEditorDialogOpen: deps.isEditorDialogOpen,
    showPrivacyNotice: deps.showPrivacyNotice,
    mouseMode: deps.mouseMode,
    corgiMode: deps.corgiMode,
    debugMessage: deps.debugMessage,
    quittingMessages: deps.quittingMessages,
    isSettingsDialogOpen: deps.isSettingsDialogOpen,
    isSessionBrowserOpen: deps.isSessionBrowserOpen,
    isModelDialogOpen: deps.isModelDialogOpen,
    isAgentConfigDialogOpen: deps.isAgentConfigDialogOpen,
    selectedAgentName: deps.selectedAgentName,
    selectedAgentDisplayName: deps.selectedAgentDisplayName,
    selectedAgentDefinition: deps.selectedAgentDefinition,
    isPermissionsDialogOpen: deps.isPermissionsDialogOpen,
    permissionsDialogProps: deps.permissionsDialogProps,
    slashCommands: deps.slashCommands,
    pendingSlashCommandHistoryItems: deps.pendingSlashCommandHistoryItems,
    commandContext: deps.commandContext,
    commandConfirmationRequest: deps.commandConfirmationRequest,
    authConsentRequest: deps.authConsentRequest,
    confirmUpdateExtensionRequests: deps.confirmUpdateExtensionRequests,
    loopDetectionConfirmationRequest: deps.loopDetectionConfirmationRequest,
    permissionConfirmationRequest: deps.permissionConfirmationRequest,
    hiveMdFileCount: deps.hiveMdFileCount,
    streamingState: deps.streamingState,
    initError: deps.initError,
    pendingAssistantHistoryItems: deps.pendingAssistantHistoryItems,
    thought: deps.thought,
    isInputActive: deps.isInputActive,
    isResuming: deps.isResuming,
    shouldShowIdePrompt: deps.shouldShowIdePrompt,
    isFolderTrustDialogOpen: deps.isFolderTrustDialogOpen,
    folderDiscoveryResults: deps.folderDiscoveryResults,
    isPolicyUpdateDialogOpen: deps.isPolicyUpdateDialogOpen,
    policyUpdateConfirmationRequest: deps.policyUpdateConfirmationRequest,
    isTrustedFolder: deps.isTrustedFolder,
    constrainHeight: deps.constrainHeight,
    showErrorDetails: deps.showErrorDetails,
    showFullTodos: deps.showFullTodos,
    ideContextState: deps.ideContextState,
    renderMarkdown: deps.renderMarkdown,
    ctrlCPressedOnce: deps.ctrlCPressCount >= 1,
    ctrlDPressedOnce: deps.ctrlDPressCount >= 1,
    shortcutsHelpVisible: deps.shortcutsHelpVisible,
    cleanUiDetailsVisible: deps.cleanUiDetailsVisible,
    elapsedTime: deps.elapsedTime,
    currentLoadingPhrase: deps.currentLoadingPhrase,
    currentTip: deps.currentTip,
    currentWittyPhrase: deps.currentWittyPhrase,
    historyRemountKey: deps.historyRemountKey,
    activeHooks: deps.activeHooks,
    messageQueue: deps.messageQueue,
    queueErrorMessage: deps.queueErrorMessage,
    showApprovalModeIndicator: deps.showApprovalModeIndicator,
    allowPlanMode: deps.allowPlanMode,
    currentModel: deps.currentModel,
    contextFileNames: deps.contextFileNames,
    errorCount: deps.errorCount,
    availableTerminalHeight: deps.availableTerminalHeight,
    stableControlsHeight: deps.stableControlsHeight,
    mainAreaWidth: deps.mainAreaWidth,
    staticAreaMaxItemHeight: deps.staticAreaMaxItemHeight,
    staticExtraHeight: deps.staticExtraHeight,
    dialogsVisible: deps.dialogsVisible,
    pendingHistoryItems: deps.pendingHistoryItems,
    nightly: deps.nightly,
    branchName: deps.branchName,
    sessionStats: deps.sessionStats,
    terminalWidth: deps.terminalWidth,
    terminalHeight: deps.terminalHeight,
    mainControlsRef: deps.mainControlsRef,
    rootUiRef: deps.rootUiRef,
    currentIDE: deps.currentIDE,
    updateInfo: deps.updateInfo,
    showIdeRestartPrompt: deps.showIdeRestartPrompt,
    ideTrustRestartReason: deps.ideTrustRestartReason,
    isRestarting: deps.isRestarting,
    extensionsUpdateState: deps.extensionsUpdateState,
    activePtyId: deps.activePtyId,
    backgroundTaskCount: deps.backgroundTaskCount,
    isBackgroundTaskVisible: deps.isBackgroundTaskVisible,
    embeddedShellFocused: deps.embeddedShellFocused,
    showDebugProfiler: deps.showDebugProfiler,
    customDialog: deps.customDialog,
    transientMessage: deps.transientMessage,
    bannerData: deps.bannerData,
    bannerVisible: deps.bannerVisible,
    terminalBackgroundColor: deps.terminalBackgroundColor,
    settingsNonce: deps.settingsNonce,
    backgroundTasks: deps.backgroundTasks,
    activeBackgroundTaskPid: deps.activeBackgroundTaskPid,
    backgroundTaskHeight: deps.backgroundTaskHeight,
    isBackgroundTaskListOpen: deps.isBackgroundTaskListOpen,
    adminSettingsChanged: deps.adminSettingsChanged,
    newAgents: deps.newAgents,
    showIsExpandableHint: deps.showIsExpandableHint,
    hintMode: deps.hintMode,
    hintBuffer: '',
  };
}

function useAppKeypress(params: {
  handleGlobalKeypress: (key: Key) => boolean;
  keyMatchers: Record<string, (key: Key) => boolean>;
  copyModeEnabled: boolean;
  mouseMode: boolean;
  setCopyModeEnabled: (v: boolean) => void;
}): void {
  const { handleGlobalKeypress, keyMatchers, copyModeEnabled, mouseMode, setCopyModeEnabled } =
    params;

  useKeypress(handleGlobalKeypress, { isActive: true, priority: true });

  useKeypress(
    (key: Key) => {
      if (
        keyMatchers[Command.SCROLL_UP](key) ||
        keyMatchers[Command.SCROLL_DOWN](key) ||
        keyMatchers[Command.PAGE_UP](key) ||
        keyMatchers[Command.PAGE_DOWN](key) ||
        keyMatchers[Command.SCROLL_HOME](key) ||
        keyMatchers[Command.SCROLL_END](key)
      ) {
        return false;
      }

      setCopyModeEnabled(false);
      if (mouseMode) {
        enableMouseEvents();
      }
      return true;
    },
    {
      isActive: copyModeEnabled,
      // We need to receive keypresses first so they do not bubble to other
      // handlers.
      priority: KeypressPriority.Critical,
    },
  );
}

function useSessionLifecycle(params: {
  config: HiveConfig;
  resumedSessionData?: ResumedSessionData;
  setConfigInitialized: (v: boolean) => void;
  backgroundTasksRef: React.MutableRefObject<Map<number, BackgroundTask>>;
  handleFinalSubmitRef: React.MutableRefObject<(submittedValue: string) => void>;
}): void {
  const {
    config,
    resumedSessionData,
    setConfigInitialized,
    backgroundTasksRef,
    handleFinalSubmitRef,
  } = params;

  useEffect(() => {
    (async () => {
      // Note: the program will not work if this fails so let errors be
      // handled by the global catch.
      if (!config.isInitialized()) {
        await config.initialize();
      }
      setConfigInitialized(true);
      startupProfiler.flush(config);

      startAutoMemoryIfEnabled(config);

      const sessionStartSource = resumedSessionData
        ? SessionStartSource.Resume
        : SessionStartSource.Startup;
      const result = await config.getHookSystem()?.fireSessionStartEvent(sessionStartSource);

      if (
        typeof result === 'object' &&
        result !== null &&
        'getAdditionalContext' in result &&
        typeof (result as { getAdditionalContext?: () => unknown }).getAdditionalContext ===
          'function'
      ) {
        const additionalContext = (
          result as { getAdditionalContext: () => unknown }
        ).getAdditionalContext();
        if (typeof additionalContext === 'string' && additionalContext) {
          handleFinalSubmitRef.current(`<hook_context>${additionalContext}</hook_context>`);
        }
      }
    })();
    const cleanupFn = async () => {
      // Turn off mouse scroll.
      disableMouseEvents();

      // Kill all background shells
      await Promise.all(
        Array.from(backgroundTasksRef.current.keys()).map((pid) => {
          try {
            process.kill(pid, 'SIGTERM');
          } catch {
            // Process already exited.
          }
        }),
      );

      // Fire SessionEnd hook on cleanup (only if hooks are enabled)
      await config?.getHookSystem()?.fireSessionEndEvent(SessionEndReason.Exit);
    };
    registerCleanup(cleanupFn);

    return () => {
      removeCleanup(cleanupFn);
      cleanupFn().catch((e: unknown) => debugLogger.error('Error during cleanup:', e));
    };
  }, [config, resumedSessionData, setConfigInitialized, backgroundTasksRef, handleFinalSubmitRef]);
}

function dispatchGlobalKeypress(ctx: GlobalKeypressContext, key: Key): boolean {
  const handlers = [
    handleDebugAndHelpKeys,
    handleMouseAndCopyKeys,
    handleAppControlKeys,
    handleDisplayKeys,
    handleShellFocusKeys,
  ];
  for (const handler of handlers) {
    const result = handler(ctx, key);
    if (result !== null) return result;
  }
  return false;
}

async function executeFinalSubmit(ctx: SubmitContext): Promise<void> {
  const slashResult = trySlashCommandWhileRunning(ctx);
  if (slashResult) {
    ctx.addInput(ctx.submittedValue);
    return;
  }

  const hintResult = tryHintWhileRunning(ctx);
  if (hintResult) {
    return;
  }

  const submitResult = await trySubmitWithPermissions(ctx);
  if (submitResult === 'handled') {
    ctx.addInput(ctx.submittedValue);
    return;
  }
  if (submitResult === 'pending') {
    ctx.addInput(ctx.submittedValue);
    return;
  }

  handleQueuedSubmit(ctx);
  ctx.addInput(ctx.submittedValue);
}

async function handleRestartAction(config: HiveConfig): Promise<void> {
  if (process.send) {
    const remoteSettings = config.getRemoteAdminSettings();
    if (remoteSettings) {
      process.send({
        type: 'admin-settings-update',
        settings: remoteSettings,
      });
    }
  }
  await relaunchApp();
}

async function handleNewAgentsSelectAction(params: {
  newAgents: AgentDefinition[] | null;
  choice: NewAgentsChoice;
  config: HiveConfig;
  historyManager: ReturnType<typeof useHistory>;
  setNewAgents: React.Dispatch<React.SetStateAction<AgentDefinition[] | null>>;
}): Promise<void> {
  const { newAgents, choice, config, historyManager, setNewAgents } = params;
  if (newAgents && choice === NewAgentsChoice.ACKNOWLEDGE) {
    const registry = config.getAgentRegistry();
    try {
      await Promise.all(newAgents.map((agent) => registry.acknowledgeAgent(agent)));
    } catch (error) {
      debugLogger.error('Failed to acknowledge agents:', error);
      historyManager.addItem(
        {
          type: MessageType.ERROR,
          text: `Failed to acknowledge agents: ${getErrorMessage(error)}`,
        },
        Date.now(),
      );
    }
  }
  setNewAgents(null);
}

function computeDialogsVisible(params: {
  shouldShowIdePrompt: boolean;
  isFolderTrustDialogOpen: boolean;
  isPolicyUpdateDialogOpen: boolean;
  adminSettingsChanged: boolean;
  commandConfirmationRequest: ConfirmationRequest | null;
  authConsentRequest: ConfirmationRequest | null;
  permissionConfirmationRequest: PermissionConfirmationRequest | null;
  customDialog: React.ReactNode | null;
  confirmUpdateExtensionRequests: ConfirmationRequest[];
  loopDetectionConfirmationRequest: LoopDetectionConfirmationRequest | null;
  isThemeDialogOpen: boolean;
  isSettingsDialogOpen: boolean;
  isModelDialogOpen: boolean;
  isAgentConfigDialogOpen: boolean;
  isPermissionsDialogOpen: boolean;
  isEditorDialogOpen: boolean;
  showPrivacyNotice: boolean;
  showIdeRestartPrompt: boolean;
  isSessionBrowserOpen: boolean;
  isAwaitingLoginRestart: boolean;
  newAgents: AgentDefinition[] | null;
}): boolean {
  return (
    params.shouldShowIdePrompt ||
    params.isFolderTrustDialogOpen ||
    params.isPolicyUpdateDialogOpen ||
    params.adminSettingsChanged ||
    !!params.commandConfirmationRequest ||
    !!params.authConsentRequest ||
    !!params.permissionConfirmationRequest ||
    !!params.customDialog ||
    params.confirmUpdateExtensionRequests.length > 0 ||
    !!params.loopDetectionConfirmationRequest ||
    params.isThemeDialogOpen ||
    params.isSettingsDialogOpen ||
    params.isModelDialogOpen ||
    params.isAgentConfigDialogOpen ||
    params.isPermissionsDialogOpen ||
    params.isEditorDialogOpen ||
    params.showPrivacyNotice ||
    params.showIdeRestartPrompt ||
    params.isSessionBrowserOpen ||
    params.isAwaitingLoginRestart ||
    !!params.newAgents
  );
}

function computeDialogAndStatus(params: {
  shouldShowIdePrompt: boolean;
  isFolderTrustDialogOpen: boolean;
  isPolicyUpdateDialogOpen: boolean;
  adminSettingsChanged: boolean;
  commandConfirmationRequest: ConfirmationRequest | null;
  authConsentRequest: ConfirmationRequest | null;
  permissionConfirmationRequest: PermissionConfirmationRequest | null;
  customDialog: React.ReactNode | null;
  confirmUpdateExtensionRequests: ConfirmationRequest[];
  loopDetectionConfirmationRequest: LoopDetectionConfirmationRequest | null;
  isThemeDialogOpen: boolean;
  isSettingsDialogOpen: boolean;
  isModelDialogOpen: boolean;
  isAgentConfigDialogOpen: boolean;
  isPermissionsDialogOpen: boolean;
  isEditorDialogOpen: boolean;
  showPrivacyNotice: boolean;
  showIdeRestartPrompt: boolean;
  isSessionBrowserOpen: boolean;
  isAwaitingLoginRestart: boolean;
  newAgents: AgentDefinition[] | null;
  pendingHistoryItems: HistoryItemWithoutId[];
  embeddedShellFocused: boolean;
  isBackgroundTaskVisible: boolean;
  streamingState: StreamingState;
  activeHooks: ActiveHook[];
  hooksNotifications: boolean;
  thoughtSubject: string | undefined;
  terminalWidth: number;
}): {
  dialogsVisible: boolean;
  hasPendingActionRequired: boolean;
  maxLength: number;
} {
  const {
    shouldShowIdePrompt,
    isFolderTrustDialogOpen,
    isPolicyUpdateDialogOpen,
    adminSettingsChanged,
    commandConfirmationRequest,
    authConsentRequest,
    permissionConfirmationRequest,
    customDialog,
    confirmUpdateExtensionRequests,
    loopDetectionConfirmationRequest,
    isThemeDialogOpen,
    isSettingsDialogOpen,
    isModelDialogOpen,
    isAgentConfigDialogOpen,
    isPermissionsDialogOpen,
    isEditorDialogOpen,
    showPrivacyNotice,
    showIdeRestartPrompt,
    isSessionBrowserOpen,
    isAwaitingLoginRestart,
    newAgents,
    pendingHistoryItems,
    embeddedShellFocused,
    isBackgroundTaskVisible,
    streamingState,
    activeHooks,
    hooksNotifications,
    thoughtSubject,
    terminalWidth,
  } = params;

  const dialogsVisible = computeDialogsVisible({
    shouldShowIdePrompt,
    isFolderTrustDialogOpen,
    isPolicyUpdateDialogOpen,
    adminSettingsChanged,
    commandConfirmationRequest,
    authConsentRequest,
    permissionConfirmationRequest,
    customDialog,
    confirmUpdateExtensionRequests,
    loopDetectionConfirmationRequest,
    isThemeDialogOpen,
    isSettingsDialogOpen,
    isModelDialogOpen,
    isAgentConfigDialogOpen,
    isPermissionsDialogOpen,
    isEditorDialogOpen,
    showPrivacyNotice,
    showIdeRestartPrompt,
    isSessionBrowserOpen,
    isAwaitingLoginRestart,
    newAgents,
  });

  const hasPendingToolConfirmation = isToolAwaitingConfirmation(pendingHistoryItems);
  const hasConfirmUpdateExtensionRequests = confirmUpdateExtensionRequests.length > 0;
  const hasLoopDetectionConfirmationRequest = !!loopDetectionConfirmationRequest;

  const hasPendingActionRequired =
    hasPendingToolConfirmation ||
    !!commandConfirmationRequest ||
    !!authConsentRequest ||
    hasConfirmUpdateExtensionRequests ||
    hasLoopDetectionConfirmationRequest ||
    !!customDialog;

  const showLoadingIndicator =
    (!embeddedShellFocused || isBackgroundTaskVisible) &&
    streamingState === StreamingState.Responding &&
    !hasPendingActionRequired;

  let estimatedStatusLength = 0;
  if (activeHooks.length > 0 && hooksNotifications) {
    const hookLabel = activeHooks.length > 1 ? 'Executing Hooks' : 'Executing Hook';
    const hookNames = activeHooks
      .map((h) => h.name + (h.index && h.total && h.total > 1 ? ` (${h.index}/${h.total})` : ''))
      .join(', ');
    estimatedStatusLength = hookLabel.length + hookNames.length + 10;
  } else if (showLoadingIndicator) {
    const thoughtText = thoughtSubject || 'Waiting for model...';
    estimatedStatusLength = thoughtText.length + 25;
  } else if (hasPendingActionRequired) {
    estimatedStatusLength = 35;
  }

  return {
    dialogsVisible,
    hasPendingActionRequired,
    maxLength: terminalWidth - estimatedStatusLength - 5,
  };
}

function useDialogStates() {
  const [isPermissionsDialogOpen, setPermissionsDialogOpen] = useState(false);
  const [permissionsDialogProps, setPermissionsDialogProps] = useState<{
    targetDirectory?: string;
  } | null>(null);
  const openPermissionsDialog = useCallback((dialogProps?: { targetDirectory?: string }) => {
    setPermissionsDialogOpen(true);
    setPermissionsDialogProps(dialogProps ?? null);
  }, []);
  const closePermissionsDialog = useCallback(() => {
    setPermissionsDialogOpen(false);
    setPermissionsDialogProps(null);
  }, []);

  const [isAgentConfigDialogOpen, setIsAgentConfigDialogOpen] = useState(false);
  const [selectedAgentName, setSelectedAgentName] = useState<string | undefined>();
  const [selectedAgentDisplayName, setSelectedAgentDisplayName] = useState<string | undefined>();
  const [selectedAgentDefinition, setSelectedAgentDefinition] = useState<
    AgentDefinition | undefined
  >();

  const openAgentConfigDialog = useCallback(
    (name: string, displayName: string, definition: AgentDefinition) => {
      setSelectedAgentName(name);
      setSelectedAgentDisplayName(displayName);
      setSelectedAgentDefinition(definition);
      setIsAgentConfigDialogOpen(true);
    },
    [],
  );

  const closeAgentConfigDialog = useCallback(() => {
    setIsAgentConfigDialogOpen(false);
    setSelectedAgentName(undefined);
    setSelectedAgentDisplayName(undefined);
    setSelectedAgentDefinition(undefined);
  }, []);

  return {
    isPermissionsDialogOpen,
    permissionsDialogProps,
    openPermissionsDialog,
    closePermissionsDialog,
    isAgentConfigDialogOpen,
    selectedAgentName,
    selectedAgentDisplayName,
    selectedAgentDefinition,
    openAgentConfigDialog,
    closeAgentConfigDialog,
  };
}

function useSlashCommandActions(params: {
  closeThemeDialog: () => void;
  setQuittingMessages: (messages: HistoryItem[] | null) => void;
  setCorgiMode: React.Dispatch<React.SetStateAction<boolean>>;
  setEmbeddedShellFocused: (v: boolean) => void;
  setShortcutsHelpVisible: (fn: boolean | ((prev: boolean) => boolean)) => void;
  toggleBackgroundTasksRef: React.MutableRefObject<() => void>;
  isBackgroundTaskVisibleRef: React.MutableRefObject<boolean>;
  backgroundTasksRef: React.MutableRefObject<Map<number, BackgroundTask>>;
  setIsBackgroundTaskListOpenRef: React.MutableRefObject<(open: boolean) => void>;
  openThemeDialog: () => void;
  openEditorDialog: () => void;
  openSettingsDialog: () => void;
  openSessionBrowser: () => void;
  openModelDialog: () => void;
  openAgentConfigDialog: (name: string, displayName: string, definition: AgentDefinition) => void;
  openPermissionsDialog: (dialogProps?: { targetDirectory?: string }) => void;
  setDebugMessage: (msg: string) => void;
  toggleDebugProfiler: () => void;
  dispatchExtensionStateUpdate: () => void;
  addConfirmUpdateExtensionRequest: () => void;
  stableSetText: (text: string) => void;
  setShowPrivacyNotice: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const {
    closeThemeDialog,
    setQuittingMessages,
    setCorgiMode,
    setEmbeddedShellFocused,
    setShortcutsHelpVisible,
    toggleBackgroundTasksRef,
    isBackgroundTaskVisibleRef,
    backgroundTasksRef,
    setIsBackgroundTaskListOpenRef,
    openThemeDialog,
    openEditorDialog,
    openSettingsDialog,
    openSessionBrowser,
    openModelDialog,
    openAgentConfigDialog,
    openPermissionsDialog,
    setDebugMessage,
    toggleDebugProfiler,
    dispatchExtensionStateUpdate,
    addConfirmUpdateExtensionRequest,
    stableSetText,
    setShowPrivacyNotice,
  } = params;

  const openPrivacyNoticeAction = useCallback(() => {
    setShowPrivacyNotice(true);
  }, [setShowPrivacyNotice]);

  const quitAction = useCallback(
    (messages: HistoryItem[]) => {
      closeThemeDialog();
      setQuittingMessages(messages);
      setTimeout(async () => {
        await runExitCleanup();
        process.exit(0);
      }, 100);
    },
    [closeThemeDialog, setQuittingMessages],
  );

  const toggleCorgiModeAction = useCallback(() => {
    setCorgiMode((prev) => !prev);
  }, [setCorgiMode]);

  const toggleBackgroundTasksAction = useCallback(() => {
    toggleBackgroundTasksRef.current();
    if (!isBackgroundTaskVisibleRef.current) {
      setEmbeddedShellFocused(true);
      if (backgroundTasksRef.current.size > 1) {
        setIsBackgroundTaskListOpenRef.current(true);
      } else {
        setIsBackgroundTaskListOpenRef.current(false);
      }
    }
  }, [
    toggleBackgroundTasksRef,
    isBackgroundTaskVisibleRef,
    backgroundTasksRef,
    setIsBackgroundTaskListOpenRef,
    setEmbeddedShellFocused,
  ]);

  const toggleShortcutsHelpAction = useCallback(() => {
    setShortcutsHelpVisible((visible) => !visible);
  }, [setShortcutsHelpVisible]);

  const slashCommandActions = useMemo(
    () => ({
      openThemeDialog,
      openEditorDialog,
      openPrivacyNotice: openPrivacyNoticeAction,
      openSettingsDialog,
      openSessionBrowser,
      openModelDialog,
      openAgentConfigDialog,
      openPermissionsDialog,
      quit: quitAction,
      setDebugMessage,
      toggleCorgiMode: toggleCorgiModeAction,
      toggleDebugProfiler,
      dispatchExtensionStateUpdate,
      addConfirmUpdateExtensionRequest,
      toggleBackgroundTasks: toggleBackgroundTasksAction,
      toggleShortcutsHelp: toggleShortcutsHelpAction,
      setText: stableSetText,
    }),
    [
      openThemeDialog,
      openEditorDialog,
      openPrivacyNoticeAction,
      openSettingsDialog,
      openSessionBrowser,
      openModelDialog,
      openAgentConfigDialog,
      openPermissionsDialog,
      quitAction,
      setDebugMessage,
      toggleCorgiModeAction,
      toggleDebugProfiler,
      dispatchExtensionStateUpdate,
      addConfirmUpdateExtensionRequest,
      toggleBackgroundTasksAction,
      toggleShortcutsHelpAction,
      stableSetText,
    ],
  );

  return slashCommandActions;
}

function buildUiActions(params: {
  handleThemeSelect: (themeName: string, scope: LoadableSettingScope) => Promise<void>;
  closeThemeDialog: () => void;
  handleThemeHighlight: (highlight: string) => void;
  handleEditorSelect: (editorType: EditorType | undefined, scope: LoadableSettingScope) => void;
  exitEditorDialog: () => void;
  exitPrivacyNotice: () => void;
  closeSettingsDialog: () => void;
  closeModelDialog: () => void;
  openAgentConfigDialog: (name: string, displayName: string, definition: AgentDefinition) => void;
  closeAgentConfigDialog: () => void;
  openPermissionsDialog: (dialogProps?: { targetDirectory?: string }) => void;
  closePermissionsDialog: () => void;
  setShellModeActive: (v: boolean) => void;
  vimHandleInput: (key: Key) => void;
  handleIdePromptComplete: (result: IdeIntegrationNudgeResult) => void;
  handleFolderTrustSelect: () => void;
  setIsPolicyUpdateDialogOpen: (v: boolean) => void;
  setConstrainHeight: (fn: boolean | ((prev: boolean) => boolean)) => void;
  handleEscapePromptChange: (showPrompt: boolean) => void;
  refreshStatic: () => void;
  handleFinalSubmit: (submittedValue: string) => void | Promise<void>;
  handleClearScreen: () => void;
  openSessionBrowser: () => void;
  closeSessionBrowser: () => void;
  handleResumeSession: (session: SessionInfo) => Promise<void>;
  handleDeleteSession: (session: SessionInfo) => Promise<void>;
  setQueueErrorMessage: (msg: string) => void;
  addMessage: (msg: string) => void;
  popAllMessages: () => void;
  setBannerVisible: (v: boolean) => void;
  setShortcutsHelpVisible: (fn: boolean | ((prev: boolean) => boolean)) => void;
  setCleanUiDetailsVisible: (v: boolean) => void;
  toggleCleanUiDetailsVisible: () => void;
  revealCleanUiDetailsTemporarily: () => void;
  handleWarning: (message: string) => void;
  setEmbeddedShellFocused: (v: boolean) => void;
  dismissBackgroundTask: (pid: number) => void;
  setActiveBackgroundTaskPid: (pid: number | null) => void;
  setIsBackgroundTaskListOpen: (v: boolean) => void;
  config: HiveConfig;
  newAgents: AgentDefinition[] | null;
  historyManager: ReturnType<typeof useHistory>;
  setNewAgents: React.Dispatch<React.SetStateAction<AgentDefinition[] | null>>;
  getPreferredEditor: () => EditorType | undefined;
}): UIActions {
  const {
    handleThemeSelect,
    closeThemeDialog,
    handleThemeHighlight,
    handleEditorSelect,
    exitEditorDialog,
    exitPrivacyNotice,
    closeSettingsDialog,
    closeModelDialog,
    openAgentConfigDialog,
    closeAgentConfigDialog,
    openPermissionsDialog,
    closePermissionsDialog,
    setShellModeActive,
    vimHandleInput,
    handleIdePromptComplete,
    handleFolderTrustSelect,
    setIsPolicyUpdateDialogOpen,
    setConstrainHeight,
    handleEscapePromptChange,
    refreshStatic,
    handleFinalSubmit,
    handleClearScreen,
    openSessionBrowser,
    closeSessionBrowser,
    handleResumeSession,
    handleDeleteSession,
    setQueueErrorMessage,
    addMessage,
    popAllMessages,
    setBannerVisible,
    setShortcutsHelpVisible,
    setCleanUiDetailsVisible,
    toggleCleanUiDetailsVisible,
    revealCleanUiDetailsTemporarily,
    handleWarning,
    setEmbeddedShellFocused,
    dismissBackgroundTask,
    setActiveBackgroundTaskPid,
    setIsBackgroundTaskListOpen,
    config,
    newAgents,
    historyManager,
    setNewAgents,
    getPreferredEditor,
  } = params;

  return {
    handleThemeSelect,
    closeThemeDialog,
    handleThemeHighlight,
    handleEditorSelect,
    exitEditorDialog,
    exitPrivacyNotice,
    closeSettingsDialog,
    closeModelDialog,
    openAgentConfigDialog,
    closeAgentConfigDialog,
    openPermissionsDialog,
    closePermissionsDialog,
    setShellModeActive,
    vimHandleInput,
    handleIdePromptComplete,
    handleFolderTrustSelect,
    setIsPolicyUpdateDialogOpen,
    setConstrainHeight,
    onEscapePromptChange: handleEscapePromptChange,
    refreshStatic,
    handleFinalSubmit,
    handleClearScreen,
    openSessionBrowser,
    closeSessionBrowser,
    handleResumeSession,
    handleDeleteSession,
    setQueueErrorMessage,
    addMessage,
    popAllMessages,
    setBannerVisible,
    setShortcutsHelpVisible,
    setCleanUiDetailsVisible,
    toggleCleanUiDetailsVisible,
    revealCleanUiDetailsTemporarily,
    handleWarning,
    setEmbeddedShellFocused,
    dismissBackgroundTask,
    setActiveBackgroundTaskPid,
    setIsBackgroundTaskListOpen,
    onHintInput: () => {},
    onHintBackspace: () => {},
    onHintClear: () => {},
    onHintSubmit: () => {},
    handleRestart: () => handleRestartAction(config),
    handleNewAgentsSelect: (choice: NewAgentsChoice) =>
      handleNewAgentsSelectAction({
        newAgents,
        choice,
        config,
        historyManager,
        setNewAgents,
      }),
    getPreferredEditor: getPreferredEditor as () => EditorType | undefined,
  } as unknown as UIActions;
}

function useGlobalKeypressHandler(params: {
  settings: ReturnType<typeof useSettings>;
  shortcutsHelpVisible: boolean;
  mouseMode: boolean;
  constrainHeight: boolean;
  isAlternateBuffer: boolean;
  embeddedShellFocused: boolean;
  isBackgroundTaskVisible: boolean;
  activePtyId: string | null | undefined;
  ideContextState: IdeContext | undefined;
  showErrorDetails: boolean;
  bufferRef: React.MutableRefObject<{ text: string }>;
  recordingFilenameRef: React.MutableRefObject<string | null>;
  lastOutputTimeRef: React.MutableRefObject<number>;
  tabFocusTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  backgroundTasks: Map<number, BackgroundTask>;
  setShortcutsHelpVisible: (fn: boolean | ((prev: boolean) => boolean)) => void;
  setMouseMode: (fn: boolean | ((prev: boolean) => boolean)) => void;
  setConstrainHeight: (fn: boolean | ((prev: boolean) => boolean)) => void;
  setCopyModeEnabled: (v: boolean) => void;
  setShowErrorDetails: (fn: boolean | ((prev: boolean) => boolean)) => void;
  setShowFullTodos: (fn: boolean | ((prev: boolean) => boolean)) => void;
  setRenderMarkdown: (fn: boolean | ((prev: boolean) => boolean)) => void;
  setEmbeddedShellFocused: (v: boolean) => void;
  setIsBackgroundTaskListOpen: (v: boolean) => void;
  handleCtrlCPress: () => void;
  handleCtrlDPress: () => void;
  handleSuspend: () => void;
  handleSlashCommand: (cmd: PartListUnion | string) => void;
  cancelOngoingRequest?: () => void;
  backgroundCurrentExecution?: () => void;
  toggleBackgroundTasks: () => void;
  refreshStatic: () => void;
  showTransientMessage: (msg: { text: string; type: TransientMessageType }) => void;
  triggerExpandHint: (v: boolean | null) => void;
  toggleAllExpansion: (callIds: string[]) => void;
  dumpCurrentFrame?: (filename: string) => void;
  startRecording?: (filename: string) => void;
  stopRecording?: () => void;
  keyMatchers: Record<string, (key: Key) => boolean>;
  isHelpDismissKey: (key: Key) => boolean;
  history: HistoryItem[];
  pendingHistoryItems: HistoryItemWithoutId[];
  config: HiveConfig;
}): (key: Key) => boolean {
  const {
    settings,
    shortcutsHelpVisible,
    mouseMode,
    constrainHeight,
    isAlternateBuffer,
    embeddedShellFocused,
    isBackgroundTaskVisible,
    activePtyId,
    ideContextState,
    showErrorDetails,
    bufferRef,
    recordingFilenameRef,
    lastOutputTimeRef,
    tabFocusTimeoutRef,
    backgroundTasks,
    setShortcutsHelpVisible,
    setMouseMode,
    setConstrainHeight,
    setCopyModeEnabled,
    setShowErrorDetails,
    setShowFullTodos,
    setRenderMarkdown,
    setEmbeddedShellFocused,
    setIsBackgroundTaskListOpen,
    handleCtrlCPress,
    handleCtrlDPress,
    handleSuspend,
    handleSlashCommand,
    cancelOngoingRequest,
    backgroundCurrentExecution,
    toggleBackgroundTasks,
    refreshStatic,
    showTransientMessage,
    triggerExpandHint,
    toggleAllExpansion,
    dumpCurrentFrame,
    startRecording,
    stopRecording,
    keyMatchers,
    isHelpDismissKey,
    history,
    pendingHistoryItems,
    config,
  } = params;

  return useCallback(
    (key: Key): boolean => {
      const ctx: GlobalKeypressContext = {
        debugKeystrokeLogging: settings.merged.general.debugKeystrokeLogging,
        devtoolsEnabled: settings.merged.general.devtools,
        shortcutsHelpVisible,
        mouseMode,
        constrainHeight,
        isAlternateBuffer,
        embeddedShellFocused,
        isBackgroundTaskVisible,
        activePtyId,
        ideContextState,
        showErrorDetails,
        bufferRef,
        recordingFilenameRef,
        lastOutputTimeRef,
        tabFocusTimeoutRef,
        backgroundTasks,
        setShortcutsHelpVisible,
        setMouseMode,
        setConstrainHeight,
        setCopyModeEnabled,
        setShowErrorDetails,
        setShowFullTodos,
        setRenderMarkdown,
        setEmbeddedShellFocused,
        setIsBackgroundTaskListOpen,
        handleCtrlCPress,
        handleCtrlDPress,
        handleSuspend,
        handleSlashCommand,
        cancelOngoingRequest,
        backgroundCurrentExecution,
        toggleBackgroundTasks,
        refreshStatic,
        showTransientMessage,
        triggerExpandHint,
        toggleAllExpansion,
        dumpCurrentFrame,
        startRecording,
        stopRecording,
        keyMatchers,
        isHelpDismissKey,
        history,
        pendingHistoryItems,
        TransientMessageType,
        config,
      };
      return dispatchGlobalKeypress(ctx, key);
    },
    [
      constrainHeight,
      setConstrainHeight,
      setShowErrorDetails,
      config,
      ideContextState,
      handleCtrlCPress,
      handleCtrlDPress,
      handleSlashCommand,
      cancelOngoingRequest,
      activePtyId,
      handleSuspend,
      embeddedShellFocused,
      settings.merged.general.debugKeystrokeLogging,
      refreshStatic,
      setCopyModeEnabled,
      tabFocusTimeoutRef,
      isAlternateBuffer,
      shortcutsHelpVisible,
      backgroundCurrentExecution,
      toggleBackgroundTasks,
      backgroundTasks,
      isBackgroundTaskVisible,
      setIsBackgroundTaskListOpen,
      lastOutputTimeRef,
      showTransientMessage,
      settings.merged.general.devtools,
      showErrorDetails,
      triggerExpandHint,
      keyMatchers,
      isHelpDismissKey,
      history,
      pendingHistoryItems,
      toggleAllExpansion,
      dumpCurrentFrame,
      startRecording,
      stopRecording,
      mouseMode,
      setShortcutsHelpVisible,
      bufferRef,
      recordingFilenameRef,
      setEmbeddedShellFocused,
      setMouseMode,
      setRenderMarkdown,
      setShowFullTodos,
    ],
  );
}

function useWindowTitle(params: {
  settings: ReturnType<typeof useSettings>;
  streamingState: StreamingState;
  thoughtSubject: string | undefined;
  commandConfirmationRequest: ConfirmationRequest | null;
  shouldShowActionRequiredTitle: boolean;
  shouldShowSilentWorkingTitle: boolean;
  config: HiveConfig;
  stdout: NodeJS.WriteStream;
  lastTitleRef: React.MutableRefObject<string | null>;
}): void {
  const {
    settings,
    streamingState,
    thoughtSubject,
    commandConfirmationRequest,
    shouldShowActionRequiredTitle,
    shouldShowSilentWorkingTitle,
    config,
    stdout,
    lastTitleRef,
  } = params;

  useEffect(() => {
    // Respect hideWindowTitle settings
    if (settings.merged.ui.hideWindowTitle) return;

    const paddedTitle = computeTerminalTitle({
      streamingState,
      thoughtSubject,
      isConfirming: !!commandConfirmationRequest || shouldShowActionRequiredTitle,
      isSilentWorking: shouldShowSilentWorkingTitle,
      folderName: basename(config.getTargetDir()),
      showThoughts: !!settings.merged.ui.showStatusInTitle,
      useDynamicTitle: settings.merged.ui.dynamicWindowTitle,
    });

    // Only update the title if it's different from the last value we set
    if (lastTitleRef.current !== paddedTitle) {
      lastTitleRef.current = paddedTitle;
      stdout.write(`\x1b]0;${paddedTitle}\x07`);
    }
    // Note: We don't need to reset the window title on exit because HIVE-MIND is already doing that elsewhere
  }, [
    streamingState,
    thoughtSubject,
    commandConfirmationRequest,
    shouldShowActionRequiredTitle,
    shouldShowSilentWorkingTitle,
    settings.merged.ui.showStatusInTitle,
    settings.merged.ui.dynamicWindowTitle,
    settings.merged.ui.hideWindowTitle,
    config,
    stdout,
    lastTitleRef,
  ]);
}

function useAppEventsEffects(params: {
  tabFocusTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  ideNeedsRestart: boolean;
  setShowIdeRestartPrompt: (v: boolean) => void;
  setIdeContextState: React.Dispatch<React.SetStateAction<IdeContext | undefined>>;
  setShowErrorDetails: (fn: boolean | ((prev: boolean) => boolean)) => void;
  setConstrainHeight: (fn: boolean | ((prev: boolean) => boolean)) => void;
  config: HiveConfig;
  setShowEscapePrompt: (v: boolean) => void;
  handleSlashCommand: (cmd: PartListUnion | string) => void;
  settings: ReturnType<typeof useSettings>;
  setIdePromptAnswered: (v: boolean) => void;
  showTransientMessage: (msg: { text: string; type: TransientMessageType }) => void;
  setRawMode: (raw: boolean) => void;
  shouldUseAlternateScreen: boolean;
}) {
  const {
    tabFocusTimeoutRef,
    ideNeedsRestart,
    setShowIdeRestartPrompt,
    setIdeContextState,
    setShowErrorDetails,
    setConstrainHeight,
    config,
    setShowEscapePrompt,
    handleSlashCommand,
    settings,
    setIdePromptAnswered,
    showTransientMessage,
    setRawMode,
    shouldUseAlternateScreen,
  } = params;

  useEffect(() => {
    const handleTransientMessage = (payload: { message: string; type: TransientMessageType }) => {
      showTransientMessage({ text: payload.message, type: payload.type });
    };

    const handleSelectionWarning = () => {
      showTransientMessage({
        text: 'Press Ctrl-S to enter selection mode to copy text.',
        type: TransientMessageType.Warning,
      });
    };
    const handlePasteTimeout = () => {
      showTransientMessage({
        text: 'Paste Timed out. Possibly due to slow connection.',
        type: TransientMessageType.Warning,
      });
    };

    appEvents.on(AppEvent.TransientMessage, handleTransientMessage);
    appEvents.on(AppEvent.SelectionWarning, handleSelectionWarning);
    appEvents.on(AppEvent.PasteTimeout, handlePasteTimeout);
    const tabFocusTimeout = tabFocusTimeoutRef.current;

    return () => {
      appEvents.off(AppEvent.TransientMessage, handleTransientMessage);
      appEvents.off(AppEvent.SelectionWarning, handleSelectionWarning);
      appEvents.off(AppEvent.PasteTimeout, handlePasteTimeout);
      if (tabFocusTimeout) {
        clearTimeout(tabFocusTimeout);
      }
    };
  }, [showTransientMessage, tabFocusTimeoutRef]);

  const handleWarning = useCallback(
    (message: string) => {
      showTransientMessage({
        text: message,
        type: TransientMessageType.Warning,
      });
    },
    [showTransientMessage],
  );

  const { handleSuspend } = useSuspend({
    handleWarning,
    setRawMode,
    shouldUseAlternateScreen,
  });

  useEffect(() => {
    if (ideNeedsRestart) {
      // IDE trust changed, force a restart.
      setShowIdeRestartPrompt(true);
    }
  }, [ideNeedsRestart, setShowIdeRestartPrompt]);

  useEffect(() => {
    const unsubscribe = ideContextStore.subscribe(setIdeContextState);
    setIdeContextState(ideContextStore.get());
    return unsubscribe;
  }, [setIdeContextState]);

  useEffect(() => {
    const openDebugConsole = () => {
      setShowErrorDetails(true);
      setConstrainHeight(false);
    };
    appEvents.on(AppEvent.OpenDebugConsole, openDebugConsole);

    return () => {
      appEvents.off(AppEvent.OpenDebugConsole, openDebugConsole);
    };
  }, [config, setShowErrorDetails, setConstrainHeight]);

  const handleEscapePromptChange = useCallback(
    (showPrompt: boolean) => {
      setShowEscapePrompt(showPrompt);
    },
    [setShowEscapePrompt],
  );

  const handleIdePromptComplete = useCallback(
    (result: IdeIntegrationNudgeResult) => {
      if (result.userSelection === 'yes') {
        handleSlashCommand('/ide install');
        settings.setValue(SettingScope.User, 'ide.hasSeenNudge', true);
      } else if (result.userSelection === 'dismiss') {
        settings.setValue(SettingScope.User, 'ide.hasSeenNudge', true);
      }
      setIdePromptAnswered(true);
    },
    [handleSlashCommand, settings, setIdePromptAnswered],
  );

  return {
    handleSuspend,
    handleEscapePromptChange,
    handleIdePromptComplete,
    handleWarning,
  };
}

function useTerminalAndInput(params: {
  settings: ReturnType<typeof useSettings>;
  config: HiveConfig;
  terminalWidth: number;
  terminalHeight: number;
  stdin: NodeJS.ReadStream;
  setRawMode: (raw: boolean) => void;
  shellModeActive: boolean;
  isAlternateBuffer: boolean;
  logger: ReturnType<typeof useLogger>;
  historyManager: ReturnType<typeof useHistory>;
  setEditorError: (error: string | null) => void;
  setThemeError: (error: string | null) => void;
  initializationResultThemeError: string | null;
  addConfirmUpdateExtensionRequest: () => void;
  bannerVisible: boolean;
  bannerText: string;
  app: AppProps;
  initializeFromLogger: (logger: ReturnType<typeof useLogger>) => void;
}) {
  const {
    settings,
    config,
    terminalWidth,
    terminalHeight,
    stdin,
    setRawMode,
    shellModeActive,
    isAlternateBuffer,
    logger,
    historyManager,
    setEditorError,
    setThemeError,
    initializationResultThemeError,
    addConfirmUpdateExtensionRequest,
    bannerVisible,
    bannerText,
    app,
    initializeFromLogger,
  } = params;

  const mainAreaWidth = calculateMainAreaWidth(terminalWidth, config);
  // Derive widths for InputPrompt using shared helper
  const { inputWidth, suggestionsWidth } = useMemo(() => {
    const { inputWidth: computedInputWidth, suggestionsWidth: computedSuggestionsWidth } =
      calculatePromptWidths(mainAreaWidth);
    return { inputWidth: computedInputWidth, suggestionsWidth: computedSuggestionsWidth };
  }, [mainAreaWidth]);

  const staticAreaMaxItemHeight = Math.max(terminalHeight * 4, 100);

  const getPreferredEditor = useCallback(() => {
    const val = settings.merged.general.preferredEditor;
    return isValidEditorType(val) ? ({ id: val } as EditorType) : undefined;
  }, [settings.merged.general.preferredEditor]);

  const buffer = useTextBuffer({
    initialText: '',
    viewport: { height: 10, width: inputWidth },
    stdin,
    setRawMode,
    escapePastedPaths: true,
    shellModeActive,
    getPreferredEditor,
  });
  const bufferRef = useRef(buffer);
  useEffect(() => {
    bufferRef.current = buffer;
  }, [buffer]);

  const stableSetText = useCallback((text: string) => {
    bufferRef.current.setText(text);
  }, []);

  // Initialize input history from logger (past sessions)
  useEffect(() => {
    initializeFromLogger(logger);
  }, [logger, initializeFromLogger]);

  // One-time prompt to suggest running /terminal-setup when it would help.
  useTerminalSetupPrompt({
    addConfirmUpdateExtensionRequest,
    addItem: historyManager.addItem,
  });

  const refreshStatic = useCallback(() => {}, []);

  const shouldUseAlternateScreen = shouldEnterAlternateScreen(
    isAlternateBuffer,
    config.getScreenReader(),
  );

  const handleEditorClose = useCallback(() => {
    if (shouldUseAlternateScreen) {
      // The editor may have exited alternate buffer mode so we need to
      // enter it again to be safe.
      enterAlternateScreen();
      enableMouseEvents();
      disableLineWrapping();
      app.rerender();
    }
    terminalCapabilityManager.enableSupportedModes();
    refreshStatic();
  }, [refreshStatic, shouldUseAlternateScreen, app]);

  const { isEditorDialogOpen, openEditorDialog, handleEditorSelect, exitEditorDialog } =
    useEditorSettings(settings, setEditorError, historyManager.addItem);

  useEffect(() => {
    coreEvents.on(CoreEvent.ExternalEditorClosed, handleEditorClose);
    coreEvents.on(CoreEvent.RequestEditorSelection, openEditorDialog);
    return () => {
      coreEvents.off(CoreEvent.ExternalEditorClosed, handleEditorClose);
      coreEvents.off(CoreEvent.RequestEditorSelection, openEditorDialog);
    };
  }, [handleEditorClose, openEditorDialog]);

  const lastRefreshedBannerKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${bannerVisible}_${bannerText}`;
    if (
      !(settings.merged.ui.hideBanner || config.getScreenReader()) &&
      bannerVisible &&
      bannerText &&
      lastRefreshedBannerKeyRef.current !== key
    ) {
      lastRefreshedBannerKeyRef.current = key;
      refreshStatic();
    }
  }, [bannerVisible, bannerText, settings.merged.ui.hideBanner, config, refreshStatic]);

  const { isSettingsDialogOpen, openSettingsDialog, closeSettingsDialog } = useSettingsCommand();

  const {
    isThemeDialogOpen,
    openThemeDialog,
    closeThemeDialog,
    handleThemeSelect,
    handleThemeHighlight,
  } = useThemeCommand(
    settings,
    setThemeError,
    historyManager.addItem,
    initializationResultThemeError,
    refreshStatic,
  );
  // Poll for terminal background color changes to auto-switch theme
  useTerminalTheme(handleThemeSelect, config, refreshStatic);

  return {
    inputWidth,
    suggestionsWidth,
    staticAreaMaxItemHeight,
    mainAreaWidth,
    getPreferredEditor,
    buffer,
    bufferRef,
    stableSetText,
    refreshStatic,
    shouldUseAlternateScreen,
    isEditorDialogOpen,
    openEditorDialog,
    handleEditorSelect,
    exitEditorDialog,
    isSettingsDialogOpen,
    openSettingsDialog,
    closeSettingsDialog,
    isThemeDialogOpen,
    openThemeDialog,
    closeThemeDialog,
    handleThemeSelect,
    handleThemeHighlight,
  };
}

function useSubmitHandlers(params: {
  buffer: ReturnType<typeof useTextBuffer>;
  inputHistory: string[];
  getQueuedMessagesText: () => string;
  clearQueue: () => void;
  pendingHistoryItems: HistoryItemWithoutId[];
  config: HiveConfig;
  historyManager: ReturnType<typeof useHistory>;
  reset: () => void;
  triggerExpandHint: (v: boolean | null) => void;
  constrainHeight: boolean;
  setConstrainHeight: (fn: boolean | ((prev: boolean) => boolean)) => void;
  isAlternateBuffer: boolean;
  refreshStatic: () => void;
  streamingState: StreamingState;
  isMcpReady: boolean;
  isCompressing: boolean;
  isConfigInitialized: boolean;
  slashCommands: readonly SlashCommand[] | null | undefined;
  handleSlashCommand: (cmd: PartListUnion | string) => void;
  submitQuery: (
    query: Part[] | string,
    options?: { isContinuation: boolean },
    _prompt_id?: string,
  ) => void | Promise<void>;
  addInput: (input: string) => void;
  addMessage: (msg: string) => void;
  setPermissionConfirmationRequest: (req: PermissionConfirmationRequest | null) => void;
  messageQueueLength: number;
  clearErrorCount: () => void;
  handleFinalSubmitRef: React.MutableRefObject<(submittedValue: string) => void>;
  cancelHandlerRef: React.MutableRefObject<
    (shouldRestorePrompt?: boolean, clearBuffer?: boolean) => void
  >;
}) {
  const {
    buffer,
    inputHistory,
    getQueuedMessagesText,
    clearQueue,
    pendingHistoryItems,
    config,
    historyManager,
    reset,
    triggerExpandHint,
    constrainHeight,
    setConstrainHeight,
    isAlternateBuffer,
    refreshStatic,
    streamingState,
    isMcpReady,
    isCompressing,
    isConfigInitialized,
    slashCommands,
    handleSlashCommand,
    submitQuery,
    addInput,
    addMessage,
    setPermissionConfirmationRequest,
    messageQueueLength,
    clearErrorCount,
    handleFinalSubmitRef,
    cancelHandlerRef,
  } = params;

  cancelHandlerRef.current = useCallback(
    (shouldRestorePrompt: boolean = true, clearBuffer: boolean = false) => {
      if (!clearBuffer && isToolAwaitingConfirmation(pendingHistoryItems)) {
        return; // Don't clear - user may be composing a follow-up message
      }

      // If cancelling (shouldRestorePrompt=false):
      if (!shouldRestorePrompt) {
        // Clear the buffer if explicitly requested (e.g., Ctrl+C)
        if (clearBuffer) {
          buffer.setText('');
        }
        // Otherwise (e.g., Escape), user is in control - preserve whatever text they typed
        return;
      }

      // Restore the last message when shouldRestorePrompt=true
      const lastUserMessage = inputHistory.at(-1);
      let textToSet = lastUserMessage || '';

      const queuedText = getQueuedMessagesText();
      if (queuedText) {
        textToSet = textToSet ? `${textToSet}\n\n${queuedText}` : queuedText;
        clearQueue();
      }

      if (textToSet) {
        buffer.setText(textToSet);
      }
    },
    [buffer, inputHistory, getQueuedMessagesText, clearQueue, pendingHistoryItems],
  );

  const handleHintSubmit = useCallback(
    (hint: string) => {
      const trimmed = hint.trim();
      if (!trimmed) {
        return;
      }
      config.injectionService.addInjection(trimmed, 'user_steering');
      // Render hints with a distinct style.
      historyManager.addItem({
        type: 'hint',
        text: trimmed,
      });
    },
    [config, historyManager],
  );

  const handleClearScreen = useCallback(() => {
    reset();
    // Explicitly hide the expansion hint and clear its x-second timer when clearing the screen.
    triggerExpandHint(null);
    historyManager.clearItems();
    clearErrorCount();
    refreshStatic();
  }, [historyManager, clearErrorCount, refreshStatic, reset, triggerExpandHint]);

  const handleFinalSubmit = useCallback(
    async (submittedValue: string) => {
      reset();
      triggerExpandHint(null);
      if (!constrainHeight) {
        setConstrainHeight(true);
        if (!isAlternateBuffer) {
          refreshStatic();
        }
      }

      const ctx: SubmitContext = {
        isSlash: isSlashCommand(submittedValue.trim()),
        isIdle: streamingState === StreamingState.Idle,
        isAgentRunning:
          streamingState === StreamingState.Responding || isToolExecuting(pendingHistoryItems),
        isMcpOrConfigReady: isConfigInitialized && isMcpReady,
        isCompressing,
        isConfigInitialized,
        config,
        submittedValue,
        slashCommands,
        handleSlashCommand,
        handleHintSubmit,
        submitQuery,
        addInput,
        addMessage,
        setPermissionConfirmationRequest,
        messageQueueLength,
      };

      await executeFinalSubmit(ctx);
    },
    [
      addMessage,
      addInput,
      submitQuery,
      handleSlashCommand,
      slashCommands,
      isMcpReady,
      streamingState,
      isCompressing,
      messageQueueLength,
      pendingHistoryItems,
      config,
      constrainHeight,
      setConstrainHeight,
      isAlternateBuffer,
      refreshStatic,
      reset,
      handleHintSubmit,
      isConfigInitialized,
      triggerExpandHint,
      setPermissionConfirmationRequest,
    ],
  );

  handleFinalSubmitRef.current = handleFinalSubmit;

  const { handleInput: vimHandleInput } = useVim(buffer, handleFinalSubmit);

  return {
    handleFinalSubmit,
    handleClearScreen,
    handleHintSubmit,
    vimHandleInput,
  };
}

function useLayoutAndControls(params: {
  copyModeEnabled: boolean;
  terminalHeight: number;
  terminalWidth: number;
  backgroundTaskHeight: number;
  settings: ReturnType<typeof useSettings>;
  config: HiveConfig;
}) {
  const { copyModeEnabled, terminalHeight, terminalWidth, backgroundTaskHeight, settings, config } =
    params;

  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
    },
    [],
  );

  const [controlsHeight, setControlsHeight] = useState(0);
  const lastNonCopyControlsHeightRef = useRef(0);

  const stableControlsHeight =
    copyModeEnabled && lastNonCopyControlsHeightRef.current > 0
      ? lastNonCopyControlsHeightRef.current
      : controlsHeight;

  const mainControlsRef = useCallback(
    (node: DOMElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }

      if (node) {
        const observer = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (entry) {
            const roundedHeight = Math.round(entry.contentRect.height);
            if (!copyModeEnabled && roundedHeight > 0) {
              lastNonCopyControlsHeightRef.current = roundedHeight;
            }
            setControlsHeight((prev) => (roundedHeight !== prev ? roundedHeight : prev));
          }
        });
        observer.observe(node);
        observerRef.current = observer;
      }
    },
    [copyModeEnabled],
  );

  // Compute available terminal height based on stable controls measurement
  const availableTerminalHeight = Math.max(
    0,
    terminalHeight - stableControlsHeight - backgroundTaskHeight - 1,
  );

  config.setShellExecutionConfig({
    terminalWidth: Math.floor(terminalWidth * SHELL_WIDTH_FRACTION),
    terminalHeight: Math.max(Math.floor(availableTerminalHeight - SHELL_HEIGHT_PADDING), 1),
    pager: settings.merged.tools.shell.pager,
    showColor: settings.merged.tools.shell.showColor,
    sanitizationConfig: config.sanitizationConfig,
    sandboxManager: config.sandboxManager,
  });

  const { isFocused, hasReceivedFocusEvent } = useFocus();

  // Context file names computation
  const contextFileNames = useMemo(() => {
    const fromSettings = settings.merged.context.fileName;
    if (fromSettings) {
      return Array.isArray(fromSettings) ? fromSettings : [fromSettings];
    }
    return getAllHiveMdFilenames();
  }, [settings.merged.context.fileName]);
  // Initial prompt handling
  const initialPrompt = useMemo(() => config.getQuestion(), [config]);
  const initialPromptSubmitted = useRef(false);
  const isConnectedToCore = hiveCoreConnection.getConnectionStatus() === 'connected';

  return {
    stableControlsHeight,
    mainControlsRef,
    availableTerminalHeight,
    isFocused,
    hasReceivedFocusEvent,
    contextFileNames,
    initialPrompt,
    initialPromptSubmitted,
    isConnectedToCore,
  };
}

function useStatusAndNotifications(params: {
  settings: ReturnType<typeof useSettings>;
  streamingState: StreamingState;
  shouldShowFocusHint: boolean;
  retryStatus: RetryAttemptPayload | null;
  showStatusTips: boolean;
  showStatusWit: boolean;
  maxLength: number;
  config: HiveConfig;
  historyManager: ReturnType<typeof useHistory>;
  handleApprovalModeChangeWithUiReveal: (mode: ApprovalMode) => void;
  embeddedShellFocused: boolean;
  hasPendingActionRequired: boolean;
  notificationsEnabled: boolean;
  notificationMethod: TerminalNotificationMethod;
  isFocused: boolean;
  hasReceivedFocusEvent: boolean;
  pendingHistoryItems: HistoryItemWithoutId[];
  commandConfirmationRequest: ConfirmationRequest | null;
  authConsentRequest: ConfirmationRequest | null;
  permissionConfirmationRequest: PermissionConfirmationRequest | null;
  confirmUpdateExtensionRequests: ConfirmationRequest[];
  loopDetectionConfirmationRequest: LoopDetectionConfirmationRequest | null;
  shortcutsHelpVisible: boolean;
  setShortcutsHelpVisible: (fn: boolean | ((prev: boolean) => boolean)) => void;
  isInputActive: boolean;
  isConfigInitialized: boolean;
  isMcpReady: boolean;
  submitQuery: (
    query: Part[] | string,
    options?: { isContinuation: boolean },
    _prompt_id?: string,
  ) => void | Promise<void>;
  consumePendingHints: () => string | null;
  pendingHintCount: number;
}) {
  const {
    settings,
    streamingState,
    shouldShowFocusHint,
    retryStatus,
    showStatusTips,
    showStatusWit,
    maxLength,
    config,
    historyManager,
    handleApprovalModeChangeWithUiReveal,
    embeddedShellFocused,
    hasPendingActionRequired,
    notificationsEnabled,
    notificationMethod,
    isFocused,
    hasReceivedFocusEvent,
    pendingHistoryItems,
    commandConfirmationRequest,
    authConsentRequest,
    permissionConfirmationRequest,
    confirmUpdateExtensionRequests,
    loopDetectionConfirmationRequest,
    shortcutsHelpVisible,
    setShortcutsHelpVisible,
    isInputActive,
    isConfigInitialized,
    isMcpReady,
    submitQuery,
    consumePendingHints,
    pendingHintCount,
  } = params;

  const customWittyPhrases = useMemo(
    () => settings.merged.ui.customWittyPhrases,
    [settings.merged.ui.customWittyPhrases],
  );

  const hasConfirmUpdateExtensionRequests = confirmUpdateExtensionRequests.length > 0;
  const hasLoopDetectionConfirmationRequest = !!loopDetectionConfirmationRequest;

  const { elapsedTime, currentLoadingPhrase, currentTip, currentWittyPhrase } = useLoadingIndicator(
    {
      streamingState,
      shouldShowFocusHint,
      retryStatus,
      showTips: showStatusTips,
      showWit: showStatusWit,
      customWittyPhrases,
      errorVerbosity: settings.merged.ui.errorVerbosity as 'low' | 'full',
      maxLength,
    },
  );

  const allowPlanMode =
    config.isPlanEnabled() && streamingState === StreamingState.Idle && !hasPendingActionRequired;

  const showApprovalModeIndicator = useApprovalModeIndicator({
    config,
    addItem: historyManager.addItem,
    onApprovalModeChange: handleApprovalModeChangeWithUiReveal,
    isActive: !embeddedShellFocused,
    allowPlanMode,
  });

  useRunEventNotifications({
    notificationsEnabled,
    notificationMethod,
    isFocused,
    hasReceivedFocusEvent,
    streamingState,
    hasPendingActionRequired,
    pendingHistoryItems,
    commandConfirmationRequest,
    authConsentRequest,
    permissionConfirmationRequest,
    hasConfirmUpdateExtensionRequests,
    hasLoopDetectionConfirmationRequest,
  });

  const isPassiveShortcutsHelpState =
    isInputActive && streamingState === StreamingState.Idle && !hasPendingActionRequired;

  useEffect(() => {
    if (shortcutsHelpVisible && !isPassiveShortcutsHelpState) {
      setShortcutsHelpVisible(false);
    }
  }, [shortcutsHelpVisible, isPassiveShortcutsHelpState, setShortcutsHelpVisible]);

  useEffect(() => {
    if (
      !isConfigInitialized ||
      !config.isModelSteeringEnabled() ||
      streamingState !== StreamingState.Idle ||
      !isMcpReady ||
      isToolAwaitingConfirmation(pendingHistoryItems)
    ) {
      return;
    }

    const pendingHint = consumePendingHints();
    if (!pendingHint) {
      return;
    }

    void submitQuery([{ text: buildUserSteeringHintPrompt(pendingHint) }]);
  }, [
    config,
    historyManager,
    isConfigInitialized,
    isMcpReady,
    streamingState,
    submitQuery,
    consumePendingHints,
    pendingHistoryItems,
    pendingHintCount,
  ]);

  return {
    elapsedTime,
    currentLoadingPhrase,
    currentTip,
    currentWittyPhrase,
    allowPlanMode,
    showApprovalModeIndicator,
  };
}

function useBaseStates(props: AppContainerProps) {
  const isHelpDismissKey = useIsHelpDismissKey();
  const keyMatchers = useKeyMatchers();
  const { config, initializationResult, resumedSessionData } = props;
  const settings = useSettings();
  const { reset } = useOverflowActions()!;
  const notificationsEnabled = isNotificationsEnabled(settings);
  const notificationMethod = getNotificationMethod(settings);

  const { setOptions, dumpCurrentFrame, startRecording, stopRecording } = useContext(InkAppContext);
  const recordingFilenameRef = useRef<string | null>(null);
  const historyManager = useHistory({});

  useMemoryMonitor(historyManager);
  const isAlternateBuffer = config.getUseAlternateBuffer();
  const [mouseMode, setMouseMode] = useState(() => config.getUseAlternateBuffer());

  useEffect(() => {
    setOptions({
      stickyHeadersInBackbuffer: mouseMode,
    });
    if (mouseMode) {
      enableMouseEvents();
    } else {
      disableMouseEvents();
    }
  }, [mouseMode, setOptions]);

  return {
    isHelpDismissKey,
    keyMatchers,
    config,
    initializationResult,
    resumedSessionData,
    settings,
    reset,
    notificationsEnabled,
    notificationMethod,
    setOptions,
    dumpCurrentFrame,
    startRecording,
    stopRecording,
    recordingFilenameRef,
    historyManager,
    isAlternateBuffer,
    mouseMode,
    setMouseMode,
  };
}

function useStreamState(params: {
  backgroundTasks: Map<number, BackgroundTask>;
  backgroundTaskCount: number;
  isBackgroundTaskVisible: boolean;
  activePtyId: number | undefined;
  embeddedShellFocused: boolean;
  setEmbeddedShellFocused: (v: boolean) => void;
  terminalHeight: number;
  lastOutputTime: number;
  streamingState: StreamingState;
  pendingToolCalls: MinimalTrackedToolCall[];
  config: HiveConfig;
  cleanUiDetailsVisible: boolean;
  revealCleanUiDetailsTemporarily: (durationMs: number) => void;
  handleApprovalModeChange: (mode: ApprovalMode) => void;
  pendingHistoryItems: HistoryItemWithoutId[];
  isConfigInitialized: boolean;
  submitQuery: (
    query: Part[] | string,
    options?: { isContinuation: boolean },
    _prompt_id?: string,
  ) => void | Promise<void>;
  setIsBackgroundTaskListOpenRef: React.MutableRefObject<(open: boolean) => void>;
}) {
  const {
    backgroundTasks,
    backgroundTaskCount,
    isBackgroundTaskVisible,
    activePtyId,
    embeddedShellFocused,
    setEmbeddedShellFocused,
    terminalHeight,
    lastOutputTime,
    streamingState,
    pendingToolCalls,
    config,
    cleanUiDetailsVisible,
    revealCleanUiDetailsTemporarily,
    handleApprovalModeChange,
    pendingHistoryItems,
    isConfigInitialized,
    submitQuery,
    setIsBackgroundTaskListOpenRef,
  } = params;

  const {
    activeBackgroundTaskPid,
    setIsBackgroundTaskListOpen,
    isBackgroundTaskListOpen,
    setActiveBackgroundTaskPid,
    backgroundTaskHeight,
  } = useBackgroundTaskManager({
    backgroundTasks,
    backgroundTaskCount,
    isBackgroundTaskVisible,
    activePtyId,
    embeddedShellFocused,
    setEmbeddedShellFocused,
    terminalHeight,
  });

  setIsBackgroundTaskListOpenRef.current = setIsBackgroundTaskListOpen;

  const lastOutputTimeRef = useRef(0);

  useEffect(() => {
    lastOutputTimeRef.current = lastOutputTime;
  }, [lastOutputTime]);

  const { shouldShowFocusHint, inactivityStatus } = useShellInactivityStatus({
    activePtyId,
    lastOutputTime,
    streamingState,
    pendingToolCalls,
    embeddedShellFocused,
    isInteractiveShellEnabled: config.isInteractiveShellEnabled(),
  });

  const shouldShowActionRequiredTitle = inactivityStatus === 'action_required';
  const shouldShowSilentWorkingTitle = inactivityStatus === 'silent_working';

  const handleApprovalModeChangeWithUiReveal = useCallback(
    (mode: ApprovalMode) => {
      void handleApprovalModeChange(mode);
      if (!cleanUiDetailsVisible) {
        revealCleanUiDetailsTemporarily(APPROVAL_MODE_REVEAL_DURATION_MS);
      }
    },
    [handleApprovalModeChange, cleanUiDetailsVisible, revealCleanUiDetailsTemporarily],
  );

  const { isMcpReady } = useMcpStatus(config);

  const isCompressing = useMemo(
    () =>
      pendingHistoryItems.some((item) => {
        if (item.type !== MessageType.COMPRESSION) return false;
        const compression = item.compression;
        return (
          typeof compression === 'object' &&
          compression !== null &&
          'isPending' in compression &&
          (compression as { isPending?: boolean }).isPending === true
        );
      }),
    [pendingHistoryItems],
  );

  const { messageQueue, addMessage, clearQueue, getQueuedMessagesText, popAllMessages } =
    useMessageQueue({
      isConfigInitialized,
      streamingState,
      submitQuery,
      isMcpReady,
      isCompressing,
    });

  return {
    activeBackgroundTaskPid: activeBackgroundTaskPid as number | null,
    setIsBackgroundTaskListOpen,
    isBackgroundTaskListOpen,
    setActiveBackgroundTaskPid,
    backgroundTaskHeight,
    lastOutputTimeRef,
    shouldShowFocusHint,
    inactivityStatus,
    shouldShowActionRequiredTitle,
    shouldShowSilentWorkingTitle,
    handleApprovalModeChangeWithUiReveal,
    isMcpReady,
    isCompressing,
    messageQueue,
    addMessage,
    clearQueue,
    getQueuedMessagesText,
    popAllMessages,
  };
}

function useIdeAndOverlayStates(params: {
  config: HiveConfig;
  settings: ReturnType<typeof useSettings>;
  handleSlashCommand: (
    rawQuery: PartListUnion | string,
    oneTimeShellAllowlist?: Set<string>,
    overwriteConfirmed?: boolean,
    addToHistory?: boolean,
  ) => Promise<unknown> | void;
}) {
  const { config, settings, handleSlashCommand } = params;

  const [idePromptAnswered, setIdePromptAnswered] = useState(false);
  const [currentIDE, setCurrentIDE] = useState<IdeInfo | null>(null);

  useEffect(() => {
    const getIde = async () => {
      const ideClient = await IdeClient.getInstance();
      const currentIde = ideClient.getCurrentIde();
      setCurrentIDE(currentIde || null);
    };

    getIde();
  }, []);
  const shouldShowIdePrompt = Boolean(
    currentIDE && !config.getIdeMode() && !settings.merged.ide.hasSeenNudge && !idePromptAnswered,
  );

  const [showErrorDetails, setShowErrorDetails] = useState<boolean>(false);
  const [showFullTodos, setShowFullTodos] = useState<boolean>(false);
  const [renderMarkdown, setRenderMarkdown] = useState<boolean>(true);

  const handleExitRepeat = useCallback(
    (count: number) => {
      if (count > 2) {
        recordExitFail(config);
      }
      if (count > 1) {
        void handleSlashCommand('/quit', undefined, undefined, false);
      }
    },
    [config, handleSlashCommand],
  );

  const repeatedKeyPressOptions = useMemo(
    () => ({
      windowMs: WARNING_PROMPT_DURATION_MS,
      onRepeat: handleExitRepeat,
    }),
    [handleExitRepeat],
  );

  const { pressCount: ctrlCPressCount, handlePress: handleCtrlCPress } =
    useRepeatedKeyPress(repeatedKeyPressOptions);

  const { pressCount: ctrlDPressCount, handlePress: handleCtrlDPress } =
    useRepeatedKeyPress(repeatedKeyPressOptions);

  const [ideContextState, setIdeContextState] = useState<IdeContext | undefined>();
  const [showEscapePrompt, setShowEscapePrompt] = useState(false);
  const [showIdeRestartPrompt, setShowIdeRestartPrompt] = useState(false);

  const [transientMessage, showTransientMessage] = useTimedMessage<{
    text: string;
    type: TransientMessageType;
  }>(WARNING_PROMPT_DURATION_MS);

  const isFolderTrustDialogOpen = false;
  const folderDiscoveryResults = null;
  const handleFolderTrustSelect = useCallback(() => {}, []);
  const isRestarting = false;

  const policyUpdateConfirmationRequest = config.getPolicyUpdateConfirmationRequest() as unknown;
  const [isPolicyUpdateDialogOpen, setIsPolicyUpdateDialogOpen] = useState(
    !!policyUpdateConfirmationRequest,
  );
  const ideNeedsRestart = false;
  const ideTrustRestartReason = undefined;

  const tabFocusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  return {
    idePromptAnswered,
    setIdePromptAnswered,
    currentIDE,
    shouldShowIdePrompt,
    showErrorDetails,
    setShowErrorDetails,
    showFullTodos,
    setShowFullTodos,
    renderMarkdown,
    setRenderMarkdown,
    ctrlCPressCount,
    handleCtrlCPress,
    ctrlDPressCount,
    handleCtrlDPress,
    ideContextState,
    setIdeContextState,
    showEscapePrompt,
    setShowEscapePrompt,
    showIdeRestartPrompt,
    setShowIdeRestartPrompt,
    transientMessage,
    showTransientMessage,
    isFolderTrustDialogOpen,
    folderDiscoveryResults,
    handleFolderTrustSelect,
    isRestarting,
    policyUpdateConfirmationRequest,
    isPolicyUpdateDialogOpen,
    setIsPolicyUpdateDialogOpen,
    ideNeedsRestart,
    ideTrustRestartReason,
    tabFocusTimeoutRef,
  };
}

function useUIActionsBuilder(params: {
  handleThemeSelect: (themeName: string, scope: LoadableSettingScope) => Promise<void>;
  closeThemeDialog: () => void;
  handleThemeHighlight: (highlight: string) => void;
  handleEditorSelect: (editorType: EditorType | undefined, scope: LoadableSettingScope) => void;
  exitEditorDialog: () => void;
  closeSettingsDialog: () => void;
  closeModelDialog: () => void;
  openAgentConfigDialog: (name: string, displayName: string, definition: AgentDefinition) => void;
  closeAgentConfigDialog: () => void;
  openPermissionsDialog: (dialogProps?: { targetDirectory?: string }) => void;
  closePermissionsDialog: () => void;
  setShellModeActive: (v: boolean) => void;
  vimHandleInput: (key: Key) => void;
  handleIdePromptComplete: (result: IdeIntegrationNudgeResult) => void;
  handleFolderTrustSelect: () => void;
  setIsPolicyUpdateDialogOpen: (v: boolean) => void;
  setConstrainHeight: (fn: boolean | ((prev: boolean) => boolean)) => void;
  handleEscapePromptChange: (showPrompt: boolean) => void;
  refreshStatic: () => void;
  handleFinalSubmit: (submittedValue: string) => void | Promise<void>;
  handleClearScreen: () => void;
  openSessionBrowser: () => void;
  closeSessionBrowser: () => void;
  handleResumeSession: (session: SessionInfo) => Promise<void>;
  handleDeleteSession: (session: SessionInfo) => Promise<void>;
  setQueueErrorMessage: (msg: string) => void;
  addMessage: (msg: string) => void;
  popAllMessages: () => void;
  setBannerVisible: (v: boolean) => void;
  setShortcutsHelpVisible: (fn: boolean | ((prev: boolean) => boolean)) => void;
  setCleanUiDetailsVisible: (v: boolean) => void;
  toggleCleanUiDetailsVisible: () => void;
  revealCleanUiDetailsTemporarily: () => void;
  handleWarning: (message: string) => void;
  setEmbeddedShellFocused: (v: boolean) => void;
  dismissBackgroundTask: (pid: number) => void;
  setActiveBackgroundTaskPid: (pid: number | null) => void;
  setIsBackgroundTaskListOpen: (v: boolean) => void;
  config: HiveConfig;
  newAgents: AgentDefinition[] | null;
  historyManager: ReturnType<typeof useHistory>;
  setNewAgents: React.Dispatch<React.SetStateAction<AgentDefinition[] | null>>;
  getPreferredEditor: () => EditorType | undefined;
  setShowPrivacyNotice: React.Dispatch<React.SetStateAction<boolean>>;
}): UIActions {
  const {
    handleThemeSelect,
    closeThemeDialog,
    handleThemeHighlight,
    handleEditorSelect,
    exitEditorDialog,
    closeSettingsDialog,
    closeModelDialog,
    openAgentConfigDialog,
    closeAgentConfigDialog,
    openPermissionsDialog,
    closePermissionsDialog,
    setShellModeActive,
    vimHandleInput,
    handleIdePromptComplete,
    handleFolderTrustSelect,
    setIsPolicyUpdateDialogOpen,
    setConstrainHeight,
    handleEscapePromptChange,
    refreshStatic,
    handleFinalSubmit,
    handleClearScreen,
    openSessionBrowser,
    closeSessionBrowser,
    handleResumeSession,
    handleDeleteSession,
    setQueueErrorMessage,
    addMessage,
    popAllMessages,
    setBannerVisible,
    setShortcutsHelpVisible,
    setCleanUiDetailsVisible,
    toggleCleanUiDetailsVisible,
    revealCleanUiDetailsTemporarily,
    handleWarning,
    setEmbeddedShellFocused,
    dismissBackgroundTask,
    setActiveBackgroundTaskPid,
    setIsBackgroundTaskListOpen,
    config,
    newAgents,
    historyManager,
    setNewAgents,
    getPreferredEditor,
    setShowPrivacyNotice,
  } = params;

  const exitPrivacyNotice = useCallback(() => setShowPrivacyNotice(false), [setShowPrivacyNotice]);

  return useMemo(
    () =>
      buildUiActions({
        handleThemeSelect,
        closeThemeDialog,
        handleThemeHighlight,
        handleEditorSelect,
        exitEditorDialog,
        exitPrivacyNotice,
        closeSettingsDialog,
        closeModelDialog,
        openAgentConfigDialog,
        closeAgentConfigDialog,
        openPermissionsDialog,
        closePermissionsDialog,
        setShellModeActive,
        vimHandleInput,
        handleIdePromptComplete,
        handleFolderTrustSelect,
        setIsPolicyUpdateDialogOpen,
        setConstrainHeight,
        handleEscapePromptChange,
        refreshStatic,
        handleFinalSubmit,
        handleClearScreen,
        openSessionBrowser,
        closeSessionBrowser,
        handleResumeSession,
        handleDeleteSession,
        setQueueErrorMessage,
        addMessage,
        popAllMessages,
        setBannerVisible,
        setShortcutsHelpVisible,
        setCleanUiDetailsVisible,
        toggleCleanUiDetailsVisible,
        revealCleanUiDetailsTemporarily,
        handleWarning,
        setEmbeddedShellFocused,
        dismissBackgroundTask,
        setActiveBackgroundTaskPid,
        setIsBackgroundTaskListOpen,
        config,
        newAgents,
        historyManager,
        setNewAgents,
        getPreferredEditor,
      }),
    [
      handleThemeSelect,
      closeThemeDialog,
      handleThemeHighlight,
      handleEditorSelect,
      exitEditorDialog,
      exitPrivacyNotice,
      closeSettingsDialog,
      closeModelDialog,
      openAgentConfigDialog,
      closeAgentConfigDialog,
      openPermissionsDialog,
      closePermissionsDialog,
      setShellModeActive,
      vimHandleInput,
      handleIdePromptComplete,
      handleFolderTrustSelect,
      setIsPolicyUpdateDialogOpen,
      setConstrainHeight,
      handleEscapePromptChange,
      refreshStatic,
      handleFinalSubmit,
      handleClearScreen,
      openSessionBrowser,
      closeSessionBrowser,
      handleResumeSession,
      handleDeleteSession,
      setQueueErrorMessage,
      addMessage,
      popAllMessages,
      setBannerVisible,
      setShortcutsHelpVisible,
      setCleanUiDetailsVisible,
      toggleCleanUiDetailsVisible,
      revealCleanUiDetailsTemporarily,
      handleWarning,
      setEmbeddedShellFocused,
      dismissBackgroundTask,
      setActiveBackgroundTaskPid,
      setIsBackgroundTaskListOpen,
      newAgents,
      config,
      historyManager,
      getPreferredEditor,
      setNewAgents,
    ],
  );
}

type FinalUIBuildersParams = Omit<
  UiStateDeps,
  'history' | 'accountSuspensionInfo' | 'hintMode' | 'isToolExecutingValue'
> &
  Partial<
    Pick<UiStateDeps, 'history' | 'accountSuspensionInfo' | 'hintMode' | 'isToolExecutingValue'>
  > & {
    buffer: ReturnType<typeof useTextBuffer>;
    inputHistory: string[];
    shellModeActive: boolean;
    showEscapePrompt: boolean;
    copyModeEnabled: boolean;
    inputWidth: number;
    suggestionsWidth: number;
    handleThemeSelect: (themeName: string, scope: LoadableSettingScope) => Promise<void>;
    closeThemeDialog: () => void;
    handleThemeHighlight: (highlight: string) => void;
    handleEditorSelect: (editorType: EditorType | undefined, scope: LoadableSettingScope) => void;
    exitEditorDialog: () => void;
    setShowPrivacyNotice: React.Dispatch<React.SetStateAction<boolean>>;
    closeSettingsDialog: () => void;
    closeModelDialog: () => void;
    openAgentConfigDialog: (name: string, displayName: string, definition: AgentDefinition) => void;
    closeAgentConfigDialog: () => void;
    openPermissionsDialog: (dialogProps?: { targetDirectory?: string }) => void;
    closePermissionsDialog: () => void;
    setShellModeActive: (v: boolean) => void;
    vimHandleInput: (key: Key) => void;
    handleIdePromptComplete: (result: IdeIntegrationNudgeResult) => void;
    handleFolderTrustSelect: () => void;
    setIsPolicyUpdateDialogOpen: (v: boolean) => void;
    setConstrainHeight: (fn: boolean | ((prev: boolean) => boolean)) => void;
    handleEscapePromptChange: (showPrompt: boolean) => void;
    refreshStatic: () => void;
    handleFinalSubmit: (submittedValue: string) => void | Promise<void>;
    handleClearScreen: () => void;
    openSessionBrowser: () => void;
    closeSessionBrowser: () => void;
    handleResumeSession: (session: SessionInfo) => Promise<void>;
    handleDeleteSession: (session: SessionInfo) => Promise<void>;
    setQueueErrorMessage: (msg: string) => void;
    addMessage: (msg: string) => void;
    popAllMessages: () => void;
    setBannerVisible: (v: boolean) => void;
    setShortcutsHelpVisible: (fn: boolean | ((prev: boolean) => boolean)) => void;
    setCleanUiDetailsVisible: (v: boolean) => void;
    toggleCleanUiDetailsVisible: () => void;
    revealCleanUiDetailsTemporarily: () => void;
    handleWarning: (message: string) => void;
    setEmbeddedShellFocused: (v: boolean) => void;
    dismissBackgroundTask: (pid: number) => void;
    setActiveBackgroundTaskPid: (pid: number | null) => void;
    setIsBackgroundTaskListOpen: (v: boolean) => void;
    setNewAgents: React.Dispatch<React.SetStateAction<AgentDefinition[] | null>>;
    getPreferredEditor: () => EditorType | undefined;
  };

function useFinalUIBuilders(params: FinalUIBuildersParams) {
  const {
    buffer,
    inputHistory,
    shellModeActive,
    showEscapePrompt,
    copyModeEnabled,
    inputWidth,
    suggestionsWidth,
    historyManager,
    isFolderTrustDialogOpen,
    config,
    pendingHistoryItems,
    handleThemeSelect,
    closeThemeDialog,
    handleThemeHighlight,
    handleEditorSelect,
    exitEditorDialog,
    closeSettingsDialog,
    closeModelDialog,
    openAgentConfigDialog,
    closeAgentConfigDialog,
    openPermissionsDialog,
    closePermissionsDialog,
    setShellModeActive,
    vimHandleInput,
    handleIdePromptComplete,
    handleFolderTrustSelect,
    setIsPolicyUpdateDialogOpen,
    setConstrainHeight,
    handleEscapePromptChange,
    refreshStatic,
    handleFinalSubmit,
    handleClearScreen,
    openSessionBrowser,
    closeSessionBrowser,
    handleResumeSession,
    handleDeleteSession,
    setQueueErrorMessage,
    addMessage,
    popAllMessages,
    setBannerVisible,
    setShortcutsHelpVisible,
    setCleanUiDetailsVisible,
    toggleCleanUiDetailsVisible,
    revealCleanUiDetailsTemporarily,
    handleWarning,
    setEmbeddedShellFocused,
    dismissBackgroundTask,
    setActiveBackgroundTaskPid,
    setIsBackgroundTaskListOpen,
    setNewAgents,
    getPreferredEditor,
    setShowPrivacyNotice,
  } = params;

  const inputState = useMemo(
    () => ({
      buffer,
      userMessages: inputHistory,
      shellModeActive,
      showEscapePrompt,
      copyModeEnabled,
      inputWidth,
      suggestionsWidth,
    }),
    [
      buffer,
      inputHistory,
      shellModeActive,
      showEscapePrompt,
      copyModeEnabled,
      inputWidth,
      suggestionsWidth,
    ],
  );

  const uiState: UIState = useMemo(
    () =>
      buildUiState({
        ...params,
        history: historyManager.history,
        historyManager,
        accountSuspensionInfo: null,
        loginRestartMessage: undefined,
        apiKeyDefaultValue: undefined,
        isFolderTrustDialogOpen: isFolderTrustDialogOpen ?? false,
        terminalBackgroundColor: config.getTerminalBackground(),
        hintMode: config.isModelSteeringEnabled() && isToolExecuting(pendingHistoryItems),
        isToolExecutingValue: isToolExecuting(pendingHistoryItems),
      }),
    [params, historyManager, isFolderTrustDialogOpen, config, pendingHistoryItems],
  );

  const uiActions = useUIActionsBuilder({
    handleThemeSelect,
    closeThemeDialog,
    handleThemeHighlight,
    handleEditorSelect,
    exitEditorDialog,
    closeSettingsDialog,
    closeModelDialog,
    openAgentConfigDialog,
    closeAgentConfigDialog,
    openPermissionsDialog,
    closePermissionsDialog,
    setShellModeActive,
    vimHandleInput,
    handleIdePromptComplete,
    handleFolderTrustSelect,
    setIsPolicyUpdateDialogOpen,
    setConstrainHeight,
    handleEscapePromptChange,
    refreshStatic,
    handleFinalSubmit,
    handleClearScreen,
    openSessionBrowser,
    closeSessionBrowser,
    handleResumeSession,
    handleDeleteSession,
    setQueueErrorMessage,
    addMessage,
    popAllMessages,
    setBannerVisible,
    setShortcutsHelpVisible,
    setCleanUiDetailsVisible,
    toggleCleanUiDetailsVisible,
    revealCleanUiDetailsTemporarily,
    handleWarning,
    setEmbeddedShellFocused,
    dismissBackgroundTask,
    setActiveBackgroundTaskPid,
    setIsBackgroundTaskListOpen,
    config,
    newAgents: params.newAgents,
    historyManager,
    setNewAgents,
    getPreferredEditor,
    setShowPrivacyNotice,
  });

  return { inputState, uiState, uiActions };
}

function useAppCoreStates(params: {
  initializationResultThemeError: string | null;
  config: HiveConfig;
  historyManager: ReturnType<typeof useHistory>;
}) {
  const { initializationResultThemeError, config, historyManager } = params;

  const {
    corgiMode,
    setCorgiMode,
    editorError,
    setEditorError,
    shortcutsHelpVisible,
    setShortcutsHelpVisible,
  } = useTUIOverlay();
  const [debugMessage, setDebugMessage] = useState<string>('');
  const [quittingMessages, setQuittingMessages] = useState<HistoryItem[] | null>(null);
  const [showPrivacyNotice, setShowPrivacyNotice] = useState<boolean>(false);
  const [themeError, setThemeError] = useState<string | null>(initializationResultThemeError);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [embeddedShellFocused, setEmbeddedShellFocused] = useState(false);
  const [showDebugProfiler, setShowDebugProfiler] = useState(false);
  const [customDialog, setCustomDialog] = useState<React.ReactNode | null>(null);
  const [copyModeEnabled, setCopyModeEnabled] = useState(false);
  const [pendingRestorePrompt, setPendingRestorePrompt] = useState(false);
  const toggleBackgroundTasksRef = useRef<() => void>(() => {});
  const isBackgroundTaskVisibleRef = useRef<boolean>(false);
  const backgroundTasksRef = useRef<Map<number, BackgroundTask>>(new Map());

  const [adminSettingsChanged, setAdminSettingsChanged] = useState(false);

  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  const toggleExpansion = useCallback((callId: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(callId)) {
        next.delete(callId);
      } else {
        next.add(callId);
      }
      return next;
    });
  }, []);

  const toggleAllExpansion = useCallback((callIds: string[]) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      const anyCollapsed = callIds.some((id) => !next.has(id));

      if (anyCollapsed) {
        callIds.forEach((id) => next.add(id));
      } else {
        callIds.forEach((id) => next.delete(id));
      }
      return next;
    });
  }, []);

  const isExpanded = useCallback((callId: string) => expandedTools.has(callId), [expandedTools]);

  const [shellModeActive, setShellModeActive] = useState(false);

  const historyRemountKey = 0;
  const [settingsNonce, setSettingsNonce] = useState(0);
  const activeHooks = useHookDisplayState();
  const [updateInfo, setUpdateInfo] = useState<UpdateObject | null>(null);
  const [isTrustedFolder] = useState<boolean | undefined>(true);

  const [queueErrorMessage, setQueueErrorMessage] = useTimedMessage<string>(
    QUEUE_ERROR_DISPLAY_DURATION_MS,
  );

  const [newAgents, setNewAgents] = useState<AgentDefinition[] | null>(null);
  const [constrainHeight, setConstrainHeight] = useState<boolean>(true);
  const [expandHintTrigger, triggerExpandHint] = useTimedMessage<boolean>(EXPAND_HINT_DURATION_MS);
  const showIsExpandableHint = Boolean(expandHintTrigger);
  const overflowState = useOverflowState();
  const overflowingIdsSize = overflowState?.overflowingIds.size ?? 0;

  const prevOverflowingIdsSizeRef = useRef(0);
  useEffect(() => {
    if (overflowingIdsSize > prevOverflowingIdsSizeRef.current) {
      triggerExpandHint(true);
    }
    prevOverflowingIdsSizeRef.current = overflowingIdsSize;
  }, [overflowingIdsSize, triggerExpandHint]);

  const { bannerVisible, setBannerVisible, bannerData, bannerText } = useHeaderBanner(config);

  const extensionManager = config.getExtensionLoader();

  const useConfirmUpdateRequestsLocal = () => {
    const add = useCallback(() => {}, []);
    const [arr] = useState<ConfirmationRequest[]>([]);
    return {
      addConfirmUpdateExtensionRequest: add,
      confirmUpdateExtensionRequests: arr,
    };
  };

  const useExtensionUpdatesLocal = (..._args: unknown[]) => {
    const [state] = useState<Map<string, ExtensionUpdateState>>(new Map());
    const [stateInternal] = useState<Map<string, ExtensionUpdateStatus>>(new Map());
    const dispatch = useCallback(() => {}, []);
    return {
      extensionsUpdateState: state,
      extensionsUpdateStateInternal: stateInternal,
      dispatchExtensionStateUpdate: dispatch,
    };
  };

  const { addConfirmUpdateExtensionRequest, confirmUpdateExtensionRequests } =
    useConfirmUpdateRequestsLocal();
  const { extensionsUpdateState, extensionsUpdateStateInternal, dispatchExtensionStateUpdate } =
    useExtensionUpdatesLocal(
      extensionManager,
      historyManager.addItem,
      config.getEnableExtensionReloading(),
    );

  useEffect(() => {
    if (extensionManager) {
      extensionManager.setRequestConsent((description: string) =>
        requestConsentInteractive(description, addConfirmUpdateExtensionRequest),
      );
      extensionManager.setRequestSetting({});
    }
  }, [extensionManager, addConfirmUpdateExtensionRequest]);

  const {
    isPermissionsDialogOpen,
    permissionsDialogProps,
    openPermissionsDialog,
    closePermissionsDialog,
    isAgentConfigDialogOpen,
    selectedAgentName,
    selectedAgentDisplayName,
    selectedAgentDefinition,
    openAgentConfigDialog,
    closeAgentConfigDialog,
  } = useDialogStates();

  return {
    corgiMode,
    setCorgiMode,
    editorError,
    setEditorError,
    shortcutsHelpVisible,
    setShortcutsHelpVisible,
    debugMessage,
    setDebugMessage,
    quittingMessages,
    setQuittingMessages,
    showPrivacyNotice,
    setShowPrivacyNotice,
    themeError,
    setThemeError,
    isProcessing,
    setIsProcessing,
    embeddedShellFocused,
    setEmbeddedShellFocused,
    showDebugProfiler,
    setShowDebugProfiler,
    customDialog,
    setCustomDialog,
    copyModeEnabled,
    setCopyModeEnabled,
    pendingRestorePrompt,
    setPendingRestorePrompt,
    toggleBackgroundTasksRef,
    isBackgroundTaskVisibleRef,
    backgroundTasksRef,
    adminSettingsChanged,
    setAdminSettingsChanged,
    expandedTools,
    toggleExpansion,
    toggleAllExpansion,
    isExpanded,
    shellModeActive,
    setShellModeActive,
    historyRemountKey,
    settingsNonce,
    setSettingsNonce,
    activeHooks,
    updateInfo,
    setUpdateInfo,
    isTrustedFolder,
    queueErrorMessage,
    setQueueErrorMessage,
    newAgents,
    setNewAgents,
    constrainHeight,
    setConstrainHeight,
    triggerExpandHint,
    showIsExpandableHint,
    bannerVisible,
    setBannerVisible,
    bannerData,
    bannerText,
    addConfirmUpdateExtensionRequest,
    confirmUpdateExtensionRequests,
    extensionsUpdateState,
    extensionsUpdateStateInternal,
    dispatchExtensionStateUpdate,
    isPermissionsDialogOpen,
    permissionsDialogProps,
    openPermissionsDialog,
    closePermissionsDialog,
    isAgentConfigDialogOpen,
    selectedAgentName,
    selectedAgentDisplayName,
    selectedAgentDefinition,
    openAgentConfigDialog,
    closeAgentConfigDialog,
  };
}

function useSessionsAndCommands(params: {
  config: HiveConfig;
  historyManager: ReturnType<typeof useHistory>;
  refreshStatic: () => void;
  setQuittingMessages: (messages: HistoryItem[] | null) => void;
  resumedSessionData?: ResumedSessionData;
  setCorgiMode: React.Dispatch<React.SetStateAction<boolean>>;
  setEmbeddedShellFocused: (v: boolean) => void;
  setShortcutsHelpVisible: (fn: boolean | ((prev: boolean) => boolean)) => void;
  toggleBackgroundTasksRef: React.MutableRefObject<() => void>;
  isBackgroundTaskVisibleRef: React.MutableRefObject<boolean>;
  backgroundTasksRef: React.MutableRefObject<Map<number, BackgroundTask>>;
  setIsBackgroundTaskListOpenRef: React.MutableRefObject<(open: boolean) => void>;
  openThemeDialog: () => void;
  openEditorDialog: () => void;
  openSettingsDialog: () => void;
  closeThemeDialog: () => void;
  openAgentConfigDialog: (name: string, displayName: string, definition: AgentDefinition) => void;
  openPermissionsDialog: (dialogProps?: { targetDirectory?: string }) => void;
  setDebugMessage: (msg: string) => void;
  toggleDebugProfiler: () => void;
  dispatchExtensionStateUpdate: () => void;
  addConfirmUpdateExtensionRequest: () => void;
  stableSetText: (text: string) => void;
  setShowPrivacyNotice: React.Dispatch<React.SetStateAction<boolean>>;
  settings: ReturnType<typeof useSettings>;
  setIsProcessing: (v: boolean) => void;
  extensionsUpdateStateInternal: Map<string, ExtensionUpdateStatus>;
  isConfigInitialized: boolean;
  setBannerVisible: (v: boolean) => void;
  setCustomDialog: (dialog: React.ReactNode | null) => void;
}) {
  const {
    config,
    historyManager,
    refreshStatic,
    setQuittingMessages,
    resumedSessionData,
    setCorgiMode,
    setEmbeddedShellFocused,
    setShortcutsHelpVisible,
    toggleBackgroundTasksRef,
    isBackgroundTaskVisibleRef,
    backgroundTasksRef,
    setIsBackgroundTaskListOpenRef,
    openThemeDialog,
    openEditorDialog,
    openSettingsDialog,
    closeThemeDialog,
    openAgentConfigDialog,
    openPermissionsDialog,
    setDebugMessage,
    toggleDebugProfiler,
    dispatchExtensionStateUpdate,
    addConfirmUpdateExtensionRequest,
    stableSetText,
    setShowPrivacyNotice,
    settings,
    setIsProcessing,
    extensionsUpdateStateInternal,
    isConfigInitialized,
    setBannerVisible,
    setCustomDialog,
  } = params;

  const isCoreConnected = hiveCoreConnection.getConnectionStatus() === 'connected';

  const { loadHistoryForResume, isResuming } = useSessionResume({
    config,
    historyManager,
    refreshStatic,
    isCoreConnected,
    setQuittingMessages,
    resumedSessionData,
  });
  const {
    isSessionBrowserOpen,
    openSessionBrowser,
    closeSessionBrowser,
    handleResumeSession,
    handleDeleteSession: handleDeleteSessionSync,
  } = useSessionBrowser(config, loadHistoryForResume);
  // Wrap handleDeleteSession to return a Promise for UIActions interface
  const handleDeleteSession = useCallback(
    async (session: SessionInfo): Promise<void> => {
      await handleDeleteSessionSync(session);
    },
    [handleDeleteSessionSync],
  );

  const {
    isModelDialogOpen,
    openModelDialog: openModelDialogCmd,
    closeModelDialog,
  } = useModelCommand();

  const { toggleVimEnabled } = useVimMode();

  const {
    cleanUiDetailsVisible,
    setCleanUiDetailsVisible,
    toggleCleanUiDetailsVisible,
    revealCleanUiDetailsTemporarily,
  } = useVisibilityToggle();

  const slashCommandActions = useSlashCommandActions({
    closeThemeDialog,
    setQuittingMessages,
    setCorgiMode,
    setEmbeddedShellFocused,
    setShortcutsHelpVisible,
    toggleBackgroundTasksRef,
    isBackgroundTaskVisibleRef,
    backgroundTasksRef,
    setIsBackgroundTaskListOpenRef,
    openThemeDialog,
    openEditorDialog,
    openSettingsDialog,
    openSessionBrowser,
    openModelDialog: openModelDialogCmd,
    openAgentConfigDialog,
    openPermissionsDialog,
    setDebugMessage,
    toggleDebugProfiler,
    dispatchExtensionStateUpdate,
    addConfirmUpdateExtensionRequest,
    stableSetText,
    setShowPrivacyNotice,
  });

  const {
    handleSlashCommand,
    slashCommands,
    pendingHistoryItems: pendingSlashCommandHistoryItems,
    commandContext,
    confirmationRequest: commandConfirmationRequest,
  } = useSlashCommandProcessor(
    config,
    settings,
    historyManager.addItem,
    historyManager.clearItems,
    historyManager.loadHistory,
    refreshStatic,
    toggleVimEnabled,
    setIsProcessing,
    slashCommandActions,
    extensionsUpdateStateInternal,
    isConfigInitialized,
    setBannerVisible,
    setCustomDialog,
  );

  return {
    isCoreConnected,
    isResuming,
    isSessionBrowserOpen,
    openSessionBrowser,
    closeSessionBrowser,
    handleResumeSession,
    handleDeleteSession,
    isModelDialogOpen,
    openModelDialog: openModelDialogCmd,
    closeModelDialog,
    toggleVimEnabled,
    setIsBackgroundTaskListOpenRef,
    cleanUiDetailsVisible,
    setCleanUiDetailsVisible,
    toggleCleanUiDetailsVisible,
    revealCleanUiDetailsTemporarily,
    slashCommandActions,
    handleSlashCommand,
    slashCommands,
    pendingSlashCommandHistoryItems,
    commandContext,
    commandConfirmationRequest,
  };
}

type RuntimeStreamState = ReturnType<typeof useRuntimeAndStream>;

interface CoreDialogState {
  corgiMode: boolean;
  setCorgiMode: React.Dispatch<React.SetStateAction<boolean>>;
  editorError: string | null;
  setEditorError: (error: string | null) => void;
  shortcutsHelpVisible: boolean;
  setShortcutsHelpVisible: (fn: boolean | ((prev: boolean) => boolean)) => void;
  debugMessage: string;
  setDebugMessage: (msg: string) => void;
  quittingMessages: HistoryItem[] | null;
  setQuittingMessages: (messages: HistoryItem[] | null) => void;
  showPrivacyNotice: boolean;
  setShowPrivacyNotice: React.Dispatch<React.SetStateAction<boolean>>;
  themeError: string | null;
  setThemeError: React.Dispatch<React.SetStateAction<string | null>>;
  isProcessing: boolean;
  setIsProcessing: (v: boolean) => void;
  embeddedShellFocused: boolean;
  setEmbeddedShellFocused: (v: boolean) => void;
  showDebugProfiler: boolean;
  setShowDebugProfiler: React.Dispatch<React.SetStateAction<boolean>>;
  customDialog: React.ReactNode | null;
  setCustomDialog: (dialog: React.ReactNode | null) => void;
  copyModeEnabled: boolean;
  setCopyModeEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  pendingRestorePrompt: boolean;
  setPendingRestorePrompt: React.Dispatch<React.SetStateAction<boolean>>;
  toggleBackgroundTasksRef: React.MutableRefObject<() => void>;
  isBackgroundTaskVisibleRef: React.MutableRefObject<boolean>;
  backgroundTasksRef: React.MutableRefObject<Map<number, BackgroundTask>>;
  adminSettingsChanged: boolean;
  setAdminSettingsChanged: React.Dispatch<React.SetStateAction<boolean>>;
  toggleExpansion: (callId: string) => void;
  toggleAllExpansion: (callIds: string[]) => void;
  isExpanded: (callId: string) => boolean;
  shellModeActive: boolean;
  setShellModeActive: (v: boolean) => void;
  historyRemountKey: number;
  settingsNonce: number;
  setSettingsNonce: React.Dispatch<React.SetStateAction<number>>;
  activeHooks: ActiveHook[];
  updateInfo: UpdateObject | null;
  setUpdateInfo: React.Dispatch<React.SetStateAction<UpdateObject | null>>;
  isTrustedFolder: boolean | undefined;
  queueErrorMessage: string | null;
  setQueueErrorMessage: (msg: string) => void;
  newAgents: AgentDefinition[] | null;
  setNewAgents: React.Dispatch<React.SetStateAction<AgentDefinition[] | null>>;
  constrainHeight: boolean;
  setConstrainHeight: (fn: boolean | ((prev: boolean) => boolean)) => void;
  triggerExpandHint: (v: boolean | null) => void;
  showIsExpandableHint: boolean;
  bannerVisible: boolean;
  setBannerVisible: (v: boolean) => void;
  bannerData: { defaultText: string; warningText: string };
  bannerText: string;
  addConfirmUpdateExtensionRequest: () => void;
  confirmUpdateExtensionRequests: ConfirmationRequest[];
  extensionsUpdateState: Map<string, ExtensionUpdateState>;
  extensionsUpdateStateInternal: Map<string, ExtensionUpdateStatus>;
  dispatchExtensionStateUpdate: () => void;
  isPermissionsDialogOpen: boolean;
  permissionsDialogProps: { targetDirectory?: string } | null;
  openPermissionsDialog: (dialogProps?: { targetDirectory?: string }) => void;
  closePermissionsDialog: () => void;
  isAgentConfigDialogOpen: boolean;
  selectedAgentName: string | undefined;
  selectedAgentDisplayName: string | undefined;
  selectedAgentDefinition: AgentDefinition | undefined;
  openAgentConfigDialog: (name: string, displayName: string, definition: AgentDefinition) => void;
  closeAgentConfigDialog: () => void;
  toggleDebugProfiler: () => void;
}

function useCoreAndDialogStates(
  props: AppContainerProps,
  historyManager: ReturnType<typeof useHistory>,
) {
  const {
    corgiMode,
    setCorgiMode,
    editorError,
    setEditorError,
    shortcutsHelpVisible,
    setShortcutsHelpVisible,
    debugMessage,
    setDebugMessage,
    quittingMessages,
    setQuittingMessages,
    showPrivacyNotice,
    setShowPrivacyNotice,
    themeError,
    setThemeError,
    isProcessing,
    setIsProcessing,
    embeddedShellFocused,
    setEmbeddedShellFocused,
    showDebugProfiler,
    setShowDebugProfiler,
    customDialog,
    setCustomDialog,
    copyModeEnabled,
    setCopyModeEnabled,
    pendingRestorePrompt,
    setPendingRestorePrompt,
    toggleBackgroundTasksRef,
    isBackgroundTaskVisibleRef,
    backgroundTasksRef,
    adminSettingsChanged,
    setAdminSettingsChanged,
    toggleExpansion,
    toggleAllExpansion,
    isExpanded,
    shellModeActive,
    setShellModeActive,
    historyRemountKey,
    settingsNonce,
    setSettingsNonce,
    activeHooks,
    updateInfo,
    setUpdateInfo,
    isTrustedFolder,
    queueErrorMessage,
    setQueueErrorMessage,
    newAgents,
    setNewAgents,
    constrainHeight,
    setConstrainHeight,
    triggerExpandHint,
    showIsExpandableHint,
    bannerVisible,
    setBannerVisible,
    bannerData,
    bannerText,
    addConfirmUpdateExtensionRequest,
    confirmUpdateExtensionRequests,
    extensionsUpdateState,
    extensionsUpdateStateInternal,
    dispatchExtensionStateUpdate,
    isPermissionsDialogOpen,
    permissionsDialogProps,
    openPermissionsDialog,
    closePermissionsDialog,
    isAgentConfigDialogOpen,
    selectedAgentName,
    selectedAgentDisplayName,
    selectedAgentDefinition,
    openAgentConfigDialog,
    closeAgentConfigDialog,
  } = useAppCoreStates({
    initializationResultThemeError: props.initializationResult.themeError as string | null,
    config: props.config,
    historyManager,
  });

  const toggleDebugProfiler = useCallback(
    () => setShowDebugProfiler((prev) => !prev),
    [setShowDebugProfiler],
  );

  return {
    corgiMode,
    setCorgiMode,
    editorError,
    setEditorError,
    shortcutsHelpVisible,
    setShortcutsHelpVisible,
    debugMessage,
    setDebugMessage,
    quittingMessages,
    setQuittingMessages,
    showPrivacyNotice,
    setShowPrivacyNotice,
    themeError,
    setThemeError,
    isProcessing,
    setIsProcessing,
    embeddedShellFocused,
    setEmbeddedShellFocused,
    showDebugProfiler,
    setShowDebugProfiler,
    customDialog,
    setCustomDialog,
    copyModeEnabled,
    setCopyModeEnabled,
    pendingRestorePrompt,
    setPendingRestorePrompt,
    toggleBackgroundTasksRef,
    isBackgroundTaskVisibleRef,
    backgroundTasksRef,
    adminSettingsChanged,
    setAdminSettingsChanged,
    toggleExpansion,
    toggleAllExpansion,
    isExpanded,
    shellModeActive,
    setShellModeActive,
    historyRemountKey,
    settingsNonce,
    setSettingsNonce,
    activeHooks,
    updateInfo,
    setUpdateInfo,
    isTrustedFolder,
    queueErrorMessage,
    setQueueErrorMessage,
    newAgents,
    setNewAgents,
    constrainHeight,
    setConstrainHeight,
    triggerExpandHint,
    showIsExpandableHint,
    bannerVisible,
    setBannerVisible,
    bannerData,
    bannerText,
    addConfirmUpdateExtensionRequest,
    confirmUpdateExtensionRequests,
    extensionsUpdateState,
    extensionsUpdateStateInternal,
    dispatchExtensionStateUpdate,
    isPermissionsDialogOpen,
    permissionsDialogProps,
    openPermissionsDialog,
    closePermissionsDialog,
    isAgentConfigDialogOpen,
    selectedAgentName,
    selectedAgentDisplayName,
    selectedAgentDefinition,
    openAgentConfigDialog,
    closeAgentConfigDialog,
    toggleDebugProfiler,
  } satisfies CoreDialogState;
}

function useStreamSessions(
  base: ReturnType<typeof useBaseStates>,
  core: CoreDialogState,
  refreshStatic: () => void,
  isConfigInitialized: boolean,
  openThemeDialog: () => void,
  openEditorDialog: () => void,
  openSettingsDialog: () => void,
  closeThemeDialog: () => void,
  stableSetText: (text: string) => void,
) {
  const { config, settings, historyManager, resumedSessionData } = base;
  const setIsBackgroundTaskListOpenRef = useRef<(open: boolean) => void>(() => {});

  const {
    isResuming,
    isSessionBrowserOpen,
    openSessionBrowser,
    closeSessionBrowser,
    handleResumeSession,
    handleDeleteSession,
    isModelDialogOpen,
    closeModelDialog,
    cleanUiDetailsVisible,
    setCleanUiDetailsVisible,
    toggleCleanUiDetailsVisible,
    revealCleanUiDetailsTemporarily,
    handleSlashCommand,
    slashCommands,
    pendingSlashCommandHistoryItems,
    commandContext,
    commandConfirmationRequest,
  } = useSessionsAndCommands({
    config,
    historyManager,
    refreshStatic,
    setQuittingMessages: core.setQuittingMessages,
    resumedSessionData,
    setCorgiMode: core.setCorgiMode,
    setEmbeddedShellFocused: core.setEmbeddedShellFocused,
    setShortcutsHelpVisible: core.setShortcutsHelpVisible,
    toggleBackgroundTasksRef: core.toggleBackgroundTasksRef,
    isBackgroundTaskVisibleRef: core.isBackgroundTaskVisibleRef,
    backgroundTasksRef: core.backgroundTasksRef,
    setIsBackgroundTaskListOpenRef,
    openThemeDialog,
    openEditorDialog,
    openSettingsDialog,
    closeThemeDialog,
    openAgentConfigDialog: core.openAgentConfigDialog,
    openPermissionsDialog: core.openPermissionsDialog,
    setDebugMessage: core.setDebugMessage,
    toggleDebugProfiler: core.toggleDebugProfiler,
    dispatchExtensionStateUpdate: core.dispatchExtensionStateUpdate,
    addConfirmUpdateExtensionRequest: core.addConfirmUpdateExtensionRequest,
    stableSetText,
    setShowPrivacyNotice: core.setShowPrivacyNotice,
    settings,
    setIsProcessing: core.setIsProcessing,
    extensionsUpdateStateInternal: core.extensionsUpdateStateInternal,
    isConfigInitialized,
    setBannerVisible: core.setBannerVisible,
    setCustomDialog: core.setCustomDialog,
  });

  return {
    isResuming,
    isSessionBrowserOpen,
    openSessionBrowser,
    closeSessionBrowser,
    handleResumeSession,
    handleDeleteSession,
    isModelDialogOpen,
    closeModelDialog,
    cleanUiDetailsVisible,
    setCleanUiDetailsVisible,
    toggleCleanUiDetailsVisible,
    revealCleanUiDetailsTemporarily,
    handleSlashCommand,
    slashCommands,
    pendingSlashCommandHistoryItems,
    commandContext,
    commandConfirmationRequest,
    setIsBackgroundTaskListOpenRef,
  };
}

function useStreamSetup(base: ReturnType<typeof useBaseStates>, core: CoreDialogState) {
  const { config, settings, reset, historyManager, isAlternateBuffer } = base;

  const [currentModel, setCurrentModel] = useState(config.getModel());
  const [isConfigInitialized, setConfigInitialized] = useState(false);
  const logger = useLogger(config);
  const { inputHistory, addInput, initializeFromLogger } = useInputHistoryStore();
  const { columns: terminalWidth, rows: terminalHeight } = useTerminalSize();
  const { stdin, setRawMode } = useStdin();
  const { stdout } = useStdout();
  const app: AppProps = useApp();
  const { stats: sessionStats } = useSessionStats();
  const branchName = useGitBranchName(config.getTargetDir());
  const rootUiRef = useRef<DOMElement>(null);
  const lastTitleRef = useRef<string | null>(null);
  const staticExtraHeight = 3;
  const handleFinalSubmitRef = useRef<(submittedValue: string) => void>(() => {});

  useSessionLifecycle({
    config,
    resumedSessionData: base.resumedSessionData,
    setConfigInitialized,
    backgroundTasksRef: core.backgroundTasksRef,
    handleFinalSubmitRef,
  });

  useEffect(
    () => setUpdateHandler(historyManager.addItem, core.setUpdateInfo),
    [historyManager.addItem, core.setUpdateInfo],
  );

  const { errorCount, clearErrorCount } = useErrorCount();

  const {
    inputWidth,
    suggestionsWidth,
    staticAreaMaxItemHeight,
    mainAreaWidth,
    getPreferredEditor,
    buffer,
    bufferRef,
    stableSetText,
    refreshStatic,
    shouldUseAlternateScreen,
    isEditorDialogOpen,
    openEditorDialog,
    handleEditorSelect,
    exitEditorDialog,
    isSettingsDialogOpen,
    openSettingsDialog,
    closeSettingsDialog,
    isThemeDialogOpen,
    openThemeDialog,
    closeThemeDialog,
    handleThemeSelect,
    handleThemeHighlight,
  } = useTerminalAndInput({
    settings,
    config,
    terminalWidth,
    terminalHeight,
    stdin,
    setRawMode,
    shellModeActive: core.shellModeActive,
    isAlternateBuffer,
    logger,
    historyManager,
    setEditorError: core.setEditorError,
    setThemeError: core.setThemeError,
    initializationResultThemeError: base.initializationResult.themeError as string | null,
    addConfirmUpdateExtensionRequest: core.addConfirmUpdateExtensionRequest,
    bannerVisible: core.bannerVisible,
    bannerText: core.bannerText,
    app,
    initializeFromLogger,
  });

  const sessions = useStreamSessions(
    base,
    core,
    refreshStatic,
    isConfigInitialized,
    openThemeDialog,
    openEditorDialog,
    openSettingsDialog,
    closeThemeDialog,
    stableSetText,
  );

  const pendingHintsRef = useRef<string[]>([]);
  const [pendingHintCount, setPendingHintCount] = useState(0);

  const consumePendingHints = useCallback(() => {
    if (pendingHintsRef.current.length === 0) {
      return null;
    }
    const hint = pendingHintsRef.current.join('\n');
    pendingHintsRef.current = [];
    setPendingHintCount(0);
    return hint;
  }, []);

  return {
    config,
    settings,
    reset,
    historyManager,
    isAlternateBuffer,
    currentModel,
    setCurrentModel,
    isConfigInitialized,
    setConfigInitialized,
    inputHistory,
    addInput,
    initializeFromLogger,
    terminalWidth,
    terminalHeight,
    stdin,
    setRawMode,
    stdout,
    app,
    sessionStats,
    branchName,
    rootUiRef,
    lastTitleRef,
    staticExtraHeight,
    handleFinalSubmitRef,
    errorCount,
    clearErrorCount,
    inputWidth,
    suggestionsWidth,
    staticAreaMaxItemHeight,
    mainAreaWidth,
    getPreferredEditor,
    buffer,
    bufferRef,
    stableSetText,
    refreshStatic,
    shouldUseAlternateScreen,
    isEditorDialogOpen,
    openEditorDialog,
    handleEditorSelect,
    exitEditorDialog,
    isSettingsDialogOpen,
    openSettingsDialog,
    closeSettingsDialog,
    isThemeDialogOpen,
    openThemeDialog,
    closeThemeDialog,
    handleThemeSelect,
    handleThemeHighlight,
    isResuming: sessions.isResuming,
    isSessionBrowserOpen: sessions.isSessionBrowserOpen,
    openSessionBrowser: sessions.openSessionBrowser,
    closeSessionBrowser: sessions.closeSessionBrowser,
    handleResumeSession: sessions.handleResumeSession,
    handleDeleteSession: sessions.handleDeleteSession,
    isModelDialogOpen: sessions.isModelDialogOpen,
    closeModelDialog: sessions.closeModelDialog,
    cleanUiDetailsVisible: sessions.cleanUiDetailsVisible,
    setCleanUiDetailsVisible: sessions.setCleanUiDetailsVisible,
    toggleCleanUiDetailsVisible: sessions.toggleCleanUiDetailsVisible,
    revealCleanUiDetailsTemporarily: sessions.revealCleanUiDetailsTemporarily,
    handleSlashCommand: sessions.handleSlashCommand,
    slashCommands: sessions.slashCommands,
    pendingSlashCommandHistoryItems: sessions.pendingSlashCommandHistoryItems,
    commandContext: sessions.commandContext,
    commandConfirmationRequest: sessions.commandConfirmationRequest,
    setIsBackgroundTaskListOpenRef: sessions.setIsBackgroundTaskListOpenRef,
    pendingHintsRef,
    pendingHintCount,
    consumePendingHints,
  };
}

function useStreamConsent(core: CoreDialogState, setup: ReturnType<typeof useStreamSetup>) {
  const [authConsentRequest, setAuthConsentRequest] = useState<ConfirmationRequest | null>(null);
  const [permissionConfirmationRequest, setPermissionConfirmationRequest] =
    useState<PermissionConfirmationRequest | null>(null);

  const cancelHandlerRef = useRef<(shouldRestorePrompt?: boolean, clearBuffer?: boolean) => void>(
    () => {},
  );

  const { setPendingRestorePrompt, pendingRestorePrompt } = core;
  const { inputHistory, historyManager } = setup;

  const onCancelSubmit = useCallback(
    (shouldRestorePrompt?: boolean, clearBuffer: boolean = false) => {
      if (shouldRestorePrompt) {
        setPendingRestorePrompt(true);
      } else {
        setPendingRestorePrompt(false);
        cancelHandlerRef.current(false, clearBuffer);
      }
    },
    [setPendingRestorePrompt],
  );

  useEffect(() => {
    if (pendingRestorePrompt) {
      const lastHistoryUserMsg = [...historyManager.history]
        .reverse()
        .find((h) => h.type === 'user');
      const lastUserMsg = inputHistory.at(-1);

      if (
        !lastHistoryUserMsg ||
        (typeof lastHistoryUserMsg.text === 'string' && lastHistoryUserMsg.text === lastUserMsg)
      ) {
        cancelHandlerRef.current(true);
        setPendingRestorePrompt(false);
      }
    }
  }, [pendingRestorePrompt, inputHistory, historyManager.history, setPendingRestorePrompt]);

  return {
    authConsentRequest,
    setAuthConsentRequest,
    permissionConfirmationRequest,
    setPermissionConfirmationRequest,
    cancelHandlerRef,
    onCancelSubmit,
  };
}

function useAgentStreamRuntime(
  core: CoreDialogState,
  setup: ReturnType<typeof useStreamSetup>,
  consent: ReturnType<typeof useStreamConsent>,
) {
  const streamAgent = hiveCoreConnection;

  const agentStreamResult = useAgentStream({
    agent: streamAgent,
    addItem: setup.historyManager.addItem,
    onCancelSubmit: consent.onCancelSubmit,
    isShellFocused: core.embeddedShellFocused,
    logger: useLogger(setup.config),
  });
  const activeStream = agentStreamResult;

  const {
    streamingState,
    submitQuery,
    initError,
    pendingHistoryItems: pendingAssistantHistoryItems,
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
    dismissBackgroundTask,
    retryStatus,
  } = activeStream;

  const pendingHistoryItems = useMemo(
    () => [...setup.pendingSlashCommandHistoryItems, ...pendingAssistantHistoryItems],
    [setup.pendingSlashCommandHistoryItems, pendingAssistantHistoryItems],
  );

  core.toggleBackgroundTasksRef.current = toggleBackgroundTasks;
  core.isBackgroundTaskVisibleRef.current = isBackgroundTaskVisible;
  core.backgroundTasksRef.current = backgroundTasks;

  const {
    activeBackgroundTaskPid,
    setIsBackgroundTaskListOpen,
    isBackgroundTaskListOpen,
    setActiveBackgroundTaskPid,
    backgroundTaskHeight,
    lastOutputTimeRef,
    shouldShowFocusHint,
    shouldShowActionRequiredTitle,
    shouldShowSilentWorkingTitle,
    handleApprovalModeChangeWithUiReveal,
    isMcpReady,
    isCompressing,
    messageQueue,
    addMessage,
    clearQueue,
    getQueuedMessagesText,
    popAllMessages,
  } = useStreamState({
    backgroundTasks,
    backgroundTaskCount,
    isBackgroundTaskVisible,
    activePtyId,
    embeddedShellFocused: core.embeddedShellFocused,
    setEmbeddedShellFocused: core.setEmbeddedShellFocused,
    terminalHeight: setup.terminalHeight,
    lastOutputTime,
    streamingState,
    pendingToolCalls,
    config: setup.config,
    cleanUiDetailsVisible: setup.cleanUiDetailsVisible,
    revealCleanUiDetailsTemporarily: setup.revealCleanUiDetailsTemporarily,
    handleApprovalModeChange,
    pendingHistoryItems,
    isConfigInitialized: setup.isConfigInitialized,
    submitQuery,
    setIsBackgroundTaskListOpenRef: setup.setIsBackgroundTaskListOpenRef,
  });

  const { handleFinalSubmit, handleClearScreen, vimHandleInput } = useSubmitHandlers({
    buffer: setup.buffer,
    inputHistory: setup.inputHistory,
    getQueuedMessagesText,
    clearQueue,
    pendingHistoryItems,
    config: setup.config,
    historyManager: setup.historyManager,
    reset: setup.reset,
    triggerExpandHint: core.triggerExpandHint,
    constrainHeight: core.constrainHeight,
    setConstrainHeight: core.setConstrainHeight,
    isAlternateBuffer: setup.isAlternateBuffer,
    refreshStatic: setup.refreshStatic,
    streamingState,
    isMcpReady,
    isCompressing,
    isConfigInitialized: setup.isConfigInitialized,
    slashCommands: setup.slashCommands,
    handleSlashCommand: setup.handleSlashCommand,
    submitQuery,
    addInput: setup.addInput,
    addMessage,
    setPermissionConfirmationRequest: consent.setPermissionConfirmationRequest,
    messageQueueLength: messageQueue.length,
    clearErrorCount: setup.clearErrorCount,
    handleFinalSubmitRef: setup.handleFinalSubmitRef,
    cancelHandlerRef: consent.cancelHandlerRef,
  });

  /**
   * Determines if the input prompt should be active and accept user input.
   * Input is disabled during:
   * - Initialization errors
   * - Slash command processing
   * - Tool confirmations (WaitingForConfirmation state)
   * - Any future streaming states not explicitly allowed
   */
  const isInputActive =
    !initError &&
    !core.isProcessing &&
    !setup.isResuming &&
    (streamingState === StreamingState.Idle ||
      streamingState === StreamingState.Responding ||
      streamingState === StreamingState.WaitingForConfirmation);

  return {
    streamingState,
    submitQuery,
    initError,
    pendingAssistantHistoryItems,
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
    dismissBackgroundTask,
    retryStatus,
    pendingHistoryItems,
    activeBackgroundTaskPid,
    setIsBackgroundTaskListOpen,
    isBackgroundTaskListOpen,
    setActiveBackgroundTaskPid,
    backgroundTaskHeight,
    lastOutputTimeRef,
    shouldShowFocusHint,
    shouldShowActionRequiredTitle,
    shouldShowSilentWorkingTitle,
    handleApprovalModeChangeWithUiReveal,
    isMcpReady,
    isCompressing,
    messageQueue,
    addMessage,
    clearQueue,
    getQueuedMessagesText,
    popAllMessages,
    handleFinalSubmit,
    handleClearScreen,
    vimHandleInput,
    isInputActive,
  };
}

function useStreamLayout(
  core: CoreDialogState,
  setup: ReturnType<typeof useStreamSetup>,
  stream: ReturnType<typeof useAgentStreamRuntime>,
) {
  const {
    stableControlsHeight,
    mainControlsRef,
    availableTerminalHeight,
    isFocused,
    hasReceivedFocusEvent,
    contextFileNames,
    initialPrompt,
    initialPromptSubmitted,
    isConnectedToCore,
  } = useLayoutAndControls({
    copyModeEnabled: core.copyModeEnabled,
    terminalHeight: setup.terminalHeight,
    terminalWidth: setup.terminalWidth,
    backgroundTaskHeight: stream.backgroundTaskHeight,
    settings: setup.settings,
    config: setup.config,
  });

  const { isConfigInitialized, isThemeDialogOpen, isEditorDialogOpen } = setup;
  const { handleFinalSubmit } = stream;

  useEffect(() => {
    if (
      initialPrompt &&
      isConfigInitialized &&
      !initialPromptSubmitted.current &&
      !isThemeDialogOpen &&
      !isEditorDialogOpen &&
      !core.showPrivacyNotice &&
      isConnectedToCore
    ) {
      void handleFinalSubmit(initialPrompt);
      initialPromptSubmitted.current = true;
    }
  }, [
    initialPrompt,
    isConfigInitialized,
    handleFinalSubmit,
    isThemeDialogOpen,
    isEditorDialogOpen,
    core.showPrivacyNotice,
    isConnectedToCore,
    initialPromptSubmitted,
  ]);

  return {
    stableControlsHeight,
    mainControlsRef,
    availableTerminalHeight,
    isFocused,
    hasReceivedFocusEvent,
    contextFileNames,
    initialPrompt,
    initialPromptSubmitted,
    isConnectedToCore,
  };
}

function useStreamRuntime(base: ReturnType<typeof useBaseStates>, core: CoreDialogState) {
  const setup = useStreamSetup(base, core);
  const consent = useStreamConsent(core, setup);
  const stream = useAgentStreamRuntime(core, setup, consent);
  const layout = useStreamLayout(core, setup, stream);

  return {
    ...base,
    ...core,
    ...setup,
    ...consent,
    ...stream,
    ...layout,
  };
}

function useRuntimeAndStream(props: AppContainerProps) {
  const base = useBaseStates(props);
  const core = useCoreAndDialogStates(props, base.historyManager);
  const stream = useStreamRuntime(base, core);

  return {
    ...base,
    ...core,
    ...stream,
  };
}

function useDialogOverlay(runtime: RuntimeStreamState) {
  const {
    config,
    settings,
    historyManager,
    handleSlashCommand,
    commandConfirmationRequest,
    streamingState,
    thought,
    cancelOngoingRequest,
    backgroundCurrentExecution,
    backgroundTasks,
    toggleBackgroundTasks,
    pendingHistoryItems,
    setIsBackgroundTaskListOpen,
    lastOutputTimeRef,
    shouldShowActionRequiredTitle,
    shouldShowSilentWorkingTitle,
  } = runtime;

  const {
    currentIDE,
    setIdePromptAnswered,
    shouldShowIdePrompt,
    showErrorDetails,
    setShowErrorDetails,
    showFullTodos,
    setShowFullTodos,
    renderMarkdown,
    setRenderMarkdown,
    ctrlCPressCount,
    handleCtrlCPress,
    ctrlDPressCount,
    handleCtrlDPress,
    ideContextState,
    setIdeContextState,
    showEscapePrompt,
    setShowEscapePrompt,
    showIdeRestartPrompt,
    setShowIdeRestartPrompt,
    transientMessage,
    showTransientMessage,
    isFolderTrustDialogOpen,
    folderDiscoveryResults,
    handleFolderTrustSelect,
    isRestarting,
    policyUpdateConfirmationRequest,
    isPolicyUpdateDialogOpen,
    setIsPolicyUpdateDialogOpen,
    ideNeedsRestart,
    ideTrustRestartReason,
    tabFocusTimeoutRef,
  } = useIdeAndOverlayStates({
    config,
    settings,
    handleSlashCommand,
  });

  const { handleSuspend, handleEscapePromptChange, handleIdePromptComplete, handleWarning } =
    useAppEventsEffects({
      tabFocusTimeoutRef,
      ideNeedsRestart,
      setShowIdeRestartPrompt,
      setIdeContextState,
      setShowErrorDetails,
      setConstrainHeight: runtime.setConstrainHeight,
      config,
      setShowEscapePrompt,
      handleSlashCommand,
      settings,
      setIdePromptAnswered,
      showTransientMessage,
      setRawMode: runtime.setRawMode,
      shouldUseAlternateScreen: runtime.shouldUseAlternateScreen,
    });

  const handleGlobalKeypress = useGlobalKeypressHandler({
    settings,
    shortcutsHelpVisible: runtime.shortcutsHelpVisible,
    mouseMode: runtime.mouseMode,
    constrainHeight: runtime.constrainHeight,
    isAlternateBuffer: runtime.isAlternateBuffer,
    embeddedShellFocused: runtime.embeddedShellFocused,
    isBackgroundTaskVisible: runtime.isBackgroundTaskVisible,
    activePtyId: runtime.activePtyId,
    ideContextState,
    showErrorDetails,
    bufferRef: runtime.bufferRef,
    recordingFilenameRef: runtime.recordingFilenameRef,
    lastOutputTimeRef,
    tabFocusTimeoutRef,
    backgroundTasks,
    setShortcutsHelpVisible: runtime.setShortcutsHelpVisible,
    setMouseMode: runtime.setMouseMode,
    setConstrainHeight: runtime.setConstrainHeight,
    setCopyModeEnabled: runtime.setCopyModeEnabled,
    setShowErrorDetails,
    setShowFullTodos,
    setRenderMarkdown,
    setEmbeddedShellFocused: runtime.setEmbeddedShellFocused,
    setIsBackgroundTaskListOpen,
    handleCtrlCPress,
    handleCtrlDPress,
    handleSuspend,
    handleSlashCommand,
    cancelOngoingRequest,
    backgroundCurrentExecution,
    toggleBackgroundTasks,
    refreshStatic: runtime.refreshStatic,
    showTransientMessage,
    triggerExpandHint: runtime.triggerExpandHint,
    toggleAllExpansion: runtime.toggleAllExpansion,
    dumpCurrentFrame: runtime.dumpCurrentFrame,
    startRecording: runtime.startRecording,
    stopRecording: runtime.stopRecording,
    keyMatchers: runtime.keyMatchers,
    isHelpDismissKey: runtime.isHelpDismissKey,
    history: historyManager.history,
    pendingHistoryItems,
    config,
  });

  useAppKeypress({
    handleGlobalKeypress,
    keyMatchers: runtime.keyMatchers,
    copyModeEnabled: runtime.copyModeEnabled,
    mouseMode: runtime.mouseMode,
    setCopyModeEnabled: runtime.setCopyModeEnabled,
  });

  useWindowTitle({
    settings,
    streamingState,
    thoughtSubject: thought?.subject,
    commandConfirmationRequest,
    shouldShowActionRequiredTitle,
    shouldShowSilentWorkingTitle,
    config,
    stdout: runtime.stdout,
    lastTitleRef: runtime.lastTitleRef,
  });

  return {
    currentIDE,
    setIdePromptAnswered,
    shouldShowIdePrompt,
    showErrorDetails,
    setShowErrorDetails,
    showFullTodos,
    setShowFullTodos,
    renderMarkdown,
    setRenderMarkdown,
    ctrlCPressCount,
    handleCtrlCPress,
    ctrlDPressCount,
    handleCtrlDPress,
    ideContextState,
    setIdeContextState,
    showEscapePrompt,
    setShowEscapePrompt,
    showIdeRestartPrompt,
    setShowIdeRestartPrompt,
    transientMessage,
    showTransientMessage,
    isFolderTrustDialogOpen,
    folderDiscoveryResults,
    handleFolderTrustSelect,
    isRestarting,
    policyUpdateConfirmationRequest,
    isPolicyUpdateDialogOpen,
    setIsPolicyUpdateDialogOpen,
    ideNeedsRestart,
    ideTrustRestartReason,
    tabFocusTimeoutRef,
    handleSuspend,
    handleEscapePromptChange,
    handleIdePromptComplete,
    handleWarning,
  };
}

function useDialogStatusComputation(
  runtime: RuntimeStreamState,
  props: AppContainerProps,
  overlay: ReturnType<typeof useDialogOverlay>,
) {
  const {
    config,
    settings,
    historyManager,
    isSessionBrowserOpen,
    isModelDialogOpen,
    commandConfirmationRequest,
    authConsentRequest,
    permissionConfirmationRequest,
    streamingState,
    submitQuery,
    thought,
    pendingHistoryItems,
    shouldShowFocusHint,
    handleApprovalModeChangeWithUiReveal,
    isMcpReady,
    isInputActive,
    isFocused,
    hasReceivedFocusEvent,
  } = runtime;

  const nightly = props.version.includes('nightly');

  const isAwaitingLoginRestart = false;

  const { dialogsVisible, hasPendingActionRequired, maxLength } = computeDialogAndStatus({
    shouldShowIdePrompt: overlay.shouldShowIdePrompt,
    isFolderTrustDialogOpen: overlay.isFolderTrustDialogOpen,
    isPolicyUpdateDialogOpen: overlay.isPolicyUpdateDialogOpen,
    adminSettingsChanged: runtime.adminSettingsChanged,
    commandConfirmationRequest,
    authConsentRequest,
    permissionConfirmationRequest,
    customDialog: runtime.customDialog,
    confirmUpdateExtensionRequests: runtime.confirmUpdateExtensionRequests,
    loopDetectionConfirmationRequest: runtime.loopDetectionConfirmationRequest,
    isThemeDialogOpen: runtime.isThemeDialogOpen,
    isSettingsDialogOpen: runtime.isSettingsDialogOpen,
    isModelDialogOpen,
    isAgentConfigDialogOpen: runtime.isAgentConfigDialogOpen,
    isPermissionsDialogOpen: runtime.isPermissionsDialogOpen,
    isEditorDialogOpen: runtime.isEditorDialogOpen,
    showPrivacyNotice: runtime.showPrivacyNotice,
    showIdeRestartPrompt: overlay.showIdeRestartPrompt,
    isSessionBrowserOpen,
    isAwaitingLoginRestart,
    newAgents: runtime.newAgents,
    pendingHistoryItems,
    embeddedShellFocused: runtime.embeddedShellFocused,
    isBackgroundTaskVisible: runtime.isBackgroundTaskVisible,
    streamingState,
    activeHooks: runtime.activeHooks,
    hooksNotifications: settings.merged.hooksConfig.notifications,
    thoughtSubject: thought?.subject,
    terminalWidth: runtime.terminalWidth,
  });

  const loadingPhrases = settings.merged.ui.loadingPhrases;
  const showStatusTips = loadingPhrases === 'tips' || loadingPhrases === 'all';
  const showStatusWit = loadingPhrases === 'witty' || loadingPhrases === 'all';

  const {
    elapsedTime,
    currentLoadingPhrase,
    currentTip,
    currentWittyPhrase,
    allowPlanMode,
    showApprovalModeIndicator,
  } = useStatusAndNotifications({
    settings,
    streamingState,
    shouldShowFocusHint,
    retryStatus: runtime.retryStatus,
    showStatusTips,
    showStatusWit,
    maxLength,
    config,
    historyManager,
    handleApprovalModeChangeWithUiReveal,
    embeddedShellFocused: runtime.embeddedShellFocused,
    hasPendingActionRequired,
    notificationsEnabled: runtime.notificationsEnabled,
    notificationMethod: runtime.notificationMethod,
    isFocused,
    hasReceivedFocusEvent,
    pendingHistoryItems,
    commandConfirmationRequest,
    authConsentRequest,
    permissionConfirmationRequest,
    confirmUpdateExtensionRequests: runtime.confirmUpdateExtensionRequests,
    loopDetectionConfirmationRequest: runtime.loopDetectionConfirmationRequest,
    shortcutsHelpVisible: runtime.shortcutsHelpVisible,
    setShortcutsHelpVisible: runtime.setShortcutsHelpVisible,
    isInputActive,
    isConfigInitialized: runtime.isConfigInitialized,
    isMcpReady,
    submitQuery,
    consumePendingHints: runtime.consumePendingHints,
    pendingHintCount: runtime.pendingHintCount,
  });

  const allToolCalls = useMemo(() => getAllToolCalls(pendingHistoryItems), [pendingHistoryItems]);

  return {
    nightly,
    isAwaitingLoginRestart,
    dialogsVisible,
    hasPendingActionRequired,
    maxLength,
    elapsedTime,
    currentLoadingPhrase,
    currentTip,
    currentWittyPhrase,
    allowPlanMode,
    showApprovalModeIndicator,
    allToolCalls,
  };
}

function useDialogAndStatus(runtime: RuntimeStreamState, props: AppContainerProps) {
  const overlay = useDialogOverlay(runtime);
  const status = useDialogStatusComputation(runtime, props, overlay);

  return {
    ...overlay,
    ...status,
  };
}

function useFinalAssembly(
  runtime: RuntimeStreamState,
  dialogs: ReturnType<typeof useDialogAndStatus>,
  props: AppContainerProps,
) {
  const [hiveMdFileCount, setHiveMdFileCount] = useState<number>(
    runtime.config.getHiveMdFileCount(),
  );

  // Subscribe to fallback mode and model changes from core
  useCoreEventSubscriptions({
    config: runtime.config,
    setCurrentModel: runtime.setCurrentModel,
    setSettingsNonce: runtime.setSettingsNonce,
    setAdminSettingsChanged: runtime.setAdminSettingsChanged,
    setNewAgents: runtime.setNewAgents,
    setAuthConsentRequest: runtime.setAuthConsentRequest,
    setHiveMdFileCount,
    historyManager: runtime.historyManager,
  });

  const { inputState, uiState, uiActions } = useFinalUIBuilders({
    buffer: runtime.buffer,
    inputHistory: runtime.inputHistory,
    shellModeActive: runtime.shellModeActive,
    showEscapePrompt: dialogs.showEscapePrompt,
    copyModeEnabled: runtime.copyModeEnabled,
    inputWidth: runtime.inputWidth,
    suggestionsWidth: runtime.suggestionsWidth,
    historyManager: runtime.historyManager,
    isThemeDialogOpen: runtime.isThemeDialogOpen,
    themeError: runtime.themeError,
    isConfigInitialized: runtime.isConfigInitialized,
    isAwaitingLoginRestart: dialogs.isAwaitingLoginRestart,
    editorError: runtime.editorError,
    isEditorDialogOpen: runtime.isEditorDialogOpen,
    showPrivacyNotice: runtime.showPrivacyNotice,
    mouseMode: runtime.mouseMode,
    corgiMode: runtime.corgiMode,
    debugMessage: runtime.debugMessage,
    quittingMessages: runtime.quittingMessages,
    isSettingsDialogOpen: runtime.isSettingsDialogOpen,
    isSessionBrowserOpen: runtime.isSessionBrowserOpen,
    isModelDialogOpen: runtime.isModelDialogOpen,
    isAgentConfigDialogOpen: runtime.isAgentConfigDialogOpen,
    selectedAgentName: runtime.selectedAgentName,
    selectedAgentDisplayName: runtime.selectedAgentDisplayName,
    selectedAgentDefinition: runtime.selectedAgentDefinition,
    isPermissionsDialogOpen: runtime.isPermissionsDialogOpen,
    permissionsDialogProps: runtime.permissionsDialogProps,
    slashCommands: runtime.slashCommands,
    pendingSlashCommandHistoryItems: runtime.pendingSlashCommandHistoryItems,
    commandContext: runtime.commandContext,
    commandConfirmationRequest: runtime.commandConfirmationRequest,
    authConsentRequest: runtime.authConsentRequest,
    confirmUpdateExtensionRequests: runtime.confirmUpdateExtensionRequests,
    loopDetectionConfirmationRequest: runtime.loopDetectionConfirmationRequest,
    permissionConfirmationRequest: runtime.permissionConfirmationRequest,
    hiveMdFileCount,
    streamingState: runtime.streamingState,
    initError: runtime.initError,
    pendingAssistantHistoryItems: runtime.pendingAssistantHistoryItems,
    thought: runtime.thought,
    isInputActive: runtime.isInputActive,
    isResuming: runtime.isResuming,
    shouldShowIdePrompt: dialogs.shouldShowIdePrompt,
    isFolderTrustDialogOpen: dialogs.isFolderTrustDialogOpen,
    folderDiscoveryResults: dialogs.folderDiscoveryResults,
    isPolicyUpdateDialogOpen: dialogs.isPolicyUpdateDialogOpen,
    policyUpdateConfirmationRequest: dialogs.policyUpdateConfirmationRequest as
      PolicyUpdateConfirmationRequest | undefined,
    isTrustedFolder: runtime.isTrustedFolder,
    constrainHeight: runtime.constrainHeight,
    showErrorDetails: dialogs.showErrorDetails,
    showFullTodos: dialogs.showFullTodos,
    ideContextState: dialogs.ideContextState,
    renderMarkdown: dialogs.renderMarkdown,
    ctrlCPressCount: dialogs.ctrlCPressCount,
    ctrlDPressCount: dialogs.ctrlDPressCount,
    shortcutsHelpVisible: runtime.shortcutsHelpVisible,
    cleanUiDetailsVisible: runtime.cleanUiDetailsVisible,
    elapsedTime: dialogs.elapsedTime,
    currentLoadingPhrase: dialogs.currentLoadingPhrase,
    currentTip: dialogs.currentTip,
    currentWittyPhrase: dialogs.currentWittyPhrase,
    historyRemountKey: runtime.historyRemountKey,
    activeHooks: runtime.activeHooks,
    messageQueue: runtime.messageQueue,
    queueErrorMessage: runtime.queueErrorMessage,
    showApprovalModeIndicator: dialogs.showApprovalModeIndicator,
    allowPlanMode: dialogs.allowPlanMode,
    currentModel: runtime.currentModel,
    contextFileNames: runtime.contextFileNames,
    errorCount: runtime.errorCount,
    availableTerminalHeight: runtime.availableTerminalHeight,
    stableControlsHeight: runtime.stableControlsHeight,
    mainAreaWidth: runtime.mainAreaWidth,
    staticAreaMaxItemHeight: runtime.staticAreaMaxItemHeight,
    staticExtraHeight: runtime.staticExtraHeight,
    dialogsVisible: dialogs.dialogsVisible,
    pendingHistoryItems: runtime.pendingHistoryItems,
    nightly: dialogs.nightly,
    branchName: runtime.branchName,
    sessionStats: runtime.sessionStats,
    terminalWidth: runtime.terminalWidth,
    terminalHeight: runtime.terminalHeight,
    mainControlsRef: runtime.mainControlsRef as unknown as (node: DOMElement | null) => void,
    rootUiRef: runtime.rootUiRef as React.RefObject<DOMElement | null>,
    currentIDE: dialogs.currentIDE,
    updateInfo: runtime.updateInfo,
    showIdeRestartPrompt: dialogs.showIdeRestartPrompt,
    ideTrustRestartReason: dialogs.ideTrustRestartReason,
    isRestarting: dialogs.isRestarting,
    extensionsUpdateState: runtime.extensionsUpdateState,
    activePtyId: runtime.activePtyId,
    backgroundTaskCount: runtime.backgroundTaskCount,
    isBackgroundTaskVisible: runtime.isBackgroundTaskVisible,
    embeddedShellFocused: runtime.embeddedShellFocused,
    showDebugProfiler: runtime.showDebugProfiler,
    customDialog: runtime.customDialog,
    transientMessage: dialogs.transientMessage,
    bannerData: runtime.bannerData,
    bannerVisible: runtime.bannerVisible,
    terminalBackgroundColor: runtime.config.getTerminalBackground(),
    settingsNonce: runtime.settingsNonce,
    backgroundTasks: runtime.backgroundTasks,
    activeBackgroundTaskPid: runtime.activeBackgroundTaskPid,
    backgroundTaskHeight: runtime.backgroundTaskHeight,
    isBackgroundTaskListOpen: runtime.isBackgroundTaskListOpen,
    adminSettingsChanged: runtime.adminSettingsChanged,
    newAgents: runtime.newAgents,
    showIsExpandableHint: runtime.showIsExpandableHint,
    config: runtime.config,
    handleThemeSelect: runtime.handleThemeSelect,
    closeThemeDialog: runtime.closeThemeDialog,
    handleThemeHighlight: runtime.handleThemeHighlight,
    handleEditorSelect: runtime.handleEditorSelect,
    exitEditorDialog: runtime.exitEditorDialog,
    setShowPrivacyNotice: runtime.setShowPrivacyNotice,
    closeSettingsDialog: runtime.closeSettingsDialog,
    closeModelDialog: runtime.closeModelDialog,
    openAgentConfigDialog: runtime.openAgentConfigDialog,
    closeAgentConfigDialog: runtime.closeAgentConfigDialog,
    openPermissionsDialog: runtime.openPermissionsDialog,
    closePermissionsDialog: runtime.closePermissionsDialog,
    setShellModeActive: runtime.setShellModeActive,
    vimHandleInput: runtime.vimHandleInput,
    handleIdePromptComplete: dialogs.handleIdePromptComplete,
    handleFolderTrustSelect: dialogs.handleFolderTrustSelect,
    setIsPolicyUpdateDialogOpen: dialogs.setIsPolicyUpdateDialogOpen,
    setConstrainHeight: runtime.setConstrainHeight,
    handleEscapePromptChange: dialogs.handleEscapePromptChange,
    refreshStatic: runtime.refreshStatic,
    handleFinalSubmit: runtime.handleFinalSubmit,
    handleClearScreen: runtime.handleClearScreen,
    openSessionBrowser: runtime.openSessionBrowser,
    closeSessionBrowser: runtime.closeSessionBrowser,
    handleResumeSession: runtime.handleResumeSession,
    handleDeleteSession: runtime.handleDeleteSession,
    setQueueErrorMessage: runtime.setQueueErrorMessage,
    addMessage: runtime.addMessage,
    popAllMessages: runtime.popAllMessages,
    setBannerVisible: runtime.setBannerVisible,
    setShortcutsHelpVisible: runtime.setShortcutsHelpVisible,
    setCleanUiDetailsVisible: runtime.setCleanUiDetailsVisible,
    toggleCleanUiDetailsVisible: runtime.toggleCleanUiDetailsVisible,
    revealCleanUiDetailsTemporarily: runtime.revealCleanUiDetailsTemporarily,
    handleWarning: dialogs.handleWarning,
    setEmbeddedShellFocused: runtime.setEmbeddedShellFocused,
    dismissBackgroundTask: runtime.dismissBackgroundTask,
    setActiveBackgroundTaskPid: runtime.setActiveBackgroundTaskPid,
    setIsBackgroundTaskListOpen: runtime.setIsBackgroundTaskListOpen,
    setNewAgents: runtime.setNewAgents,
    getPreferredEditor: runtime.getPreferredEditor,
  });

  return {
    uiState,
    uiActions,
    inputState,
    config: runtime.config,
    props,
    allToolCalls: dialogs.allToolCalls,
    isExpanded: runtime.isExpanded,
    toggleExpansion: runtime.toggleExpansion,
    toggleAllExpansion: runtime.toggleAllExpansion,
    isFocused: runtime.isFocused,
    mouseMode: runtime.mouseMode,
  };
}

function useAppContainerState(props: AppContainerProps) {
  const runtime = useRuntimeAndStream(props);
  const dialogs = useDialogAndStatus(runtime, props);
  return useFinalAssembly(runtime, dialogs, props);
}

const AppContainerInternal = (props: AppContainerProps) => {
  const {
    uiState,
    uiActions,
    inputState,
    config,
    props: containerProps,
    allToolCalls,
    isExpanded,
    toggleExpansion,
    toggleAllExpansion,
    isFocused,
    mouseMode,
  } = useAppContainerState(props);

  return (
    <UIStateContext.Provider value={uiState}>
      <QuotaContext.Provider value={EMPTY_QUOTA_STATE}>
        <InputContext.Provider value={inputState}>
          <UIActionsContext.Provider value={uiActions}>
            <ConfigContext.Provider value={config}>
              <AppContext.Provider
                value={{
                  version: containerProps.version,
                  startupWarnings: containerProps.startupWarnings || [],
                }}
              >
                <ToolActionsProvider
                  config={config}
                  toolCalls={allToolCalls}
                  isExpanded={isExpanded}
                  toggleExpansion={toggleExpansion}
                  toggleAllExpansion={toggleAllExpansion}
                >
                  <ShellFocusContext.Provider value={isFocused}>
                    <MouseProvider mouseEventsEnabled={mouseMode}>
                      <ScrollProvider>
                        <App />
                      </ScrollProvider>
                    </MouseProvider>
                  </ShellFocusContext.Provider>
                </ToolActionsProvider>
              </AppContext.Provider>
            </ConfigContext.Provider>
          </UIActionsContext.Provider>
        </InputContext.Provider>
      </QuotaContext.Provider>
    </UIStateContext.Provider>
  );
};

export const AppContainer = (props: AppContainerProps) => (
  <TUIOverlayProvider>
    <AppContainerInternal {...props} />
  </TUIOverlayProvider>
);
