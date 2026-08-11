import { jest, describe, beforeEach, it, expect } from '@jest/globals';

type BrowserSnapshotFn = (
  session?: string,
  interactiveOnly?: boolean,
) => Promise<{
  readonly success: boolean;
  snapshot: string;
  readonly refs: Record<string, unknown>;
}>;

const getSessionNameMock = jest.fn<(chatId: string) => string>();
const snapshotMock = jest.fn<BrowserSnapshotFn>();

jest.unstable_mockModule('../../../services/browser/BrowserService.js', () => ({
  browserService: {
    getSessionName: getSessionNameMock,
    snapshot: snapshotMock,
  },
}));

const { default: BrowserTools } = await import('../../../plugins/base/dev_tools/BrowserTools.js');

describe('BrowserTools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getSessionNameMock.mockReturnValue('session_chat_1');
  });

  describe('browser_snapshot', () => {
    it('should truncate large snapshots before returning them to the LLM context', async () => {
      // Arrange
      snapshotMock.mockResolvedValue({
        success: true,
        snapshot: 'A'.repeat(20_000),
        refs: {},
      });
      const context = { chatId: 'chat_1' };

      // Act
      const result = await BrowserTools.execute({}, context, 'browser_snapshot');

      // Assert
      expect(result.success).toBe(true);
      const snapResult = result.llmOutput as { snapshot: string };
      expect(snapResult.snapshot).toContain('[TRUNCATED]');
      expect(snapResult.snapshot.length).toBeLessThanOrEqual(12_200);
    });
  });
});
