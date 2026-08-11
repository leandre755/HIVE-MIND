/**
 * @license
 * Copyright 2026 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { escapeAnsiCtrlCodes } from '../utils/textUtils.js';
import { HistoryItem, SlashCommand, getMCPServerStatus } from '../contexts/UIStateContext.js';
import { UserMessage } from './messages/UserMessage.js';
import { UserShellMessage } from './messages/UserShellMessage.js';
import { AssistantMessage } from './messages/AssistantMessage.js';

import { InfoMessage } from './messages/InfoMessage.js';
import { ErrorMessage } from './messages/ErrorMessage.js';
import { ToolGroupMessage } from './messages/ToolGroupMessage.js';
import { ToolGroupDisplay } from './messages/ToolGroupDisplay.js';
import { AssistantMessageContent } from './messages/AssistantMessageContent.js';
import { CompressionMessage } from './messages/CompressionMessage.js';
import { ExportSessionMessage } from './messages/ExportSessionMessage.js';
import { WarningMessage } from './messages/WarningMessage.js';
import { SubagentHistoryMessage } from './messages/SubagentHistoryMessage.js';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { AboutBox } from './AboutBox.js';
import { StatsDisplay } from './StatsDisplay.js';
import { ModelStatsDisplay } from './ModelStatsDisplay.js';
import { ToolStatsDisplay } from './ToolStatsDisplay.js';
import { SessionSummaryDisplay } from './SessionSummaryDisplay.js';
import { Help } from './Help.js';
import { ToolsList } from './views/ToolsList.js';
import { SkillsList } from './views/SkillsList.js';
import { AgentsStatus } from './views/AgentsStatus.js';
import { McpStatus } from './views/McpStatus.js';
import { GemmaStatus } from './views/GemmaStatus.js';
import { ChatList } from './views/ChatList.js';
import { ModelMessage } from './messages/ModelMessage.js';
import { ThinkingMessage } from './messages/ThinkingMessage.js';
import { HintMessage } from './messages/HintMessage.js';
import { getInlineThinkingMode } from '../utils/inlineThinkingMode.js';
import { useSettings } from '../contexts/SettingsContext.js';

interface HistoryItemDisplayProps {
  item: HistoryItem;
  availableTerminalHeight?: number;
  terminalWidth: number;
  isPending: boolean;
  commands?: readonly SlashCommand[];
  availableTerminalHeightHive?: number;
  isExpandable?: boolean;
  isFirstThinking?: boolean;
  isFirstAfterThinking?: boolean;
  isToolGroupBoundary?: boolean;
}

const renderHistoryItemByType = (
  itemForDisplay: Record<string, unknown>,
  isPending: boolean,
  terminalWidth: number,
  availableTerminalHeight: number | undefined,
  availableTerminalHeightHive: number | undefined,
  commands: readonly SlashCommand[] | undefined,
  isExpandable: boolean | undefined,
  isFirstThinking: boolean,
  inlineThinkingMode: string,
  isToolGroupBoundary: boolean,
): React.ReactNode => {
  const hiveHeight = availableTerminalHeightHive ?? availableTerminalHeight;
  switch (itemForDisplay.type) {
    case 'thinking':
      return inlineThinkingMode !== 'off' ? (
        <ThinkingMessage
          thought={
            itemForDisplay.thought as unknown as Parameters<typeof ThinkingMessage>[0]['thought']
          }
          terminalWidth={terminalWidth}
          isFirstThinking={isFirstThinking}
        />
      ) : null;
    case 'hint':
      return <HintMessage text={itemForDisplay.text as string} />;
    case 'user':
      return <UserMessage text={itemForDisplay.text as string} width={terminalWidth} />;
    case 'user_shell':
      return <UserShellMessage text={itemForDisplay.text as string} width={terminalWidth} />;
    case 'assistant':
      return (
        <AssistantMessage
          text={itemForDisplay.text as string}
          isPending={isPending}
          availableTerminalHeight={hiveHeight}
          terminalWidth={terminalWidth}
        />
      );
    case 'assistant_content':
      return (
        <AssistantMessageContent
          text={itemForDisplay.text as string}
          isPending={isPending}
          availableTerminalHeight={hiveHeight}
          terminalWidth={terminalWidth}
        />
      );
    case 'info':
      return (
        <InfoMessage
          text={itemForDisplay.text as string}
          secondaryText={itemForDisplay.secondaryText as string | undefined}
          source={itemForDisplay.source as string | undefined}
          icon={itemForDisplay.icon as string | undefined}
          color={itemForDisplay.color as string | undefined}
          marginBottom={itemForDisplay.marginBottom as number | undefined}
        />
      );
    case 'warning':
      return <WarningMessage text={itemForDisplay.text as string} />;
    case 'error':
      return <ErrorMessage text={itemForDisplay.text as string} />;
    case 'about':
      return (
        <AboutBox
          cliVersion={itemForDisplay.cliVersion as string}
          osVersion={itemForDisplay.osVersion as string}
          sandboxEnv={itemForDisplay.sandboxEnv as string}
          modelVersion={itemForDisplay.modelVersion as string}
          selectedAuthType={itemForDisplay.selectedAuthType as string}
          gcpProject={itemForDisplay.gcpProject as string | undefined}
          ideClient={itemForDisplay.ideClient as Parameters<typeof AboutBox>[0]['ideClient']}
          userEmail={itemForDisplay.userEmail as string | undefined}
        />
      );
    case 'help':
      return commands ? <Help commands={commands} /> : null;
    case 'stats':
      return <StatsDisplay duration={String(itemForDisplay.duration ?? '')} />;
    case 'model_stats':
      return <ModelStatsDisplay currentModel={itemForDisplay.currentModel as string} />;
    case 'tool_stats':
      return <ToolStatsDisplay />;
    case 'model':
      return <ModelMessage model={itemForDisplay.model as string} />;
    case 'quit':
      return <SessionSummaryDisplay duration={String(itemForDisplay.duration ?? '')} />;
    default:
      return renderHistoryItemByType2(
        itemForDisplay,
        terminalWidth,
        availableTerminalHeight,
        isExpandable,
        isToolGroupBoundary,
        false,
        hiveHeight,
        inlineThinkingMode,
        isFirstThinking ?? false,
        isPending,
      );
  }
};

const renderHistoryItemByType2 = (
  itemForDisplay: Record<string, unknown>,
  terminalWidth: number,
  availableTerminalHeight: number | undefined,
  isExpandable: boolean | undefined,
  isToolGroupBoundary: boolean,
  _constrainHeight: boolean,
  _hiveHeight: number | undefined,
  inlineThinkingMode: string,
  isFirstThinking: boolean,
  isPending: boolean,
): React.ReactNode => {
  switch (itemForDisplay.type) {
    case 'thinking':
      return inlineThinkingMode !== 'off' ? (
        <ThinkingMessage
          thought={
            itemForDisplay.thought as unknown as Parameters<typeof ThinkingMessage>[0]['thought']
          }
          terminalWidth={terminalWidth}
          isFirstThinking={isFirstThinking}
        />
      ) : null;
    case 'hint':
      return <HintMessage text={itemForDisplay.text as string} />;
    case 'user':
      return <UserMessage text={itemForDisplay.text as string} width={terminalWidth} />;
    case 'user_shell':
    case 'background_shell':
      return (
        <UserShellMessage
          text={(itemForDisplay.command || itemForDisplay.text || '') as string}
          width={terminalWidth}
        />
      );
    case 'info':
      return <InfoMessage text={itemForDisplay.text as string} />;
    case 'assistant':
      return (
        <AssistantMessage
          text={itemForDisplay.text as string}
          terminalWidth={terminalWidth}
          availableTerminalHeight={availableTerminalHeight}
          isPending={isPending}
        />
      );
    case 'tool_group':
      return (
        <ToolGroupMessage
          item={itemForDisplay as unknown as Parameters<typeof ToolGroupMessage>[0]['item']}
          toolCalls={
            itemForDisplay.tools as unknown as Parameters<typeof ToolGroupMessage>[0]['toolCalls']
          }
          availableTerminalHeight={availableTerminalHeight}
          terminalWidth={terminalWidth}
          borderTop={Boolean(itemForDisplay.borderTop)}
          borderBottom={Boolean(itemForDisplay.borderBottom)}
          isExpandable={isExpandable}
        />
      );
    case 'tool_display_group':
      return (
        <ToolGroupDisplay
          item={itemForDisplay as unknown as Parameters<typeof ToolGroupDisplay>[0]['item']}
          isToolGroupBoundary={isToolGroupBoundary}
        />
      );
    case 'subagent':
      return (
        <SubagentHistoryMessage
          item={itemForDisplay as unknown as Parameters<typeof SubagentHistoryMessage>[0]['item']}
          terminalWidth={terminalWidth}
        />
      );
    case 'compression':
      return (
        <CompressionMessage
          compression={
            itemForDisplay.compression as unknown as Parameters<
              typeof CompressionMessage
            >[0]['compression']
          }
        />
      );
    case 'export_session':
      return (
        <ExportSessionMessage
          exportSession={
            itemForDisplay.exportSession as unknown as Parameters<
              typeof ExportSessionMessage
            >[0]['exportSession']
          }
        />
      );
    case 'extensions_list':
      return <Text color={theme.text.secondary}>Extensions are not supported in HIVE-MIND.</Text>;
    case 'tools_list':
      return (
        <ToolsList
          terminalWidth={terminalWidth}
          tools={itemForDisplay.tools as unknown as Parameters<typeof ToolsList>[0]['tools']}
          showDescriptions={Boolean(itemForDisplay.showDescriptions)}
        />
      );
    case 'skills_list':
      return (
        <SkillsList
          skills={itemForDisplay.skills as unknown as Parameters<typeof SkillsList>[0]['skills']}
          showDescriptions={Boolean(itemForDisplay.showDescriptions)}
        />
      );
    case 'agents_list':
      return (
        <AgentsStatus
          agents={itemForDisplay.agents as unknown as Parameters<typeof AgentsStatus>[0]['agents']}
          terminalWidth={terminalWidth}
        />
      );
    case 'mcp_status':
      return (
        <McpStatus
          {...(itemForDisplay as unknown as Parameters<typeof McpStatus>[0])}
          serverStatus={
            getMCPServerStatus as unknown as Parameters<typeof McpStatus>[0]['serverStatus']
          }
        />
      );
    case 'gemma_status':
      return <GemmaStatus {...(itemForDisplay as unknown as Parameters<typeof GemmaStatus>[0])} />;
    case 'chat_list':
      return (
        <ChatList
          chats={itemForDisplay.chats as unknown as Parameters<typeof ChatList>[0]['chats']}
        />
      );
    default:
      return null;
  }
};

export const HistoryItemDisplay: React.FC<HistoryItemDisplayProps> = ({
  item,
  availableTerminalHeight,
  terminalWidth,
  isPending,
  commands,
  availableTerminalHeightHive,
  isExpandable,
  isFirstThinking = false,
  isFirstAfterThinking = false,
  isToolGroupBoundary = false,
}) => {
  const settings = useSettings();
  const inlineThinkingMode = getInlineThinkingMode(settings);
  const itemForDisplay = useMemo(() => escapeAnsiCtrlCodes(item), [item]);

  const needTopMargin = !!(
    (isFirstAfterThinking && inlineThinkingMode !== 'off') ||
    isToolGroupBoundary
  );

  return (
    <Box
      flexDirection="column"
      key={itemForDisplay.id}
      width={terminalWidth}
      marginTop={needTopMargin ? 1 : 0}
    >
      {renderHistoryItemByType(
        itemForDisplay,
        isPending,
        terminalWidth,
        availableTerminalHeight,
        availableTerminalHeightHive,
        commands,
        isExpandable,
        isFirstThinking,
        inlineThinkingMode,
        isToolGroupBoundary,
      )}
    </Box>
  );
};
