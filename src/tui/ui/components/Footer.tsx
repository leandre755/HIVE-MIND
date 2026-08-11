/**
 * @license
 * Copyright 2026 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { checkExhaustive } from '../../utils/errors.js';
import { shortenPath, tildeifyPath } from '../utils/formatters.js';
import { getDisplayString, useUIState } from '../contexts/UIStateContext.js';
import { ConsoleSummaryDisplay } from './ConsoleSummaryDisplay.js';
import process from 'node:process';
import os from 'node:os';
import { MemoryUsageDisplay } from './MemoryUsageDisplay.js';
import { ContextUsageDisplay } from './ContextUsageDisplay.js';

import { useConfig } from '../contexts/ConfigContext.js';
import { useSettings } from '../contexts/SettingsContext.js';
import { useVimMode } from '../contexts/VimModeContext.js';
import { useInputState } from '../contexts/InputContext.js';
import {
  ALL_ITEMS,
  type FooterItemId,
  deriveItemsFromLegacySettings,
} from '../../config/footerItems.js';
const isDevelopment = process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true';

const HOSTNAME = os.hostname();

interface CwdIndicatorProps {
  targetDir: string;
  maxWidth: number;
  debugMode?: boolean;
  debugMessage?: string;
  color?: string;
}

const CwdIndicator: React.FC<CwdIndicatorProps> = ({
  targetDir,
  maxWidth,
  debugMode,
  debugMessage,
  color = theme.text.primary,
}) => {
  const debugSuffix = debugMode ? ' ' + (debugMessage || '--debug') : '';
  const availableForPath = Math.max(10, maxWidth - debugSuffix.length);
  const displayPath = shortenPath(tildeifyPath(targetDir), availableForPath);

  return (
    <Text color={color}>
      {displayPath}
      {debugMode && <Text color={theme.status.error}>{debugSuffix}</Text>}
    </Text>
  );
};

interface SandboxIndicatorProps {
  isTrustedFolder: boolean | undefined;
}

const SandboxIndicator: React.FC<SandboxIndicatorProps> = ({ isTrustedFolder }) => {
  const config = useConfig();
  const sandboxEnabled = config.getSandboxEnabled();
  if (isTrustedFolder === false) {
    return <Text color={theme.status.warning}>untrusted</Text>;
  }

  const sandbox = process.env['SANDBOX'];
  if (sandbox) {
    return <Text color={theme.status.warning}>current process</Text>;
  }

  if (sandboxEnabled) {
    return <Text color={theme.status.warning}>all tools</Text>;
  }

  return <Text color={theme.status.error}>no sandbox</Text>;
};

const CorgiIndicator: React.FC = () => (
  <Text>
    <Text color={theme.status.error}>▼</Text>
    <Text color={theme.text.primary}>(´</Text>
    <Text color={theme.status.error}>ᴥ</Text>
    <Text color={theme.text.primary}>`)</Text>
    <Text color={theme.status.error}>▼</Text>
  </Text>
);

export interface FooterRowItem {
  key: string;
  header: string;
  element: React.ReactNode;
  flexGrow?: number;
  flexShrink?: number;
  isFocused?: boolean;
  alignItems?: 'flex-start' | 'center' | 'flex-end';
}

const COLUMN_GAP = 3;

export const FooterRow: React.FC<{
  items: FooterRowItem[];
  showLabels: boolean;
}> = ({ items, showLabels }) => {
  const elements: React.ReactNode[] = [];

  items.forEach((item, idx) => {
    if (idx > 0) {
      elements.push(
        <Box
          key={`sep-${item.key}`}
          flexGrow={1}
          flexShrink={1}
          minWidth={showLabels ? COLUMN_GAP : 3}
          justifyContent="center"
          alignItems="center"
        >
          {!showLabels && <Text color={theme.ui.comment}> · </Text>}
        </Box>,
      );
    }

    elements.push(
      <Box
        key={item.key}
        flexDirection="column"
        flexGrow={item.flexGrow ?? 0}
        flexShrink={item.flexShrink ?? 1}
        alignItems={item.alignItems}
        backgroundColor={item.isFocused ? theme.background.focus : undefined}
      >
        {showLabels && (
          <Box height={1}>
            <Text color={item.isFocused ? theme.text.primary : theme.ui.comment}>
              {item.header}
            </Text>
          </Box>
        )}
        <Box height={1}>{item.element}</Box>
      </Box>,
    );
  });

  return (
    <Box flexDirection="row" flexWrap="nowrap" width="100%">
      {elements}
    </Box>
  );
};

function isFooterItemId(id: string): id is FooterItemId {
  return ALL_ITEMS.some((i) => i.id === id);
}

interface FooterColumn {
  id: string;
  header: string;
  element: (maxWidth: number) => React.ReactNode;
  width: number;
  isHighPriority: boolean;
}

function addFooterItemColumns(
  id: FooterItemId,
  header: string,
  addFn: (
    colId: FooterItemId,
    colHeader: string,
    element: (maxWidth: number) => React.ReactNode,
    dataWidth: number,
    isHighPriority?: boolean,
  ) => void,
  ctx: {
    targetDir: string;
    debugMode: boolean;
    debugMessage: string;
    branchName: string;
    model: string;
    promptTokenCount: number;
    isTrustedFolder: boolean | undefined;
    terminalWidth: number;
    uiState: ReturnType<typeof useUIState>;
    config: ReturnType<typeof useConfig>;
    settings: ReturnType<typeof useSettings>;
    itemColor: string;
    copyModeEnabled: boolean;
  },
) {
  const {
    targetDir,
    debugMode,
    debugMessage,
    branchName,
    model,
    promptTokenCount,
    isTrustedFolder,
    terminalWidth,
    uiState,
    config,
    itemColor,
    copyModeEnabled,
  } = ctx;
  switch (id) {
    case 'workspace': {
      const fullPath = tildeifyPath(targetDir);
      const debugSuffix = debugMode ? ' ' + (debugMessage || '--debug') : '';
      addFn(
        id,
        header,
        (maxWidth) => (
          <CwdIndicator
            targetDir={targetDir}
            maxWidth={maxWidth}
            debugMode={debugMode}
            debugMessage={debugMessage}
            color={itemColor}
          />
        ),
        fullPath.length + debugSuffix.length,
      );
      break;
    }
    case 'git-branch':
      if (branchName)
        addFn(id, header, () => <Text color={itemColor}>{branchName}</Text>, branchName.length);
      break;
    case 'sandbox': {
      let str = 'no sandbox';
      const sandbox = process.env['SANDBOX'];
      if (isTrustedFolder === false) str = 'untrusted';
      else if (sandbox) str = 'current process';
      else if (config.getSandboxEnabled()) str = 'all tools';
      addFn(id, header, () => <SandboxIndicator isTrustedFolder={isTrustedFolder} />, str.length);
      break;
    }
    case 'model-name': {
      const str = getDisplayString(model);
      addFn(id, header, () => <Text color={itemColor}>{str}</Text>, str.length);
      break;
    }
    case 'context-used':
      addFn(
        id,
        header,
        () => (
          <ContextUsageDisplay
            promptTokenCount={promptTokenCount}
            model={model}
            terminalWidth={terminalWidth}
          />
        ),
        10,
      );
      break;
    case 'memory-usage':
      addFn(
        id,
        header,
        () => <MemoryUsageDisplay color={itemColor} isActive={!copyModeEnabled} />,
        10,
      );
      break;
    case 'session-id':
      addFn(
        id,
        header,
        () => <Text color={itemColor}>{uiState.sessionStats.sessionId.slice(0, 8)}</Text>,
        8,
      );
      break;
    case 'hostname':
      addFn(id, header, () => <Text color={itemColor}>{HOSTNAME}</Text>, HOSTNAME.length);
      break;
    case 'code-changes': {
      const added = uiState.sessionStats.metrics.files?.totalLinesAdded ?? 0;
      const removed = uiState.sessionStats.metrics.files?.totalLinesRemoved ?? 0;
      if (added > 0 || removed > 0)
        addFn(
          id,
          header,
          () => (
            <Text>
              <Text color={theme.status.success}>+{added}</Text>{' '}
              <Text color={theme.status.error}>-{removed}</Text>
            </Text>
          ),
          `+${added} -${removed}`.length,
        );
      break;
    }
    case 'token-count': {
      let total = 0;
      for (const m of uiState.sessionStats.metrics.models) total += m.totalTokens;
      if (total > 0) {
        const formatter = new Intl.NumberFormat('en-US', {
          notation: 'compact',
          maximumFractionDigits: 1,
        });
        const formatted = formatter.format(total).toLowerCase();
        addFn(
          id,
          header,
          () => <Text color={itemColor}>{formatted} tokens</Text>,
          formatted.length + 7,
        );
      }
      break;
    }
    case 'quota':
      break;
    default:
      checkExhaustive(id);
      break;
  }
}

function buildFooterColumns(
  uiState: ReturnType<typeof useUIState>,
  config: ReturnType<typeof useConfig>,
  settings: ReturnType<typeof useSettings>,
  copyModeEnabled: boolean,
  showLabels: boolean,
  itemColor: string,
  displayVimMode: string | undefined,
  showErrorSummary: boolean,
  corgiMode: boolean,
  errorCount: number,
  targetDir: string,
  debugMode: boolean,
  debugMessage: string,
  branchName: string,
  model: string,
  promptTokenCount: number,
  isTrustedFolder: boolean | undefined,
  terminalWidth: number,
  items: string[],
): FooterColumn[] {
  const potentialColumns: FooterColumn[] = [];
  const addCol = (
    colId: FooterItemId | string,
    header: string,
    element: (maxWidth: number) => React.ReactNode,
    dataWidth: number,
    isHighPriority?: boolean,
  ) => {
    potentialColumns.push({
      id: colId,
      header,
      element,
      width: dataWidth,
      isHighPriority: isHighPriority ?? false,
    });
  };

  if (displayVimMode) {
    addCol(
      'vim-mode',
      'vim',
      () => (
        <Text color={theme.text.secondary} bold>
          [{displayVimMode.toUpperCase()}]
        </Text>
      ),
      displayVimMode.length + 2,
      true,
    );
  }

  const addFn = (
    itemId: FooterItemId,
    itemHeader: string,
    element: (maxWidth: number) => React.ReactNode,
    dataWidth: number,
    isHighPriority?: boolean,
  ) => {
    addCol(itemId, itemHeader, element, dataWidth, isHighPriority);
  };

  const ctx = {
    targetDir,
    debugMode,
    debugMessage,
    branchName,
    model,
    promptTokenCount,
    isTrustedFolder,
    terminalWidth,
    uiState,
    config,
    settings,
    itemColor,
    copyModeEnabled,
  };

  for (const itemId of items) {
    if (isFooterItemId(itemId)) {
      const definition = ALL_ITEMS.find((i) => i.id === itemId);
      if (definition) {
        const header = showLabels ? definition.header : '';
        addFooterItemColumns(itemId, header, addFn, ctx);
      }
    }
  }

  if (corgiMode) addCol('corgi', '', () => <CorgiIndicator />, 5);
  if (showErrorSummary)
    addCol('error-count', '', () => <ConsoleSummaryDisplay errorCount={errorCount} />, 12, true);

  // Claude Code style: permanent shortcuts hint pinned at the end of the footer line
  const uiSettings = settings.merged.ui as unknown as { showShortcutsHint?: boolean };
  const showShortcutsHint = uiSettings.showShortcutsHint ?? true;
  if (showShortcutsHint) {
    const hint = '? for shortcuts';
    addCol(
      'shortcuts-hint',
      '',
      () => (
        <Text color={uiState.shortcutsHelpVisible ? theme.text.accent : itemColor}>{hint}</Text>
      ),
      hint.length,
      true,
    );
  }

  return potentialColumns;
}

export const Footer: React.FC = () => {
  const uiState = useUIState();
  const { copyModeEnabled } = useInputState();
  const config = useConfig();
  const settings = useSettings();
  const { vimEnabled, vimMode } = useVimMode();

  const {
    model,
    targetDir,
    debugMode,
    branchName,
    debugMessage,
    corgiMode,
    errorCount,
    showErrorDetails,
    promptTokenCount,
    isTrustedFolder,
    terminalWidth,
  } = {
    model: uiState.currentModel,
    targetDir: config.getTargetDir(),
    debugMode: config.getDebugMode(),
    branchName: uiState.branchName,
    debugMessage: uiState.debugMessage,
    corgiMode: uiState.corgiMode,
    errorCount: uiState.errorCount,
    showErrorDetails: uiState.showErrorDetails,
    promptTokenCount: uiState.sessionStats.lastPromptTokenCount,
    isTrustedFolder: uiState.isTrustedFolder,
    terminalWidth: uiState.terminalWidth,
  };

  const isFullErrorVerbosity = settings.merged.ui.errorVerbosity === 'full';
  const showErrorSummary =
    !showErrorDetails && errorCount > 0 && (isFullErrorVerbosity || debugMode || isDevelopment);
  const displayVimMode = vimEnabled ? vimMode : undefined;

  const items = settings.merged.ui.footer.items ?? deriveItemsFromLegacySettings(settings.merged);
  const showLabels = settings.merged.ui.footer.showLabels !== false;
  const itemColor = showLabels ? theme.text.primary : theme.ui.comment;

  const potentialColumns = buildFooterColumns(
    uiState,
    config,
    settings,
    !!copyModeEnabled,
    showLabels,
    itemColor,
    displayVimMode,
    showErrorSummary,
    corgiMode,
    errorCount,
    targetDir || '',
    debugMode,
    debugMessage || '',
    branchName || '',
    model || '',
    promptTokenCount,
    isTrustedFolder,
    terminalWidth,
    items || [],
  );

  const computeRowItems = (): { rowItems: FooterRowItem[]; droppedAny: boolean } => {
    const columnsToRender: FooterColumn[] = [];
    let droppedAny = false;
    let currentUsedWidth = 2;
    const defaultGap = showLabels ? COLUMN_GAP : 3;
    for (const col of potentialColumns) {
      const gap = columnsToRender.length > 0 ? defaultGap : 0;
      const budgetWidth = col.id === 'workspace' ? 20 : col.width;
      if (col.isHighPriority || currentUsedWidth + gap + budgetWidth <= terminalWidth - 2) {
        columnsToRender.push(col);
        currentUsedWidth += gap + budgetWidth;
      } else {
        droppedAny = true;
      }
    }
    const rowItems: FooterRowItem[] = columnsToRender.map((col, index) => {
      const isWorkspace = col.id === 'workspace';
      const isLast = index === columnsToRender.length - 1;
      const otherItemsWidth = columnsToRender
        .filter((c) => c.id !== 'workspace')
        .reduce((sum, c) => sum + c.width, 0);
      const numItems = columnsToRender.length + (droppedAny ? 1 : 0);
      const gapsWidth = (numItems > 1 ? numItems - 1 : 0) * defaultGap;
      const availableForWorkspace = Math.max(
        20,
        terminalWidth - 2 - gapsWidth - otherItemsWidth - (droppedAny ? 1 : 0),
      );
      let alignItems: 'flex-start' | 'center' | 'flex-end' = 'flex-start';
      if (isLast && !droppedAny && index > 0) {
        alignItems = 'flex-end';
      }
      return {
        key: col.id,
        header: col.header,
        element: col.element(isWorkspace ? availableForWorkspace : col.width),
        flexGrow: 0,
        flexShrink: isWorkspace ? 1 : 0,
        alignItems,
      };
    });
    if (droppedAny)
      rowItems.push({
        key: 'ellipsis',
        header: '',
        element: <Text color={theme.ui.comment}>…</Text>,
        flexGrow: 0,
        flexShrink: 0,
        alignItems: 'flex-end',
      });
    return { rowItems, droppedAny };
  };

  const { rowItems } = computeRowItems();

  return (
    <Box width={terminalWidth} paddingX={1} overflow="hidden" flexWrap="nowrap">
      <FooterRow items={rowItems} showLabels={showLabels} />
    </Box>
  );
};
