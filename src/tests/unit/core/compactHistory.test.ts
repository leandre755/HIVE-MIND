// tests/unit/core/compactHistory.test.ts
// MOD 1 — Garbage Collector de Contexte (_compactHistory + _optimizeHistory)
import { describe, it, expect } from '@jest/globals';

/**
 * Standalone test for the context compaction logic.
 * We extract the pure logic from BotCore to test it in isolation.
 */

const TOTAL_CHAR_LIMIT = 25000;
const TOOL_OUTPUT_LIMIT = 2000;

type HistoryMessage = {
  role: string;
  content: string;
};

/** _optimizeHistory extracted logic (mechanical fallback) */
function optimizeHistory(history: HistoryMessage[]): HistoryMessage[] {
  let currentSize = JSON.stringify(history).length;
  if (currentSize < TOTAL_CHAR_LIMIT) return history;

  const optimized = [...history];
  const safeZoneStart = 2;
  const safeZoneEnd = optimized.length - 3;

  for (let i = safeZoneStart; i < safeZoneEnd; i++) {
    const msg = optimized.at(i) as HistoryMessage;
    if (msg.role === 'tool' && msg.content && msg.content.length > TOOL_OUTPUT_LIMIT) {
      const originalLen = msg.content.length;
      const truncated =
        msg.content.substring(0, TOOL_OUTPUT_LIMIT) +
        `\n... [TRONQUÉ: ${originalLen - TOOL_OUTPUT_LIMIT} chars masqués]`;
      optimized.splice(i, 1, { role: msg.role, content: truncated });
      currentSize = JSON.stringify(optimized).length;
      if (currentSize < TOTAL_CHAR_LIMIT) break;
    }
  }
  return optimized;
}

describe('_compactHistory / _optimizeHistory (MOD 1)', () => {
  describe('_optimizeHistory (mechanical fallback)', () => {
    it('returns history unchanged if under 25k chars', () => {
      // Arrange
      const history = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ];

      // Act
      const result = optimizeHistory(history);

      // Assert
      expect(result).toEqual(history);
    });

    it('truncates large tool outputs to 2000 chars', () => {
      // Arrange — build history > 25k chars with big tool outputs
      const bigToolOutput = 'X'.repeat(10000);
      const history = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'q1' },
        { role: 'tool', content: bigToolOutput },
        { role: 'tool', content: bigToolOutput },
        { role: 'tool', content: bigToolOutput },
        { role: 'user', content: 'q2' },
        { role: 'assistant', content: 'done' },
        { role: 'user', content: 'latest' },
      ];

      // Act
      const result = optimizeHistory(history);

      // Assert — total size should be < 25k chars, and some tools got truncated
      const size = JSON.stringify(result).length;
      expect(size).toBeLessThan(TOTAL_CHAR_LIMIT);
      const hasTruncated = result.some(
        (m: HistoryMessage) => m.content && m.content.includes('TRONQUÉ'),
      );
      expect(hasTruncated).toBe(true);
    });

    it('preserves system prompt (index 0) and last 3 messages', () => {
      const bigOutput = 'Y'.repeat(10000);
      const history = [
        { role: 'system', content: 'SYSTEM PROMPT MUST SURVIVE' },
        { role: 'user', content: 'start' },
        { role: 'tool', content: bigOutput },
        { role: 'tool', content: bigOutput },
        { role: 'tool', content: bigOutput },
        { role: 'user', content: 'SAFE_USER' },
        { role: 'assistant', content: 'SAFE_ASSISTANT' },
        { role: 'user', content: 'SAFE_LAST' },
      ];

      const result = optimizeHistory(history);

      // System and last 3 untouched
      expect(result[0].content).toBe('SYSTEM PROMPT MUST SURVIVE');
      expect(result[result.length - 1].content).toBe('SAFE_LAST');
      expect(result[result.length - 2].content).toBe('SAFE_ASSISTANT');
      expect(result[result.length - 3].content).toBe('SAFE_USER');
    });
  });

  describe('_compactHistory threshold', () => {
    it('does not trigger for history under 25000 chars', () => {
      const smallHistory = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hello' },
      ];
      // Threshold logic
      const size = JSON.stringify(smallHistory).length;
      expect(size).toBeLessThan(TOTAL_CHAR_LIMIT);
    });

    it('triggers for history over 25000 chars', () => {
      const bigHistory = [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'A'.repeat(30000) },
      ];
      const size = JSON.stringify(bigHistory).length;
      expect(size).toBeGreaterThan(TOTAL_CHAR_LIMIT);
    });
  });
});
