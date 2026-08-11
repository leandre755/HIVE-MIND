/**
 * @license
 * Copyright 2026 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useState, useMemo, type ReactNode } from 'react';

export interface TUIOverlayState {
  shortcutsHelpVisible: boolean;
  setShortcutsHelpVisible: React.Dispatch<React.SetStateAction<boolean>>;
  corgiMode: boolean;
  setCorgiMode: React.Dispatch<React.SetStateAction<boolean>>;
  editorError: string | null;
  setEditorError: (error: string | null) => void;
  backgroundTasks: unknown[];
  setBackgroundTasks: React.Dispatch<React.SetStateAction<unknown[]>>;
}

const TUIOverlayContext = createContext<TUIOverlayState | undefined>(undefined);

export interface TUIOverlayProviderProps {
  children: ReactNode;
}

/**
 * Provider isolating local overlay, popup dialogs, and background task visibility states.
 * Prevents unnecessary top-level AppContainer re-renders when toggling UI overlays.
 */
export const TUIOverlayProvider: React.FC<TUIOverlayProviderProps> = ({ children }) => {
  const [shortcutsHelpVisible, setShortcutsHelpVisible] = useState(false);
  const [corgiMode, setCorgiMode] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [backgroundTasks, setBackgroundTasks] = useState<unknown[]>([]);

  const value = useMemo<TUIOverlayState>(
    () => ({
      shortcutsHelpVisible,
      setShortcutsHelpVisible,
      corgiMode,
      setCorgiMode,
      editorError,
      setEditorError,
      backgroundTasks,
      setBackgroundTasks,
    }),
    [shortcutsHelpVisible, corgiMode, editorError, backgroundTasks],
  );

  return <TUIOverlayContext.Provider value={value}>{children}</TUIOverlayContext.Provider>;
};

/**
 * Custom hook to consume the TUIOverlayContext.
 */
export const useTUIOverlay = (): TUIOverlayState => {
  const context = useContext(TUIOverlayContext);
  if (!context) {
    throw new Error('useTUIOverlay must be used within a TUIOverlayProvider');
  }
  return context;
};
