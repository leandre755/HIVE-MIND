import { describe, it, expect } from '@jest/globals';
import {
  isExplorationMessage,
  collapseMessages,
  Message,
} from '../../../utils/collapseReadSearch.js';

describe('collapseReadSearch', () => {
  describe('isExplorationMessage', () => {
    it('should return true for exploration message signatures', () => {
      expect(isExplorationMessage('[DIR] src')).toBe(true);
      expect(isExplorationMessage('[FILE] index.ts')).toBe(true);
      expect(isExplorationMessage('Running list_directory tool')).toBe(true);
      expect(isExplorationMessage('Using Ripgrep (rg)')).toBe(true);
      expect(isExplorationMessage('📝 *File modified*: `SearchTools.ts`')).toBe(true);
    });

    it('should return false for regular messages', () => {
      expect(isExplorationMessage('Hello world')).toBe(false);
      expect(isExplorationMessage('I have completed my thinking.')).toBe(false);
      expect(isExplorationMessage('Here is the plan for tomorrow.')).toBe(false);
    });
  });

  describe('collapseMessages', () => {
    it('should preserve regular messages untouched', () => {
      const messages: Message[] = [
        { id: '1', sender: 'user', text: 'Hello' },
        { id: '2', sender: 'agent', text: 'Hi, how can I help you?' },
      ];

      const result = collapseMessages(messages);
      expect(result).toEqual(messages);
    });

    it('should not collapse a single exploration message', () => {
      const messages: Message[] = [
        { id: '1', sender: 'user', text: 'Hello' },
        { id: '2', sender: 'agent', text: '📝 *File read*: `src/utils/readFileInRange.ts`' },
      ];

      const result = collapseMessages(messages);
      expect(result).toEqual(messages);
    });

    it('should collapse consecutive exploration messages into a single summary', () => {
      const messages: Message[] = [
        { id: '1', sender: 'user', text: 'Explore codebase' },
        { id: '2', sender: 'agent', text: '📂 *Directory list*: `src/`' },
        { id: '3', sender: 'agent', text: '[DIR] utils\n[FILE] index.ts' }, // treated as list_directory output
        {
          id: '4',
          sender: 'agent',
          text: '🔍 *Search* grep_search: query `readFileInRange` in `src/`',
        },
        { id: '5', sender: 'agent', text: '📝 *File read*: `src/utils/readFileInRange.ts`' },
        { id: '6', sender: 'agent', text: 'Hi, I found the file!' },
      ];

      const result = collapseMessages(messages);

      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('1'); // User message

      // Collapsed message
      expect(result[1].sender).toBe('agent');
      expect(result[1].text).toContain('Completed 4 actions');
      expect(result[1].text).toContain('1 folder listing');
      expect(result[1].text).toContain('1 grep search');
      expect(result[1].text).toContain('1 file read');
      expect(result[1].text).toContain('Touched: readFileInRange.ts');

      // Regular agent message at the end
      expect(result[2].id).toBe('6');
    });
  });
});
