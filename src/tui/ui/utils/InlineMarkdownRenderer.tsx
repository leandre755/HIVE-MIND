import React, { memo } from 'react';
import { Text } from 'ink';
import { parseMarkdownToANSI } from './markdownParsingUtils.js';
import { stripUnsafeCharacters } from './textUtils.js';

interface RenderInlineProps {
  text: string;
  defaultColor?: string;
}

const RenderInlineInternal: React.FC<RenderInlineProps> = ({ text: rawText, defaultColor }) => {
  const text = stripUnsafeCharacters(rawText);
  const ansiText = parseMarkdownToANSI(text, defaultColor);

  return <Text>{ansiText}</Text>;
};

export const RenderInline = memo(RenderInlineInternal);
