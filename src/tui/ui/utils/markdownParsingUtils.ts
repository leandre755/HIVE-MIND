import chalk from 'chalk';
import { resolveColor, INK_SUPPORTED_NAMES, INK_NAME_TO_HEX_MAP } from '../themes/color-utils.js';
import { theme } from '../semantic-colors.js';
import { debugLogger } from '../../utils/errors.js';
import { convertLatexToUnicode } from './latexToUnicode.js';

// Constants for Markdown parsing
const BOLD_MARKER_LENGTH = 2; // For "**"
const ITALIC_MARKER_LENGTH = 1; // For "*" or "_"
const STRIKETHROUGH_MARKER_LENGTH = 2; // For "~~")
const INLINE_CODE_MARKER_LENGTH = 1; // For "`"
const UNDERLINE_TAG_START_LENGTH = 3; // For "<u>"
const UNDERLINE_TAG_END_LENGTH = 4; // For "</u>"

/**
 * Helper to apply color to a string using ANSI escape codes,
 * consistent with how Ink's colorize works.
 */
const ansiColorize = (str: string, color: string | undefined): string => {
  if (!color) return str;
  const resolved = resolveColor(color);
  if (!resolved) return str;

  if (resolved.startsWith('#')) {
    return chalk.hex(resolved)(str);
  }

  const mappedHex = Reflect.get(INK_NAME_TO_HEX_MAP, resolved) as string | undefined;
  if (mappedHex) {
    return chalk.hex(mappedHex)(str);
  }

  if (INK_SUPPORTED_NAMES.has(resolved)) {
    switch (resolved) {
      case 'black':
        return chalk.black(str);
      case 'red':
        return chalk.red(str);
      case 'green':
        return chalk.green(str);
      case 'yellow':
        return chalk.yellow(str);
      case 'blue':
        return chalk.blue(str);
      case 'magenta':
        return chalk.magenta(str);
      case 'cyan':
        return chalk.cyan(str);
      case 'white':
        return chalk.white(str);
      case 'gray':
      case 'grey':
        return chalk.gray(str);
      default:
        return str;
    }
  }

  return str;
};

/**
 * Converts markdown text into a string with ANSI escape codes.
 * This mirrors the parsing logic in InlineMarkdownRenderer.tsx
 */
// Private-Use-Area codepoint used as a placeholder sentinel when masking
// inline code / URL spans from LaTeX conversion. Not touched by
// stripUnsafeCharacters and not matched by the markdown tokenizer.
const MASK_SENTINEL = '\uE000';
const MASK_PATTERN = /\uE000(\d+)\uE000/g;

/**
 * Runs LaTeX conversion on `text` while keeping inline code spans and bare
 * URLs verbatim. Without masking, the LaTeX pass would happily rewrite
 * ``$\to$`` inside a backtick code span — violating the "code is verbatim"
 * contract — and could rewrite URL query strings containing `$`.
 */
function maskNextSpanOrUrl(
  text: string,
  currentIndex: number,
  preserved: string[],
): { nextIndex: number; segment: string } {
  const tickIndex = text.indexOf('`', currentIndex);
  const httpIndex = text.indexOf('http', currentIndex);

  if (tickIndex === -1 && httpIndex === -1) {
    return { nextIndex: text.length, segment: text.slice(currentIndex) };
  }

  const isTick = tickIndex !== -1 && (httpIndex === -1 || tickIndex < httpIndex);

  if (isTick) {
    const closingTick = text.indexOf('`', tickIndex + 1);
    if (closingTick !== -1) {
      const prefix = text.slice(currentIndex, tickIndex);
      const match = text.slice(tickIndex, closingTick + 1);
      const idx = preserved.push(match) - 1;
      return {
        nextIndex: closingTick + 1,
        segment: `${prefix}${MASK_SENTINEL}${idx}${MASK_SENTINEL}`,
      };
    }
    return { nextIndex: tickIndex + 1, segment: text.slice(currentIndex, tickIndex + 1) };
  }

  let spaceIndex = text.indexOf(' ', httpIndex);
  if (spaceIndex === -1) spaceIndex = text.length;
  const prefix = text.slice(currentIndex, httpIndex);
  const match = text.slice(httpIndex, spaceIndex);
  const idx = preserved.push(match) - 1;
  return { nextIndex: spaceIndex, segment: `${prefix}${MASK_SENTINEL}${idx}${MASK_SENTINEL}` };
}

const convertLatexPreservingSpans = (text: string): string => {
  const preserved: string[] = [];
  let result = '';
  let currentIndex = 0;

  while (currentIndex < text.length) {
    const res = maskNextSpanOrUrl(text, currentIndex, preserved);
    result += res.segment;
    currentIndex = res.nextIndex;
  }

  const converted = convertLatexToUnicode(result);
  return converted.replace(MASK_PATTERN, (match, i: string) => preserved.at(Number(i)) ?? match);
};

function styleBoldItalicStrikethrough(fullMatch: string, baseColor: string): string | undefined {
  if (
    fullMatch.endsWith('***') &&
    fullMatch.startsWith('***') &&
    fullMatch.length > (BOLD_MARKER_LENGTH + ITALIC_MARKER_LENGTH) * 2
  ) {
    return chalk.bold(
      chalk.italic(
        parseMarkdownToANSI(
          fullMatch.slice(
            BOLD_MARKER_LENGTH + ITALIC_MARKER_LENGTH,
            -BOLD_MARKER_LENGTH - ITALIC_MARKER_LENGTH,
          ),
          baseColor,
        ),
      ),
    );
  }
  if (
    fullMatch.endsWith('**') &&
    fullMatch.startsWith('**') &&
    fullMatch.length > BOLD_MARKER_LENGTH * 2
  ) {
    return chalk.bold(
      parseMarkdownToANSI(fullMatch.slice(BOLD_MARKER_LENGTH, -BOLD_MARKER_LENGTH), baseColor),
    );
  }
  if (
    fullMatch.startsWith('~~') &&
    fullMatch.endsWith('~~') &&
    fullMatch.length > STRIKETHROUGH_MARKER_LENGTH * 2
  ) {
    return chalk.strikethrough(
      parseMarkdownToANSI(
        fullMatch.slice(STRIKETHROUGH_MARKER_LENGTH, -STRIKETHROUGH_MARKER_LENGTH),
        baseColor,
      ),
    );
  }
  return undefined;
}

function styleItalic(
  fullMatch: string,
  baseColor: string,
  text: string,
  matchIndex: number,
  inlineRegexLastIndex: number,
): string | undefined {
  if (
    fullMatch.length > ITALIC_MARKER_LENGTH * 2 &&
    ((fullMatch.startsWith('*') && fullMatch.endsWith('*')) ||
      (fullMatch.startsWith('_') && fullMatch.endsWith('_'))) &&
    !/\w/.test(text.substring(matchIndex - 1, matchIndex)) &&
    !/\w/.test(text.substring(inlineRegexLastIndex, inlineRegexLastIndex + 1)) &&
    !/\S[./\\]/.test(text.substring(matchIndex - 2, matchIndex)) &&
    !/[./\\]\S/.test(text.substring(inlineRegexLastIndex, inlineRegexLastIndex + 2))
  ) {
    return chalk.italic(
      parseMarkdownToANSI(fullMatch.slice(ITALIC_MARKER_LENGTH, -ITALIC_MARKER_LENGTH), baseColor),
    );
  }
  return undefined;
}

function styleCodeAndLink(fullMatch: string, baseColor: string): string | undefined {
  if (
    fullMatch.startsWith('`') &&
    fullMatch.endsWith('`') &&
    fullMatch.length > INLINE_CODE_MARKER_LENGTH
  ) {
    const codeMatch = fullMatch.match(/^(`+)([^`]+)\1$/);
    if (codeMatch && codeMatch[2]) {
      return ansiColorize(codeMatch[2], theme.text.accent);
    }
  }
  if (fullMatch.startsWith('[') && fullMatch.includes('](') && fullMatch.endsWith(')')) {
    const linkMatch = fullMatch.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch && linkMatch[1] && linkMatch[2]) {
      return (
        parseMarkdownToANSI(linkMatch[1], baseColor) +
        ansiColorize(' (', baseColor) +
        ansiColorize(linkMatch[2], theme.text.link) +
        ansiColorize(')', baseColor)
      );
    }
  }
  return undefined;
}

function styleInlineMarkdown(
  fullMatch: string,
  baseColor: string,
  text: string,
  matchIndex: number,
  inlineRegexLastIndex: number,
): string {
  try {
    const boldItalic = styleBoldItalicStrikethrough(fullMatch, baseColor);
    if (boldItalic !== undefined) return boldItalic;

    const italic = styleItalic(fullMatch, baseColor, text, matchIndex, inlineRegexLastIndex);
    if (italic !== undefined) return italic;

    const codeOrLink = styleCodeAndLink(fullMatch, baseColor);
    if (codeOrLink !== undefined) return codeOrLink;

    if (
      fullMatch.startsWith('<u>') &&
      fullMatch.endsWith('</u>') &&
      fullMatch.length > UNDERLINE_TAG_START_LENGTH + UNDERLINE_TAG_END_LENGTH - 1
    ) {
      return chalk.underline(
        parseMarkdownToANSI(
          fullMatch.slice(UNDERLINE_TAG_START_LENGTH, -UNDERLINE_TAG_END_LENGTH),
          baseColor,
        ),
      );
    }
    if (fullMatch.startsWith('http://') || fullMatch.startsWith('https://')) {
      return ansiColorize(fullMatch, theme.text.link);
    }
  } catch (e) {
    debugLogger.warn('Error parsing inline markdown part:', fullMatch, e);
    return '';
  }
  return '';
}

const INLINE_PATTERNS = [
  /`[^`\n]+`/,
  /\*{3}[^*\n]+\*{3}/,
  /\*{2}[^*\n]+\*{2}/,
  /\*[^*\n]+\*/,
  /_[^_\n]+_/,
  /~~[^~\n]+~~/,
  /<u>[^<\n]+<\/u>/,
];

function findEarliestHttp(sub: string): { index: number; match: string } | null {
  const httpIdx = sub.indexOf('http');
  if (httpIdx === -1) return null;
  let spaceIdx = sub.indexOf(' ', httpIdx);
  if (spaceIdx === -1) spaceIdx = sub.length;
  return { index: httpIdx, match: sub.slice(httpIdx, spaceIdx) };
}

function findEarliestLink(sub: string): { index: number; match: string } | null {
  const linkIdx = sub.indexOf('[');
  if (linkIdx === -1) return null;
  const closeBracket = sub.indexOf('](', linkIdx + 1);
  if (closeBracket === -1) return null;
  const closeParen = sub.indexOf(')', closeBracket + 2);
  if (closeParen === -1) return null;
  return { index: linkIdx, match: sub.slice(linkIdx, closeParen + 1) };
}

function findEarliestMatch(
  text: string,
  startIndex: number,
): { index: number; match: string } | null {
  const sub = text.slice(startIndex);
  let earliestIndex = -1;
  let earliestMatch = '';

  const httpRes = findEarliestHttp(sub);
  if (httpRes) {
    earliestIndex = httpRes.index;
    earliestMatch = httpRes.match;
  }

  const linkRes = findEarliestLink(sub);
  if (linkRes && (earliestIndex === -1 || linkRes.index < earliestIndex)) {
    earliestIndex = linkRes.index;
    earliestMatch = linkRes.match;
  }

  for (const pattern of INLINE_PATTERNS) {
    const m = pattern.exec(sub);
    if (m && m.index !== undefined && (earliestIndex === -1 || m.index < earliestIndex)) {
      earliestIndex = m.index;
      earliestMatch = m[0];
    }
  }

  if (earliestIndex === -1) return null;
  return { index: startIndex + earliestIndex, match: earliestMatch };
}

export const parseMarkdownToANSI = (rawText: string, defaultColor?: string): string => {
  const baseColor = defaultColor ?? theme.text.primary;
  const text = convertLatexPreservingSpans(rawText);
  if (!/[*_~`<[ht:]/.test(text)) {
    return ansiColorize(text, baseColor);
  }

  let result = '';
  let currentIndex = 0;

  while (currentIndex < text.length) {
    const matchInfo = findEarliestMatch(text, currentIndex);
    if (!matchInfo) {
      result += ansiColorize(text.slice(currentIndex), baseColor);
      break;
    }

    if (matchInfo.index > currentIndex) {
      result += ansiColorize(text.slice(currentIndex, matchInfo.index), baseColor);
    }

    const nextIndex = matchInfo.index + matchInfo.match.length;
    const styledPart = styleInlineMarkdown(
      matchInfo.match,
      baseColor,
      text,
      matchInfo.index,
      nextIndex,
    );
    result += styledPart || ansiColorize(matchInfo.match, baseColor);
    currentIndex = nextIndex;
  }

  return result;
};
