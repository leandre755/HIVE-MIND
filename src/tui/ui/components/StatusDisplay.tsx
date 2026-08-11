/**
 * @license
 * Copyright 2025 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { useUIState } from '../contexts/UIStateContext.js';
import { useSettings } from '../contexts/SettingsContext.js';
import { useConfig } from '../contexts/ConfigContext.js';
import { ContextSummaryDisplay } from './ContextSummaryDisplay.js';

export interface StatusDisplayProps {
  hideContextSummary: boolean;
}

export const StatusDisplay: React.FC<StatusDisplayProps> = ({ hideContextSummary }) => {
  const uiState = useUIState();
  const settings = useSettings();
  const config = useConfig();

  if (process.env['HIVE_SYSTEM_MD'] || process.env['GEMINI_SYSTEM_MD']) {
    return <Text color={theme.status.error}>|⌐■_■|</Text>;
  }

  const uiSettings = settings.merged.ui as { hideContextSummary?: boolean };
  const mcpManager = config.getMcpClientManager() as unknown as
    | {
        getMcpServers?: () => Parameters<typeof ContextSummaryDisplay>[0]['mcpServers'];
        getBlockedMcpServers?: () => string[];
      }
    | undefined;

  if (!uiSettings.hideContextSummary && !hideContextSummary) {
    return (
      <ContextSummaryDisplay
        ideContext={uiState.ideContextState}
        hiveMdFileCount={uiState.hiveMdFileCount}
        contextFileNames={uiState.contextFileNames}
        mcpServers={mcpManager?.getMcpServers?.() ?? {}}
        blockedMcpServers={(mcpManager?.getBlockedMcpServers?.() ?? []).map((name: string) => ({
          name,
          extensionName: '',
        }))}
        skillCount={config.getSkillManager().getDisplayableSkills().length}
        backgroundProcessCount={uiState.backgroundTaskCount}
      />
    );
  }

  return null;
};
