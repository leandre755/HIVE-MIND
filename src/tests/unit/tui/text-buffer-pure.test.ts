import {
  isWordCharStrict,
  isWhitespace,
  isCombiningMark,
  isWordCharWithCombining,
  getCharScript,
  isDifferentScript,
  findNextWordStartInLine,
  findPrevWordStartInLine,
  findWordEndInLine,
  findNextBigWordStartInLine,
  findPrevBigWordStartInLine,
  findBigWordEndInLine,
  offsetToLogicalPos,
  logicalPosToOffset,
  expandPastePlaceholders,
  getPositionFromOffsets,
  getLineRangeOffsets,
  getTransformedImagePath,
} from '../../../tui/ui/components/shared/text-buffer.js';

describe('text-buffer pure functions', () => {
  describe('Character classification helpers', () => {
    it('identifies strict word characters correctly', () => {
      expect(isWordCharStrict('a')).toBe(true);
      expect(isWordCharStrict('Z')).toBe(true);
      expect(isWordCharStrict('9')).toBe(true);
      expect(isWordCharStrict('_')).toBe(true);
      expect(isWordCharStrict('é')).toBe(true);
      expect(isWordCharStrict(' ')).toBe(false);
      expect(isWordCharStrict('!')).toBe(false);
    });

    it('identifies whitespace correctly', () => {
      expect(isWhitespace(' ')).toBe(true);
      expect(isWhitespace('\t')).toBe(true);
      expect(isWhitespace('\n')).toBe(true);
      expect(isWhitespace('a')).toBe(false);
    });

    it('identifies combining marks', () => {
      // U+0301 Combining Acute Accent
      expect(isCombiningMark('\u0301')).toBe(true);
      expect(isCombiningMark('a')).toBe(false);
    });

    it('identifies word char with combining mark', () => {
      expect(isWordCharWithCombining('a')).toBe(true);
      expect(isWordCharWithCombining('a\u0301')).toBe(true);
      expect(isWordCharWithCombining(' ')).toBe(false);
    });

    it('determines char script and script differences', () => {
      expect(getCharScript('a')).toBe('latin');
      expect(getCharScript(' ')).toBe('other');
      expect(isDifferentScript('a', 'b')).toBe(false);
      expect(isDifferentScript('a', 'б')).toBe(true);
      expect(isDifferentScript('a', ' ')).toBe(false);
    });
  });

  describe('Word boundary movement helpers', () => {
    it('finds next word start in line', () => {
      const line = 'hello world foo_bar';
      expect(findNextWordStartInLine(line, 0)).toBe(6);
      expect(findNextWordStartInLine(line, 6)).toBe(12);
      expect(findNextWordStartInLine(line, 19)).toBeNull();
    });

    it('finds previous word start in line', () => {
      const line = 'hello world foo_bar';
      expect(findPrevWordStartInLine(line, 12)).toBe(6);
      expect(findPrevWordStartInLine(line, 6)).toBe(0);
      expect(findPrevWordStartInLine(line, 0)).toBeNull();
    });

    it('finds word end in line', () => {
      const line = 'hello world';
      expect(findWordEndInLine(line, 0)).toBe(4);
      expect(findWordEndInLine(line, 6)).toBe(10);
    });

    it('finds big word boundaries (blank-delimited)', () => {
      const line = 'hello.world foo-bar!';
      expect(findNextBigWordStartInLine(line, 0)).toBe(12);
      expect(findPrevBigWordStartInLine(line, 12)).toBe(0);
      expect(findBigWordEndInLine(line, 0)).toBe(10);
    });

    it('handles unicode emoji and combining characters gracefully', () => {
      const line = 'hello 🚀 world';
      expect(findNextWordStartInLine(line, 0)).toBe(6);
      expect(findPrevWordStartInLine(line, 8)).toBe(6);
    });
  });

  describe('Offset and logical position conversions', () => {
    const text = 'hello\nworld\nfoo';
    const lines = ['hello', 'world', 'foo'];

    it('converts offset to logical position [row, col]', () => {
      expect(offsetToLogicalPos(text, 0)).toEqual([0, 0]);
      expect(offsetToLogicalPos(text, 5)).toEqual([0, 5]);
      expect(offsetToLogicalPos(text, 6)).toEqual([1, 0]);
      expect(offsetToLogicalPos(text, 12)).toEqual([2, 0]);
    });

    it('converts logical position to offset', () => {
      expect(logicalPosToOffset(lines, 0, 0)).toBe(0);
      expect(logicalPosToOffset(lines, 0, 5)).toBe(5);
      expect(logicalPosToOffset(lines, 1, 0)).toBe(6);
      expect(logicalPosToOffset(lines, 2, 3)).toBe(15);
    });

    it('gets line range offsets correctly', () => {
      expect(getLineRangeOffsets(0, 2, lines)).toEqual({ startOffset: 0, endOffset: 12 });
    });

    it('gets position range from offsets', () => {
      expect(getPositionFromOffsets(0, 11, lines)).toEqual({
        startRow: 0,
        startCol: 0,
        endRow: 1,
        endCol: 5,
      });
    });
  });

  describe('Paste placeholder expansion and image path transformations', () => {
    it('expands paste placeholders', () => {
      const placeholder = '[Pasted Text: 2 lines]';
      const expandedMap = { [placeholder]: 'pasted content line 1\nline 2' };
      const text = `before ${placeholder} after`;
      expect(expandPastePlaceholders(text, expandedMap)).toBe(
        'before pasted content line 1\nline 2 after',
      );
    });

    it('transforms image path correctly', () => {
      expect(getTransformedImagePath('/path/to/img.png')).toBe('[Image img.png]');
    });
  });
});
