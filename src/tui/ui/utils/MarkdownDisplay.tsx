import React, { memo } from 'react';
import { Text, Box } from 'ink';
import { theme } from '../semantic-colors.js';
import { colorizeCode } from './CodeColorizer.js';
import { TableRenderer } from './TableRenderer.js';
import { RenderInline } from './InlineMarkdownRenderer.js';
import { useSettings } from '../contexts/SettingsContext.js';
import { useAlternateBuffer } from '../hooks/useAlternateBuffer.js';

interface MarkdownDisplayProps {
  text: string;
  isPending: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
  renderMarkdown?: boolean;
}

const EMPTY_LINE_HEIGHT = 1;
const CODE_BLOCK_PREFIX_PADDING = 1;
const LIST_ITEM_PREFIX_PADDING = 1;
const LIST_ITEM_TEXT_FLEX_GROW = 1;

interface LineParseState {
  inCodeBlock: boolean;
  lastLineEmpty: boolean;
  codeBlockContent: string[];
  codeBlockLang: string | null;
  codeBlockFence: string;
  inTable: boolean;
  tableRows: string[][];
  tableHeaders: string[];
}

function renderHeaderNode(
  level: number,
  headerText: string,
  responseColor: string,
): React.ReactNode {
  switch (level) {
    case 1:
      return (
        <Box borderStyle="single" borderColor={theme.border.default} paddingX={1}>
          <Text bold color={theme.text.accent}>
            {headerText}
          </Text>
        </Box>
      );
    case 2:
      return (
        <Text bold color={theme.text.link}>
          ## {headerText}
        </Text>
      );
    case 3:
      return (
        <Text bold color={theme.text.primary}>
          ### {headerText}
        </Text>
      );
    default:
      return (
        <Text bold color={responseColor}>
          #### {headerText}
        </Text>
      );
  }
}

function isHorizontalRule(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length < 3) return false;
  const char = trimmed[0];
  if (char !== '-' && char !== '*' && char !== '_') return false;
  for (let i = 0; i < trimmed.length; i++) {
    const c = trimmed.charAt(i);
    if (c !== char && c !== ' ') return false;
  }
  const count = trimmed.split(char).length - 1;
  return count >= 3;
}

function isTableSeparator(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes('-')) return false;
  const parts = trimmed
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((p) => /^:?-+:?$/.test(p));
}

function matchCodeFence(line: string): { fence: string; lang: string } | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('```') && !trimmed.startsWith('~~~')) return null;
  const fenceChar = trimmed[0];
  let fenceLen = 0;
  while (fenceLen < trimmed.length && trimmed.charAt(fenceLen) === fenceChar) {
    fenceLen++;
  }
  if (fenceLen < 3) return null;
  const lang = trimmed.slice(fenceLen).trim();
  if (/\s/.test(lang)) return null;
  return { fence: trimmed.slice(0, fenceLen), lang };
}

function processCodeBlockState(
  line: string,
  key: string,
  state: LineParseState,
  contentBlocks: React.ReactNode[],
  isPending: boolean,
  availableTerminalHeight: number | undefined,
  terminalWidth: number,
  isAlternateBuffer: boolean,
): boolean {
  if (!state.inCodeBlock) return false;
  const fenceMatch = matchCodeFence(line);
  if (
    fenceMatch &&
    fenceMatch.fence.startsWith(state.codeBlockFence[0]) &&
    fenceMatch.fence.length >= state.codeBlockFence.length
  ) {
    contentBlocks.push(
      <RenderCodeBlock
        key={key}
        content={state.codeBlockContent}
        lang={state.codeBlockLang}
        isPending={isPending}
        availableTerminalHeight={isAlternateBuffer ? undefined : availableTerminalHeight}
        terminalWidth={terminalWidth}
      />,
    );
    state.lastLineEmpty = false;
    state.inCodeBlock = false;
    state.codeBlockContent = [];
    state.codeBlockLang = null;
    state.codeBlockFence = '';
  } else {
    state.codeBlockContent.push(line);
  }
  return true;
}

function flushTable(
  state: LineParseState,
  contentBlocks: React.ReactNode[],
  terminalWidth: number,
): void {
  if (state.tableHeaders.length > 0 && state.tableRows.length > 0) {
    contentBlocks.push(
      <RenderTable
        key={`table-${contentBlocks.length}`}
        headers={state.tableHeaders}
        rows={state.tableRows}
        terminalWidth={terminalWidth}
      />,
    );
    state.lastLineEmpty = false;
  }
  state.inTable = false;
  state.tableRows = [];
  state.tableHeaders = [];
}

function handleTableStart(
  tableRowMatch: RegExpMatchArray | null,
  index: number,
  lines: string[],
  state: LineParseState,
): boolean {
  if (tableRowMatch && !state.inTable) {
    if (index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      state.inTable = true;
      state.tableHeaders = tableRowMatch[1].split('|').map((cell) => cell.trim());
      state.tableRows = [];
      return true;
    }
  }
  return false;
}

function handleTableRow(tableRowMatch: RegExpMatchArray, state: LineParseState): void {
  const cells = tableRowMatch[1].split('|').map((cell) => cell.trim());
  while (cells.length < state.tableHeaders.length) cells.push('');
  if (cells.length > state.tableHeaders.length) cells.length = state.tableHeaders.length;
  state.tableRows.push(cells);
}

function processTableState(
  line: string,
  index: number,
  lines: string[],
  key: string,
  state: LineParseState,
  contentBlocks: React.ReactNode[],
  responseColor: string,
  terminalWidth: number,
): boolean {
  const tableRowRegex = /^\s*\|(.+)\|\s*$/;
  const tableRowMatch = line.match(tableRowRegex);
  const tableSeparatorMatch = isTableSeparator(line);

  if (handleTableStart(tableRowMatch, index, lines, state)) return true;
  if (state.inTable && tableSeparatorMatch) return true;
  if (state.inTable && tableRowMatch) {
    handleTableRow(tableRowMatch, state);
    return true;
  }
  if (state.inTable) {
    flushTable(state, contentBlocks, terminalWidth);
    if (line.trim().length > 0) {
      contentBlocks.push(
        <Box key={key}>
          <Text wrap="wrap" color={responseColor}>
            <RenderInline text={line} defaultColor={responseColor} />
          </Text>
        </Box>,
      );
      state.lastLineEmpty = false;
    }
    return true;
  }
  return false;
}

function processMarkdownLine(
  line: string,
  index: number,
  lines: string[],
  state: LineParseState,
  contentBlocks: React.ReactNode[],
  responseColor: string,
  isPending: boolean,
  availableTerminalHeight: number | undefined,
  terminalWidth: number,
  isAlternateBuffer: boolean,
): void {
  const key = `line-${index}`;

  if (
    processCodeBlockState(
      line,
      key,
      state,
      contentBlocks,
      isPending,
      availableTerminalHeight,
      terminalWidth,
      isAlternateBuffer,
    )
  ) {
    return;
  }

  if (
    processTableState(line, index, lines, key, state, contentBlocks, responseColor, terminalWidth)
  ) {
    return;
  }

  const headerRegex = /^ *(#{1,4}) +(.*)/;
  const ulItemRegex = /^([ \t]*)([-*+]) +(.*)/;
  const olItemRegex = /^([ \t]*)(\d+)\. +(.*)/;

  const codeFenceMatch = matchCodeFence(line);
  const headerMatch = line.match(headerRegex);
  const ulMatch = line.match(ulItemRegex);
  const olMatch = line.match(olItemRegex);
  const isHr = isHorizontalRule(line);

  const addBlock = (block: React.ReactNode) => {
    if (block) {
      contentBlocks.push(block);
      state.lastLineEmpty = false;
    }
  };

  if (codeFenceMatch) {
    state.inCodeBlock = true;
    state.codeBlockFence = codeFenceMatch.fence;
    state.codeBlockLang = codeFenceMatch.lang || null;
  } else if (headerMatch) {
    const level = headerMatch[1].length;
    const headerNode = renderHeaderNode(level, headerMatch[2], responseColor);
    if (headerNode) addBlock(<Box key={key}>{headerNode}</Box>);
  } else if (ulMatch) {
    addBlock(
      <RenderListItem
        key={key}
        itemText={ulMatch[3]}
        type="ul"
        marker={ulMatch[2]}
        leadingWhitespace={ulMatch[1]}
      />,
    );
  } else if (olMatch) {
    addBlock(
      <RenderListItem
        key={key}
        itemText={olMatch[3]}
        type="ol"
        marker={olMatch[2]}
        leadingWhitespace={olMatch[1]}
      />,
    );
  } else if (isHr) {
    addBlock(
      <Box
        key={key}
        borderStyle="single"
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        borderColor={theme.border.default}
        marginY={1}
      >
        <Text color={theme.text.secondary}>{'─'.repeat(Math.max(10, terminalWidth - 4))}</Text>
      </Box>,
    );
  } else if (line.trim().length === 0) {
    if (!state.lastLineEmpty) {
      contentBlocks.push(<Box key={`spacer-${index}`} height={EMPTY_LINE_HEIGHT} />);
      state.lastLineEmpty = true;
    }
  } else {
    addBlock(
      <Box key={key}>
        <Text wrap="wrap" color={responseColor}>
          <RenderInline text={line} defaultColor={responseColor} />
        </Text>
      </Box>,
    );
  }
}

const MarkdownDisplayInternal: React.FC<MarkdownDisplayProps> = ({
  text,
  isPending,
  availableTerminalHeight,
  terminalWidth,
  renderMarkdown = true,
}) => {
  const settings = useSettings();
  const isAlternateBuffer = useAlternateBuffer();
  const responseColor = theme.text.response ?? theme.text.primary;

  if (!text) return <></>;

  // Raw markdown mode - display syntax-highlighted markdown without rendering
  if (!renderMarkdown) {
    // Hide line numbers in raw markdown mode as they are confusing due to chunked output
    const colorizedMarkdown = colorizeCode({
      code: text,
      language: 'markdown',
      availableHeight: isAlternateBuffer ? undefined : availableTerminalHeight,
      maxWidth: terminalWidth - CODE_BLOCK_PREFIX_PADDING,
      settings,
      hideLineNumbers: true,
    });
    return (
      <Box paddingLeft={CODE_BLOCK_PREFIX_PADDING} flexDirection="column">
        {colorizedMarkdown}
      </Box>
    );
  }

  const lines = text.split(/\r?\n/);

  const contentBlocks: React.ReactNode[] = [];
  const state: LineParseState = {
    inCodeBlock: false,
    lastLineEmpty: true,
    codeBlockContent: [],
    codeBlockLang: null,
    codeBlockFence: '',
    inTable: false,
    tableRows: [],
    tableHeaders: [],
  };

  lines.forEach((line, index) => {
    processMarkdownLine(
      line,
      index,
      lines,
      state,
      contentBlocks,
      responseColor,
      isPending,
      availableTerminalHeight,
      terminalWidth,
      isAlternateBuffer,
    );
  });

  if (state.inCodeBlock) {
    contentBlocks.push(
      <RenderCodeBlock
        key="line-eof"
        content={state.codeBlockContent}
        lang={state.codeBlockLang}
        isPending={isPending}
        availableTerminalHeight={isAlternateBuffer ? undefined : availableTerminalHeight}
        terminalWidth={terminalWidth}
      />,
    );
  }

  if (state.inTable && state.tableHeaders.length > 0 && state.tableRows.length > 0) {
    contentBlocks.push(
      <RenderTable
        key={`table-${contentBlocks.length}`}
        headers={state.tableHeaders}
        rows={state.tableRows}
        terminalWidth={terminalWidth}
      />,
    );
  }

  return <>{contentBlocks}</>;
};

// Helper functions (adapted from static methods of MarkdownRenderer)

interface RenderCodeBlockProps {
  content: string[];
  lang: string | null;
  isPending: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
}

const RenderCodeBlockInternal: React.FC<RenderCodeBlockProps> = ({
  content,
  lang,
  isPending,
  availableTerminalHeight,
  terminalWidth,
}) => {
  const settings = useSettings();
  const isAlternateBuffer = useAlternateBuffer();
  const MIN_LINES_FOR_MESSAGE = 1; // Minimum lines to show before the "generating more" message
  const RESERVED_LINES = 2; // Lines reserved for the message itself and potential padding

  // When not in alternate buffer mode we need to be careful that we don't
  // trigger flicker when the pending code is too long to fit in the terminal
  if (!isAlternateBuffer && isPending && availableTerminalHeight !== undefined) {
    const MAX_CODE_LINES_WHEN_PENDING = Math.max(0, availableTerminalHeight - RESERVED_LINES);

    if (content.length > MAX_CODE_LINES_WHEN_PENDING) {
      if (MAX_CODE_LINES_WHEN_PENDING < MIN_LINES_FOR_MESSAGE) {
        // Not enough space to even show the message meaningfully
        return (
          <Box paddingLeft={CODE_BLOCK_PREFIX_PADDING}>
            <Text color={theme.text.secondary}>... code is being written ...</Text>
          </Box>
        );
      }
      const truncatedContent = content.slice(0, MAX_CODE_LINES_WHEN_PENDING);
      const colorizedTruncatedCode = colorizeCode({
        code: truncatedContent.join('\n'),
        language: lang,
        availableHeight: availableTerminalHeight,
        maxWidth: terminalWidth - CODE_BLOCK_PREFIX_PADDING,
        settings,
      });
      return (
        <Box paddingLeft={CODE_BLOCK_PREFIX_PADDING} flexDirection="column">
          {colorizedTruncatedCode}
          <Text color={theme.text.secondary}>... generating more ...</Text>
        </Box>
      );
    }
  }

  const fullContent = content.join('\n');
  const colorizedCode = colorizeCode({
    code: fullContent,
    language: lang,
    availableHeight: isAlternateBuffer ? undefined : availableTerminalHeight,
    maxWidth: terminalWidth - CODE_BLOCK_PREFIX_PADDING,
    settings,
  });

  return (
    <Box
      paddingLeft={CODE_BLOCK_PREFIX_PADDING}
      flexDirection="column"
      width={terminalWidth}
      flexShrink={0}
    >
      {colorizedCode}
    </Box>
  );
};

const RenderCodeBlock = memo(RenderCodeBlockInternal);

interface RenderListItemProps {
  itemText: string;
  type: 'ul' | 'ol';
  marker: string;
  leadingWhitespace?: string;
}

const RenderListItemInternal: React.FC<RenderListItemProps> = ({
  itemText,
  type,
  marker,
  leadingWhitespace = '',
}) => {
  const prefix = type === 'ol' ? `${marker}. ` : `${marker} `;
  const prefixWidth = prefix.length;
  // Account for leading whitespace (indentation level) plus the standard prefix padding
  const indentation = leadingWhitespace.length;
  const listResponseColor = theme.text.response ?? theme.text.primary;

  return (
    <Box paddingLeft={indentation + LIST_ITEM_PREFIX_PADDING} flexDirection="row">
      <Box width={prefixWidth} flexShrink={0}>
        <Text color={listResponseColor}>{prefix}</Text>
      </Box>
      <Box flexGrow={LIST_ITEM_TEXT_FLEX_GROW}>
        <Text wrap="wrap" color={listResponseColor}>
          <RenderInline text={itemText} defaultColor={listResponseColor} />
        </Text>
      </Box>
    </Box>
  );
};

const RenderListItem = memo(RenderListItemInternal);

interface RenderTableProps {
  headers: string[];
  rows: string[][];
  terminalWidth: number;
}

const RenderTableInternal: React.FC<RenderTableProps> = ({ headers, rows, terminalWidth }) => (
  <TableRenderer headers={headers} rows={rows} terminalWidth={terminalWidth} />
);

const RenderTable = memo(RenderTableInternal);

export const MarkdownDisplay = memo(MarkdownDisplayInternal);
