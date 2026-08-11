import React, { useCallback } from 'react';
import { Box, Text } from 'ink';
import { DiffRenderer } from './DiffRenderer.js';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { AnsiOutputText, AnsiLineText } from '../AnsiOutput.js';
import { SlicingMaxSizedBox } from '../shared/SlicingMaxSizedBox.js';
import { MaxSizedBox } from '../shared/MaxSizedBox.js';
import { theme } from '../../semantic-colors.js';
import {
  AnsiOutput,
  AnsiLine,
  isSubagentProgress,
  isStructuredToolResult,
  useUIState,
} from '../../contexts/UIStateContext.js';
import { tryParseJSON } from '../../../utils/jsonoutput.js';
import { useAlternateBuffer } from '../../hooks/useAlternateBuffer.js';
import { Scrollable } from '../shared/Scrollable.js';
import { ScrollableList } from '../shared/ScrollableList.js';
import { SCROLL_TO_ITEM_END } from '../shared/VirtualizedList.js';
import { ACTIVE_SHELL_MAX_LINES } from '../../constants.js';
import { calculateToolContentMaxLines } from '../../utils/toolLayoutUtils.js';
import { SubagentProgressDisplay } from './SubagentProgressDisplay.js';

export type ToolResultValue = string | object | undefined;

export interface ToolResultDisplayProps {
  resultDisplay: ToolResultValue;
  availableTerminalHeight?: number;
  terminalWidth: number;
  renderOutputAsMarkdown?: boolean;
  maxLines?: number;
  hasFocus?: boolean;
  overflowDirection?: 'top' | 'bottom';
}

interface FileDiffResult {
  fileDiff: string;
  fileName: string;
}

interface ToolContentContext {
  childWidth: number;
  availableHeight: number | undefined;
  maxLines: number | undefined;
  renderOutputAsMarkdown: boolean;
  renderMarkdown: boolean;
  isAlternateBuffer: boolean;
  hasFocus: boolean;
}

function renderStructuredOrDiffContent(
  contentData: ToolResultValue,
  ctx: ToolContentContext,
): React.ReactNode {
  if (isStructuredToolResult(contentData)) {
    const summaryText = (contentData as { summary: string }).summary;
    return ctx.renderOutputAsMarkdown ? (
      <MarkdownDisplay
        text={summaryText}
        terminalWidth={ctx.childWidth}
        renderMarkdown={ctx.renderMarkdown}
        isPending={false}
      />
    ) : (
      <Text wrap="wrap" color={theme.text.primary}>
        {summaryText}
      </Text>
    );
  }
  if (typeof contentData === 'object' && contentData !== null && 'fileDiff' in contentData) {
    const fileDiffObj = contentData as FileDiffResult;
    return (
      <DiffRenderer
        diffContent={fileDiffObj.fileDiff}
        filename={fileDiffObj.fileName}
        availableTerminalHeight={ctx.availableHeight}
        terminalWidth={ctx.childWidth}
      />
    );
  }
  return null;
}

function getObjectOrStringContent(
  contentData: ToolResultValue,
  ctx: ToolContentContext,
): React.ReactNode {
  if (isSubagentProgress(contentData)) {
    return <SubagentProgressDisplay progress={contentData} terminalWidth={ctx.childWidth} />;
  }
  if (typeof contentData === 'string') {
    if (ctx.renderOutputAsMarkdown) {
      return (
        <MarkdownDisplay
          text={contentData}
          terminalWidth={ctx.childWidth}
          renderMarkdown={ctx.renderMarkdown}
          isPending={false}
        />
      );
    }
    return (
      <Text wrap="wrap" color={theme.text.primary}>
        {contentData}
      </Text>
    );
  }
  const structuredOrDiff = renderStructuredOrDiffContent(contentData, ctx);
  if (structuredOrDiff) return structuredOrDiff;

  if (Array.isArray(contentData)) {
    const shouldDisableTruncation =
      ctx.isAlternateBuffer || (ctx.availableHeight === undefined && ctx.maxLines === undefined);
    return (
      <AnsiOutputText
        data={contentData as AnsiOutput}
        availableTerminalHeight={ctx.isAlternateBuffer ? undefined : ctx.availableHeight}
        width={ctx.childWidth}
        maxLines={ctx.isAlternateBuffer ? undefined : ctx.maxLines}
        disableTruncation={shouldDisableTruncation}
      />
    );
  }
  if (typeof contentData === 'object' && contentData !== null) {
    return (
      <Text wrap="wrap" color={theme.text.primary}>
        {JSON.stringify(contentData, null, 2)}
      </Text>
    );
  }
  return null;
}

function renderToolContent(contentData: ToolResultValue, ctx: ToolContentContext): React.ReactNode {
  const prettyJSON = typeof contentData === 'string' ? tryParseJSON(contentData) : null;
  const formattedJSON = prettyJSON ? JSON.stringify(prettyJSON, null, 2) : null;
  const content = formattedJSON ? (
    <Text wrap="wrap" color={theme.text.primary}>
      {formattedJSON}
    </Text>
  ) : (
    getObjectOrStringContent(contentData, ctx)
  );

  if (ctx.isAlternateBuffer) {
    const effectiveMaxHeight = ctx.maxLines ?? ctx.availableHeight;
    return (
      <Scrollable
        width={ctx.childWidth}
        maxHeight={effectiveMaxHeight}
        hasFocus={ctx.hasFocus}
        scrollToBottom={true}
        reportOverflow={true}
      >
        {content}
      </Scrollable>
    );
  }
  return content;
}

function renderAnsiArrayOutput(
  data: AnsiOutput,
  ctx: {
    childWidth: number;
    availableHeight: number | undefined;
    maxLines: number | undefined;
    constrainHeight: boolean;
    isAlternateBuffer: boolean;
    overflowDirection: 'top' | 'bottom';
    hasFocus: boolean;
    renderVirtualizedAnsiLine: ({ item }: { item: AnsiLine }) => React.JSX.Element;
    keyExtractor: (_: AnsiLine, index: number) => string;
  },
) {
  const limit = ctx.maxLines ?? ctx.availableHeight ?? ACTIVE_SHELL_MAX_LINES;
  const listHeight = !ctx.constrainHeight ? data.length : Math.min(data.length, limit);

  if (ctx.isAlternateBuffer) {
    const initialScrollIndex = ctx.overflowDirection === 'bottom' ? 0 : SCROLL_TO_ITEM_END;
    return (
      <Box width={ctx.childWidth} flexDirection="column" maxHeight={listHeight}>
        <ScrollableList
          width={ctx.childWidth}
          containerHeight={listHeight}
          data={data}
          renderItem={ctx.renderVirtualizedAnsiLine}
          estimatedItemHeight={() => 1}
          fixedItemHeight={true}
          keyExtractor={ctx.keyExtractor}
          initialScrollIndex={initialScrollIndex}
          hasFocus={ctx.hasFocus}
        />
      </Box>
    );
  }

  let displayData = data;
  let hiddenLines = 0;
  if (ctx.constrainHeight && data.length > listHeight) {
    hiddenLines = data.length - listHeight;
    displayData =
      ctx.overflowDirection === 'top' ? data.slice(hiddenLines) : data.slice(0, listHeight);
  }

  return (
    <Box width={ctx.childWidth} flexDirection="column">
      <MaxSizedBox
        maxHeight={ctx.constrainHeight ? listHeight : undefined}
        maxWidth={ctx.childWidth}
        overflowDirection={ctx.overflowDirection}
        additionalHiddenLinesCount={hiddenLines}
      >
        {displayData.map((item, index) => {
          const actualIndex = (ctx.overflowDirection === 'top' ? hiddenLines : 0) + index;
          return (
            <Box key={ctx.keyExtractor(item, actualIndex)} height={1} overflow="hidden">
              <AnsiLineText line={item} />
            </Box>
          );
        })}
      </MaxSizedBox>
    </Box>
  );
}

export const ToolResultDisplay: React.FC<ToolResultDisplayProps> = ({
  resultDisplay,
  availableTerminalHeight,
  terminalWidth,
  renderOutputAsMarkdown = true,
  maxLines,
  hasFocus = false,
  overflowDirection = 'top',
}) => {
  const { renderMarkdown, constrainHeight } = useUIState();
  const isAlternateBuffer = useAlternateBuffer();

  const availableHeight = calculateToolContentMaxLines({
    availableTerminalHeight,
    isAlternateBuffer,
    maxLinesLimit: maxLines,
  });

  const combinedPaddingAndBorderWidth = 4;
  const childWidth = terminalWidth - combinedPaddingAndBorderWidth;

  const keyExtractor = useCallback((_: AnsiLine, index: number) => index.toString(), []);

  const renderVirtualizedAnsiLine = useCallback(
    ({ item }: { item: AnsiLine }) => (
      <Box height={1} overflow="hidden">
        <AnsiLineText line={item} />
      </Box>
    ),
    [],
  );

  if (!resultDisplay) return null;
  if (typeof resultDisplay === 'object' && 'todos' in resultDisplay) return null;

  const toolCtx = {
    childWidth,
    availableHeight,
    maxLines,
    renderOutputAsMarkdown,
    renderMarkdown,
    isAlternateBuffer,
    hasFocus,
  };

  if (Array.isArray(resultDisplay)) {
    return renderAnsiArrayOutput(resultDisplay as AnsiOutput, {
      childWidth,
      availableHeight,
      maxLines,
      constrainHeight,
      isAlternateBuffer,
      overflowDirection,
      hasFocus,
      renderVirtualizedAnsiLine,
      keyExtractor,
    });
  }

  // ASB Mode Handling (Interactive/Fullscreen)
  if (isAlternateBuffer) {
    return (
      <Box width={childWidth} flexDirection="column">
        {renderToolContent(resultDisplay, toolCtx)}
      </Box>
    );
  }

  // Standard Mode Handling (History/Scrollback)
  return (
    <Box width={childWidth} flexDirection="column">
      <SlicingMaxSizedBox
        data={resultDisplay}
        maxLines={maxLines}
        isAlternateBuffer={isAlternateBuffer}
        maxHeight={availableHeight}
        maxWidth={childWidth}
        overflowDirection={overflowDirection}
      >
        {(truncatedResultDisplay) => renderToolContent(truncatedResultDisplay, toolCtx)}
      </SlicingMaxSizedBox>
    </Box>
  );
};
