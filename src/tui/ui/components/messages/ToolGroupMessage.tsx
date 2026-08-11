import React, { Fragment, useMemo } from 'react';
import { Box, Text } from 'ink';
import { ToolMessage } from './ToolMessage.js';
import { ShellToolMessage } from './ShellToolMessage.js';
import { TopicMessage, isTopicTool } from './TopicMessage.js';
import { SubagentGroupDisplay } from './SubagentGroupDisplay.js';
import { DenseToolMessage } from './DenseToolMessage.js';
import { theme } from '../../semantic-colors.js';
import { useConfig } from '../../contexts/ConfigContext.js';
import { isShellTool } from './ToolShared.js';
import {
  Kind,
  IndividualToolCallDisplay,
  mapCoreStatusToDisplayStatus,
  CoreToolCallStatus,
  isVisibleInToolGroup,
  EDIT_DISPLAY_NAME,
  GLOB_DISPLAY_NAME,
  WEB_SEARCH_DISPLAY_NAME,
  READ_FILE_DISPLAY_NAME,
  LS_DISPLAY_NAME,
  GREP_DISPLAY_NAME,
  WEB_FETCH_DISPLAY_NAME,
  WRITE_FILE_DISPLAY_NAME,
  READ_MANY_FILES_DISPLAY_NAME,
  isFileDiff,
  useUIState,
} from '../../contexts/UIStateContext.js';
import { buildToolVisibilityContextFromDisplay } from '../../utils/historyUtils.js';
import { getToolGroupBorderAppearance } from '../../utils/borderStyles.js';
import { useSettings } from '../../contexts/SettingsContext.js';
import {
  TOOL_RESULT_STATIC_HEIGHT,
  TOOL_RESULT_STANDARD_RESERVED_LINE_COUNT,
} from '../../utils/toolLayoutUtils.js';

const COMPACT_OUTPUT_ALLOWLIST = new Set([
  EDIT_DISPLAY_NAME,
  GLOB_DISPLAY_NAME,
  WEB_SEARCH_DISPLAY_NAME,
  READ_FILE_DISPLAY_NAME,
  LS_DISPLAY_NAME,
  GREP_DISPLAY_NAME,
  WEB_FETCH_DISPLAY_NAME,
  WRITE_FILE_DISPLAY_NAME,
  READ_MANY_FILES_DISPLAY_NAME,
]);

// Helper to identify if a tool should use the compact view
export const isCompactTool = (
  tool: IndividualToolCallDisplay,
  isCompactModeEnabled: boolean,
): boolean => {
  const hasCompactOutputSupport = COMPACT_OUTPUT_ALLOWLIST.has(tool.name);
  const displayStatus = mapCoreStatusToDisplayStatus(tool.status);
  return (
    isCompactModeEnabled &&
    hasCompactOutputSupport &&
    displayStatus !== CoreToolCallStatus.Confirming
  );
};

// Helper to identify if a compact tool has a payload (diff, list, etc.)
export const hasDensePayload = (tool: IndividualToolCallDisplay): boolean => {
  if (tool.outputFile) return true;
  const res = tool.resultDisplay;
  if (!res) return false;

  // Usage of type guards makes this class too aware of internals
  if (isFileDiff(res)) return true;
  if (tool.confirmationDetails?.type === 'edit') return true;

  // Generic summary/payload pattern
  if (typeof res === 'object' && res !== null && 'summary' in res && 'payload' in res) {
    return true;
  }

  return false;
};

interface ToolGroupMessageProps {
  item: HistoryItem | HistoryItemWithoutId;
  toolCalls: IndividualToolCallDisplay[];
  availableTerminalHeight?: number;
  terminalWidth: number;
  onShellInputSubmit?: (input: string) => void;
  borderTop?: boolean;
  borderBottom?: boolean;
  isExpandable?: boolean;
}

const TOOL_MESSAGE_HORIZONTAL_MARGIN = 4;

type GroupItem = IndividualToolCallDisplay | IndividualToolCallDisplay[];

function isGroupFirst(
  groupedTools: GroupItem[],
  index: number,
  borderTopOverride: boolean | undefined,
): boolean {
  if (index === 0) return !!(borderTopOverride ?? true);
  for (let j = 0; j < index; j++) {
    const prev = groupedTools.at(j);
    if (!prev || Array.isArray(prev) || !isTopicTool(prev.name)) return false;
  }
  return true;
}

function calculateSingleGroupLines(
  group: GroupItem,
  isCompact: boolean,
  isTopicToolCall: boolean,
  isFirstProp: boolean,
  showClosingBorder: boolean,
): number {
  if (Array.isArray(group)) {
    return (isFirstProp ? 1 : 0) + 1 + group.length + (showClosingBorder ? 1 : 0);
  }
  if (isTopicToolCall) {
    return 2 + (showClosingBorder ? 1 : 0);
  }
  if (isCompact) {
    return 1;
  }
  return (
    TOOL_RESULT_STANDARD_RESERVED_LINE_COUNT -
    1 +
    TOOL_RESULT_STATIC_HEIGHT +
    (group.outputFile ? 1 : 0) +
    (showClosingBorder ? 1 : 0)
  );
}

function calculateGroupHeight(
  group: GroupItem,
  index: number,
  groupedTools: GroupItem[],
  isCompactModeEnabled: boolean,
  borderTopOverride: boolean | undefined,
): number {
  const isLast = index === groupedTools.length - 1;
  const isAgentGroup = Array.isArray(group);
  const isCompact = !isAgentGroup && isCompactTool(group, isCompactModeEnabled);
  const isTopicToolCall = !isAgentGroup && isTopicTool(group.name);

  const nextGroup = !isLast ? groupedTools.at(index + 1) : null;
  const nextIsCompact = Boolean(
    nextGroup && !Array.isArray(nextGroup) && isCompactTool(nextGroup, isCompactModeEnabled),
  );
  const nextIsTopicToolCall = Boolean(
    nextGroup && !Array.isArray(nextGroup) && isTopicTool(nextGroup.name),
  );

  const isFirstProp = isGroupFirst(groupedTools, index, borderTopOverride);
  const showClosingBorder =
    !isCompact && !isTopicToolCall && (nextIsCompact || nextIsTopicToolCall || isLast);

  return calculateSingleGroupLines(
    group,
    isCompact,
    isTopicToolCall,
    isFirstProp,
    showClosingBorder,
  );
}

function renderSingleToolContent(
  isCompact: boolean,
  isTopicToolCall: boolean,
  isShellToolCall: boolean,
  commonProps: React.ComponentProps<typeof ToolMessage> & { isExpandable?: boolean },
  config: ReturnType<typeof useConfig>,
) {
  if (isCompact) {
    return <DenseToolMessage {...commonProps} />;
  }
  if (isTopicToolCall) {
    return (
      <Box marginBottom={1}>
        <TopicMessage {...commonProps} />
      </Box>
    );
  }
  if (isShellToolCall) {
    return <ShellToolMessage {...commonProps} config={config} />;
  }
  return <ToolMessage {...commonProps} />;
}

function SingleToolBlock({
  tool,
  isCompact,
  isTopicToolCall,
  isShellToolCall,
  isFirstProp,
  showClosingBorder,
  isLast,
  contentWidth,
  borderColor,
  borderDimColor,
  borderBottomOverride,
  availableTerminalHeightPerToolMessage,
  config,
  isExpandable,
}: {
  tool: IndividualToolCallDisplay;
  isCompact: boolean;
  isTopicToolCall: boolean;
  isShellToolCall: boolean;
  isFirstProp: boolean;
  showClosingBorder: boolean;
  isLast: boolean;
  contentWidth: number;
  borderColor: string;
  borderDimColor: boolean;
  borderBottomOverride: boolean | undefined;
  availableTerminalHeightPerToolMessage: number | undefined;
  config: ReturnType<typeof useConfig>;
  isExpandable: boolean | undefined;
}) {
  const commonProps = {
    ...tool,
    availableTerminalHeight: availableTerminalHeightPerToolMessage,
    terminalWidth: contentWidth,
    emphasis: 'medium' as const,
    isFirst: isCompact ? false : isFirstProp,
    borderColor,
    borderDimColor,
    isExpandable,
  };

  return (
    <Fragment key={tool.callId}>
      <Box flexDirection="column" minHeight={1} width={contentWidth}>
        {renderSingleToolContent(isCompact, isTopicToolCall, isShellToolCall, commonProps, config)}
        {!isCompact && tool.outputFile && (
          <Box
            borderLeft={true}
            borderRight={true}
            borderTop={false}
            borderBottom={false}
            borderColor={borderColor}
            borderDimColor={borderDimColor}
            flexDirection="column"
            borderStyle="round"
            paddingLeft={1}
            paddingRight={1}
          >
            <Box>
              <Text color={theme.text.primary}>
                Output too long and was saved to: {tool.outputFile}
              </Text>
            </Box>
          </Box>
        )}
      </Box>
      {showClosingBorder && (
        <Box
          width={contentWidth}
          borderLeft={true}
          borderRight={true}
          borderTop={false}
          borderBottom={isLast ? (borderBottomOverride ?? true) : true}
          borderColor={borderColor}
          borderDimColor={borderDimColor}
          borderStyle="round"
        />
      )}
    </Fragment>
  );
}

export const ToolGroupMessage: React.FC<ToolGroupMessageProps> = ({
  item,
  toolCalls: allToolCalls,
  availableTerminalHeight,
  terminalWidth,
  borderTop: borderTopOverride,
  borderBottom: borderBottomOverride,
  isExpandable,
}) => {
  const settings = useSettings();
  const isLowErrorVerbosity = settings.merged.ui?.errorVerbosity !== 'full';
  const isCompactModeEnabled = settings.merged.ui?.compactToolOutput === true;

  // Filter out tool calls that should be hidden (e.g. in-progress Ask User, or Plan Mode operations).
  const visibleToolCalls = useMemo(
    () =>
      allToolCalls.filter((t) =>
        // Use the unified visibility utility
        isVisibleInToolGroup(
          buildToolVisibilityContextFromDisplay(t),
          isLowErrorVerbosity ? 'low' : 'full',
        ),
      ),
    [allToolCalls, isLowErrorVerbosity],
  );

  const { activePtyId, embeddedShellFocused, backgroundTasks, pendingHistoryItems } = useUIState();

  const config = useConfig();

  const { borderColor, borderDimColor } = useMemo(
    () =>
      getToolGroupBorderAppearance(
        item,
        activePtyId,
        embeddedShellFocused,
        pendingHistoryItems,
        backgroundTasks,
      ),
    [item, activePtyId, embeddedShellFocused, pendingHistoryItems, backgroundTasks],
  );

  const groupedTools = useMemo(() => {
    const groups: Array<IndividualToolCallDisplay | IndividualToolCallDisplay[]> = [];
    for (const tool of visibleToolCalls) {
      if (tool.kind === Kind.Agent) {
        const lastGroup = groups[groups.length - 1];
        if (Array.isArray(lastGroup)) {
          lastGroup.push(tool);
        } else {
          groups.push([tool]);
        }
      } else {
        groups.push(tool);
      }
    }
    return groups;
  }, [visibleToolCalls]);

  const staticHeight = useMemo(() => {
    let height = 0;
    for (let i = 0; i < groupedTools.length; i++) {
      const g = groupedTools.at(i);
      if (g) {
        height += calculateGroupHeight(g, i, groupedTools, isCompactModeEnabled, borderTopOverride);
      }
    }
    return height;
  }, [groupedTools, isCompactModeEnabled, borderTopOverride]);

  let countToolCallsWithResults = 0;
  for (const tool of visibleToolCalls) {
    if (tool.kind !== Kind.Agent) {
      if (isCompactTool(tool, isCompactModeEnabled)) {
        if (hasDensePayload(tool)) {
          countToolCallsWithResults++;
        }
      } else if (tool.resultDisplay !== undefined && tool.resultDisplay !== '') {
        countToolCallsWithResults++;
      }
    }
  }

  const availableTerminalHeightPerToolMessage = availableTerminalHeight
    ? Math.max(
        Math.floor(
          (availableTerminalHeight - staticHeight) / Math.max(1, countToolCallsWithResults),
        ),
        1,
      )
    : undefined;

  const contentWidth = terminalWidth - TOOL_MESSAGE_HORIZONTAL_MARGIN;

  // If all tools are filtered out (e.g., in-progress AskUser tools, low-verbosity
  // internal errors, plan-mode hidden write/edit), we should not emit standalone
  // border fragments. The only case where an empty group should render is the
  // explicit "closing slice" (tools: []) used to bridge static/pending sections,
  // and only if it's actually continuing an open box from above.
  const isExplicitClosingSlice = allToolCalls.length === 0;
  const shouldShowGroup =
    visibleToolCalls.length > 0 || (isExplicitClosingSlice && borderBottomOverride === true);

  if (!shouldShowGroup) {
    return null;
  }

  const content = (
    <Box
      flexDirection="column"
      /*
      This width constraint is highly important and protects us from an Ink rendering bug.
      Since the ToolGroup can typically change rendering states frequently, it can cause
      Ink to render the border of the box incorrectly and span multiple lines and even
      cause tearing.
    */
      width={terminalWidth}
      paddingRight={TOOL_MESSAGE_HORIZONTAL_MARGIN}
      marginBottom={0}
    >
      {visibleToolCalls.length === 0 && isExplicitClosingSlice && borderBottomOverride === true && (
        <Box
          width={contentWidth}
          borderLeft={true}
          borderRight={true}
          borderTop={false}
          borderBottom={true}
          borderColor={borderColor}
          borderDimColor={borderDimColor}
          borderStyle="round"
        />
      )}
      {groupedTools.map((group, index) => {
        const isFirstProp = isGroupFirst(groupedTools, index, borderTopOverride);
        const isLast = index === groupedTools.length - 1;
        const isAgentGroup = Array.isArray(group);
        const isCompact = !isAgentGroup && isCompactTool(group, isCompactModeEnabled);
        const isTopicToolCall = !isAgentGroup && isTopicTool(group.name);

        const nextGroup = !isLast ? groupedTools[index + 1] : null;
        const nextIsCompact =
          nextGroup && !Array.isArray(nextGroup) && isCompactTool(nextGroup, isCompactModeEnabled);
        const nextIsTopicToolCall =
          nextGroup && !Array.isArray(nextGroup) && isTopicTool(nextGroup.name);

        const showClosingBorder =
          !isCompact && !isTopicToolCall && (nextIsCompact || nextIsTopicToolCall || isLast);

        if (isAgentGroup) {
          const agentKey = group.at(0)?.callId ?? `agent-group-${index}`;
          return (
            <Box key={agentKey} flexDirection="column" width={contentWidth}>
              <SubagentGroupDisplay
                toolCalls={group}
                availableTerminalHeight={availableTerminalHeight}
                terminalWidth={contentWidth}
                borderColor={borderColor}
                borderDimColor={borderDimColor}
                isFirst={isFirstProp}
                isExpandable={isExpandable}
              />
              {showClosingBorder && (
                <Box
                  width={contentWidth}
                  borderLeft={true}
                  borderRight={true}
                  borderTop={false}
                  borderBottom={isLast ? (borderBottomOverride ?? true) : true}
                  borderColor={borderColor}
                  borderDimColor={borderDimColor}
                  borderStyle="round"
                />
              )}
            </Box>
          );
        }

        return (
          <SingleToolBlock
            key={group.callId}
            tool={group}
            isCompact={isCompact}
            isTopicToolCall={isTopicToolCall}
            isShellToolCall={isShellTool(group.name)}
            isFirstProp={isFirstProp}
            showClosingBorder={showClosingBorder}
            isLast={isLast}
            contentWidth={contentWidth}
            borderColor={borderColor}
            borderDimColor={borderDimColor}
            borderBottomOverride={borderBottomOverride}
            availableTerminalHeightPerToolMessage={availableTerminalHeightPerToolMessage}
            config={config}
            isExpandable={isExpandable}
          />
        );
      })}
    </Box>
  );

  return content;
};
