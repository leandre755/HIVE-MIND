import { createContext, useContext } from 'react';
import { type Key } from '../hooks/useKeypress.js';
import { type IdeIntegrationNudgeResult } from '../IdeIntegrationNudge.js';
import { AgentDefinition, NewAgentsChoice, EditorType } from './UIStateContext.js';
import { type LoadableSettingScope } from '../../config/settings.js';
import type { SessionInfo } from '../../utils/sessionUtils.js';

export interface UIActions {
  handleThemeSelect: (themeName: string, scope: LoadableSettingScope) => Promise<void>;
  closeThemeDialog: () => void;
  handleThemeHighlight: (themeName: string | undefined) => void;

  handleEditorSelect: (editorType: EditorType | undefined, scope: LoadableSettingScope) => void;
  exitEditorDialog: () => void;
  exitPrivacyNotice: () => void;
  closeSettingsDialog: () => void;
  closeModelDialog: () => void;

  openAgentConfigDialog: (name: string, displayName: string, definition: AgentDefinition) => void;
  closeAgentConfigDialog: () => void;
  openPermissionsDialog: (props?: unknown) => void;
  closePermissionsDialog: () => void;
  setShellModeActive: (value: boolean) => void;
  vimHandleInput: (key: Key) => boolean;
  handleIdePromptComplete: (result: IdeIntegrationNudgeResult) => void;
  handleFolderTrustSelect: (choice: 'trust' | 'deny' | string) => void;
  setIsPolicyUpdateDialogOpen: (value: boolean) => void;
  setConstrainHeight: (value: boolean) => void;
  onEscapePromptChange: (show: boolean) => void;
  refreshStatic: () => void;
  handleFinalSubmit: (value: string) => Promise<void>;
  handleClearScreen: () => void;
  openSessionBrowser: () => void;
  closeSessionBrowser: () => void;
  handleResumeSession: (session: SessionInfo) => Promise<void>;
  handleDeleteSession: (session: SessionInfo) => Promise<void>;
  setQueueErrorMessage: (message: string | null) => void;
  addMessage: (message: string) => void;
  popAllMessages: () => string | undefined;
  setBannerVisible: (visible: boolean) => void;
  setShortcutsHelpVisible: (visible: boolean) => void;
  setCleanUiDetailsVisible: (visible: boolean) => void;
  toggleCleanUiDetailsVisible: () => void;
  revealCleanUiDetailsTemporarily: (durationMs?: number) => void;
  handleWarning: (message: string) => void;
  setEmbeddedShellFocused: (value: boolean) => void;
  dismissBackgroundTask: (pid: number) => Promise<void>;
  setActiveBackgroundTaskPid: (pid: number) => void;
  setIsBackgroundTaskListOpen: (isOpen: boolean) => void;
  onHintInput: (char: string) => void;
  onHintBackspace: () => void;
  onHintClear: () => void;
  onHintSubmit: (hint: string) => void;
  handleRestart: () => void;
  handleNewAgentsSelect: (choice: NewAgentsChoice) => Promise<void>;
  getPreferredEditor: () => EditorType | undefined;
}

export const UIActionsContext = createContext<UIActions | null>(null);

export const useUIActions = () => {
  const context = useContext(UIActionsContext);
  if (!context) {
    throw new Error('useUIActions must be used within a UIActionsProvider');
  }
  return context;
};
