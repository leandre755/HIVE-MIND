import { describe, it, expect } from '@jest/globals';
import { splitMessage, getToolFeedback, TOOL_FEEDBACK } from '../../../utils/messageSplitter.js';

describe('messageSplitter', () => {
  describe('splitMessage', () => {
    it('should return empty array for null or empty input', () => {
      expect(splitMessage(null)).toEqual([]);
      expect(splitMessage('')).toEqual([]);
    });

    it('should return single element array when message is shorter than maxLength', () => {
      const result = splitMessage('Short text', 100);
      expect(result).toEqual(['Short text']);
    });

    it('should split long message by markdown separator ---', () => {
      const text = 'Section 1 content\n---\nSection 2 content';
      const result = splitMessage(text, 20);
      expect(result).toHaveLength(2);
      expect(result[0]).toBe('Section 1 content');
      expect(result[1]).toBe('Section 2 content');
    });

    it('should split long text by paragraphs when no markdown separator is found', () => {
      const p1 = 'First paragraph with some text.';
      const p2 = 'Second paragraph with more text.';
      const text = `${p1}\n\n${p2}`;
      const result = splitMessage(text, 35);
      expect(result).toContain(p1);
      expect(result).toContain(p2);
    });

    it('should split long paragraph by sentences as fallback', () => {
      const s1 = 'Sentence one is here.';
      const s2 = 'Sentence two is long.';
      const text = `${s1} ${s2}`;
      const result = splitMessage(text, 25);
      expect(result.length).toBeGreaterThan(1);
    });
  });

  describe('getToolFeedback', () => {
    it('should return custom feedback message for known tool', () => {
      expect(getToolFeedback('duckduck_search')).toBe('🔍 Je cherche sur le web...');
      expect(getToolFeedback('generate_image')).toBe('🖼️ Je génère une image...');
    });

    it('should return default fallback message for unknown tool', () => {
      expect(getToolFeedback('unknown_tool')).toBe(TOOL_FEEDBACK['_default']);
    });
  });
});
