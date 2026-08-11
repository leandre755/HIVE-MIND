import { useState, useEffect } from 'react';
import type { Key } from '../contexts/KeypressContext.js';
import { HiveConfig } from '../../config/hiveConfig.js';
import {
  ApprovalMode,
  getAdminErrorMessage,
  MessageType,
  HistoryItemWithoutId,
} from '../contexts/UIStateContext.js';
import { useKeypress } from './useKeypress.js';
import { Command } from '../key/keyMatchers.js';
import { useKeyMatchers } from './useKeyMatchers.js';

export interface UseApprovalModeIndicatorArgs {
  config: HiveConfig;
  addItem?: (item: HistoryItemWithoutId, timestamp: number) => void;
  onApprovalModeChange?: (mode: ApprovalMode) => void;
  isActive?: boolean;
  allowPlanMode?: boolean;
}

function getYoloDisabledWarning(config: HiveConfig): string {
  const adminSettings = config.getRemoteAdminSettings() as
    { strictModeDisabled?: boolean } | undefined;
  const hasSettings = adminSettings && Object.keys(adminSettings).length > 0;
  if (hasSettings && !adminSettings?.strictModeDisabled) {
    return (getAdminErrorMessage as (feature: string, cfg: HiveConfig) => string)(
      'YOLO mode',
      config,
    );
  }
  return 'You cannot enter YOLO mode since it is disabled in your settings.';
}

function getNextApprovalMode(
  currentMode: ApprovalMode,
  allowPlanMode: boolean,
): ApprovalMode | undefined {
  switch (currentMode) {
    case ApprovalMode.DEFAULT:
      return ApprovalMode.AUTO_EDIT;
    case ApprovalMode.AUTO_EDIT:
      return allowPlanMode ? ApprovalMode.PLAN : ApprovalMode.DEFAULT;
    case ApprovalMode.PLAN:
      return ApprovalMode.DEFAULT;
    case ApprovalMode.YOLO:
      return ApprovalMode.AUTO_EDIT;
    default:
      return undefined;
  }
}

function processKeypressApprovalMode(
  key: unknown,
  keyMatchers: ReturnType<typeof useKeyMatchers>,
  config: HiveConfig,
  allowPlanMode: boolean,
  addItem?: (item: HistoryItemWithoutId, timestamp: number) => void,
): ApprovalMode | undefined | 'CANCELLED' {
  const inkKey = key as Key;
  if (keyMatchers[Command.TOGGLE_YOLO](inkKey)) {
    if (
      config.isYoloModeDisabled() &&
      (config.getApprovalMode() as ApprovalMode) !== ApprovalMode.YOLO
    ) {
      if (addItem) {
        addItem(
          {
            type: MessageType.WARNING,
            text: getYoloDisabledWarning(config),
          },
          Date.now(),
        );
      }
      return 'CANCELLED';
    }
    return (config.getApprovalMode() as ApprovalMode) === ApprovalMode.YOLO
      ? ApprovalMode.DEFAULT
      : ApprovalMode.YOLO;
  }
  if (keyMatchers[Command.CYCLE_APPROVAL_MODE](inkKey)) {
    return getNextApprovalMode(config.getApprovalMode() as ApprovalMode, allowPlanMode);
  }
  return undefined;
}

export function useApprovalModeIndicator({
  config,
  addItem,
  onApprovalModeChange,
  isActive = true,
  allowPlanMode = false,
}: UseApprovalModeIndicatorArgs): ApprovalMode {
  const keyMatchers = useKeyMatchers();
  const currentConfigValue = config.getApprovalMode() as ApprovalMode;
  const [showApprovalMode, setApprovalMode] = useState<ApprovalMode>(currentConfigValue);

  useEffect(() => {
    setApprovalMode((prev) => (prev !== currentConfigValue ? currentConfigValue : prev));
  }, [currentConfigValue]);

  useKeypress(
    (key) => {
      const modeOrStatus = processKeypressApprovalMode(
        key,
        keyMatchers,
        config,
        allowPlanMode,
        addItem,
      );

      if (!modeOrStatus || modeOrStatus === 'CANCELLED') {
        return;
      }

      const nextApprovalMode = modeOrStatus;

      try {
        (config as unknown as { setApprovalMode: (mode: ApprovalMode) => void }).setApprovalMode(
          nextApprovalMode,
        );
        // Update local state immediately for responsiveness
        setApprovalMode(nextApprovalMode);

        // Notify the central handler about the approval mode change
        onApprovalModeChange?.(nextApprovalMode);
      } catch (e) {
        if (addItem) {
          addItem(
            {
              type: MessageType.INFO,
              text: (e as Error).message,
            },
            Date.now(),
          );
        }
      }
    },
    { isActive },
  );

  return showApprovalMode;
}
