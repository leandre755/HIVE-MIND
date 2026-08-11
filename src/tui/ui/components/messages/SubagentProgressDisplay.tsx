import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../../semantic-colors.js';
import { safeJsonToMarkdown, SubagentState } from '../../contexts/UIStateContext.js';
import Spinner from 'ink-spinner';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { TOOL_STATUS } from '../../constants.js';
import { STATUS_INDICATOR_WIDTH } from './ToolShared.js';

export interface SubagentProgressDisplayProps {
  progress?: SubagentProgress;
  terminalWidth: number;
  historyOverrides?: SubagentActivityItem[];
}

function findKnownArg(parsed: Record<string, unknown>): string | undefined {
  if (typeof parsed['description'] === 'string' && parsed['description'])
    return parsed['description'];
  if (typeof parsed['command'] === 'string') return parsed['command'];
  if (typeof parsed['file_path'] === 'string') return parsed['file_path'];
  if (typeof parsed['dir_path'] === 'string') return parsed['dir_path'];
  if (typeof parsed['query'] === 'string') return parsed['query'];
  if (typeof parsed['url'] === 'string') return parsed['url'];
  if (typeof parsed['target'] === 'string') return parsed['target'];
  return undefined;
}

export const formatToolArgs = (args?: string): string => {
  if (!args) return '';
  try {
    const parsed: unknown = JSON.parse(args);
    if (typeof parsed !== 'object' || parsed === null) {
      return args;
    }

    const record = parsed as Record<string, unknown>;
    const known = findKnownArg(record);
    if (known !== undefined) return known;

    return Object.entries(record)
      .map(([key, val]) => `${key}: ${JSON.stringify(val)}`)
      .join(', ');
  } catch {
    return args;
  }
};

function renderToolStatusIcon(status?: SubagentState | string): React.ReactNode {
  if (status === SubagentState.RUNNING) {
    return (
      <Text color={theme.status.warning}>
        <Spinner type="dots" />
      </Text>
    );
  }
  if (status === SubagentState.COMPLETED) {
    return <Text color={theme.status.success}>{TOOL_STATUS.SUCCESS}</Text>;
  }
  if (status === SubagentState.CANCELLED) {
    return <Text color={theme.status.warning}>{TOOL_STATUS.ERROR}</Text>;
  }
  return <Text color={theme.status.error}>{TOOL_STATUS.ERROR}</Text>;
}

export const SubagentProgressDisplay: React.FC<SubagentProgressDisplayProps> = ({
  progress,
  terminalWidth: _terminalWidth,
  historyOverrides,
}) => {
  if (!progress && !historyOverrides) return null;

  const agentName =
    typeof progress === 'object' && progress && 'agentName' in progress
      ? progress.agentName
      : undefined;
  const recentActivity =
    typeof progress === 'object' &&
    progress &&
    'recentActivity' in progress &&
    Array.isArray(progress.recentActivity)
      ? progress.recentActivity
      : [];

  const activityList = historyOverrides ?? recentActivity;
  const headerText = agentName ? `Subagent: ${agentName}` : 'Subagent Activity';
  const headerColor = theme.text.primary;

  const subagentObj =
    typeof progress === 'object' && progress
      ? (progress as { result?: unknown; terminateReason?: unknown; state?: unknown })
      : undefined;

  return (
    <Box flexDirection="column" gap={0}>
      {headerText && (
        <Box marginBottom={1}>
          <Text color={headerColor} italic>
            {headerText}
          </Text>
        </Box>
      )}
      <Box flexDirection="column" marginLeft={0} gap={0}>
        {activityList.map((item: SubagentActivityItem) => {
          if (item.type === 'thought') {
            const isCancellation = item.content === 'Request cancelled.';
            const icon = isCancellation ? 'ℹ ' : '💭';
            const color = isCancellation ? theme.status.warning : theme.text.secondary;

            return (
              <Box key={item.id} flexDirection="row">
                <Box minWidth={STATUS_INDICATOR_WIDTH}>
                  <Text color={color}>{icon}</Text>
                </Box>
                <Box flexGrow={1}>
                  <Text color={color} italic>
                    {item.description || item.content}
                  </Text>
                </Box>
              </Box>
            );
          } else if (item.type === 'tool') {
            return (
              <Box key={item.id} flexDirection="column">
                <Box flexDirection="row">
                  <Box minWidth={STATUS_INDICATOR_WIDTH}>{renderToolStatusIcon(item.status)}</Box>
                  <Box flexGrow={1} flexDirection="row" gap={1}>
                    <Text bold color={theme.text.primary}>
                      {item.displayName || item.description}
                    </Text>
                    {item.args && (
                      <Text
                        color={theme.text.secondary}
                        dimColor
                        strikethrough={item.status === SubagentState.CANCELLED}
                      >
                        {formatToolArgs(item.args)}
                      </Text>
                    )}
                  </Box>
                </Box>

                {item.content && (
                  <Box marginLeft={STATUS_INDICATOR_WIDTH} marginTop={0}>
                    <Text
                      color={theme.text.secondary}
                      dimColor
                      strikethrough={item.status === SubagentState.CANCELLED}
                    >
                      {item.content}
                    </Text>
                  </Box>
                )}
              </Box>
            );
          }
          return null;
        })}
      </Box>

      {Boolean(subagentObj?.result) && (
        <Box flexDirection="column" marginTop={1}>
          {Boolean(subagentObj?.terminateReason) && subagentObj?.terminateReason !== 'GOAL' && (
            <Box marginBottom={1}>
              <Text color={theme.status.warning} bold>
                Agent Finished Early ({String(subagentObj?.terminateReason)})
              </Text>
            </Box>
          )}
          <MarkdownDisplay
            text={safeJsonToMarkdown(subagentObj?.result)}
            isPending={subagentObj?.state !== SubagentState.COMPLETED}
            terminalWidth={_terminalWidth}
          />
        </Box>
      )}
    </Box>
  );
};
