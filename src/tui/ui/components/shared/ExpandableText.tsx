import React, { memo } from 'react';
import { Text } from 'ink';
import { theme } from '../../semantic-colors.js';

export const MAX_WIDTH = 150;

export interface ExpandableTextProps {
  label: string;
  matchedIndex?: number;
  userInput?: string;
  textColor?: string;
  isExpanded?: boolean;
  maxWidth?: number;
  maxLines?: number;
}

function truncateLabel(
  label: string,
  isExpanded: boolean,
  maxWidth: number,
  maxLines?: number,
): string {
  if (isExpanded) return label;
  if (maxLines !== undefined) {
    const lines = label.split('\n');
    const truncated = lines.slice(0, maxLines).join('\n');
    const hasMoreLines = lines.length > maxLines;
    if (truncated.length > maxWidth) {
      return truncated.slice(0, maxWidth) + '...';
    }
    return hasMoreLines ? truncated + '...' : truncated;
  }
  return label.length > maxWidth ? label.slice(0, maxWidth) + '...' : label;
}

function calculateMatchedParts(
  label: string,
  matchedIndex: number,
  matchLength: number,
  maxWidth: number,
  isExpanded: boolean,
): { before: string; match: string; after: string } {
  if (isExpanded || label.length <= maxWidth) {
    return {
      before: label.slice(0, matchedIndex),
      match: label.slice(matchedIndex, matchedIndex + matchLength),
      after: label.slice(matchedIndex + matchLength),
    };
  }
  if (matchLength >= maxWidth) {
    return {
      before: '',
      match: label.slice(matchedIndex, matchedIndex + maxWidth - 1) + '...',
      after: '',
    };
  }

  const contextSpace = maxWidth - matchLength;
  const beforeSpace = Math.floor(contextSpace / 2);
  const afterSpace = Math.ceil(contextSpace / 2);

  let start = matchedIndex - beforeSpace;
  let end = matchedIndex + matchLength + afterSpace;

  if (start < 0) {
    end += -start;
    start = 0;
  }
  if (end > label.length) {
    start -= end - label.length;
    end = label.length;
  }
  start = Math.max(0, start);

  const finalMatchIndex = matchedIndex - start;
  const slicedLabel = label.slice(start, end);

  let before = slicedLabel.slice(0, finalMatchIndex);
  const match = slicedLabel.slice(finalMatchIndex, finalMatchIndex + matchLength);
  let after = slicedLabel.slice(finalMatchIndex + matchLength);

  if (start > 0) {
    before = before.length >= 3 ? '...' + before.slice(3) : '...';
  }
  if (end < label.length) {
    after = after.length >= 3 ? after.slice(0, -3) + '...' : '...';
  }

  return { before, match, after };
}

const _ExpandableText: React.FC<ExpandableTextProps> = ({
  label,
  matchedIndex,
  userInput = '',
  textColor = theme.text.primary,
  isExpanded = false,
  maxWidth = MAX_WIDTH,
  maxLines,
}) => {
  const hasMatch =
    matchedIndex !== undefined &&
    matchedIndex >= 0 &&
    matchedIndex < label.length &&
    userInput.length > 0;

  if (!hasMatch) {
    const display = truncateLabel(label, isExpanded, maxWidth, maxLines);
    return (
      <Text wrap="wrap" color={textColor}>
        {display}
      </Text>
    );
  }

  const { before, match, after } = calculateMatchedParts(
    label,
    matchedIndex,
    userInput.length,
    maxWidth,
    isExpanded,
  );

  return (
    <Text color={textColor} wrap="wrap">
      {before}
      {match
        ? match.split(/(\s+)/).map((part, index) => (
            <Text key={`match-${index}`} inverse color={textColor}>
              {part}
            </Text>
          ))
        : null}
      {after}
    </Text>
  );
};

export const ExpandableText = memo(_ExpandableText);
