import { describe, it, expect, afterEach } from '@jest/globals';
import { computeTerminalTitle } from '../../../tui/utils/windowTitle.js';
import { StreamingState } from '../../../tui/ui/types/streamingState.js';

const baseOptions = {
  streamingState: StreamingState.Idle,
  thoughtSubject: undefined as string | undefined,
  isConfirming: false,
  isSilentWorking: false,
  folderName: 'HIVE-MIND-RAILWAY',
  showThoughts: true,
  useDynamicTitle: true,
};

describe('computeTerminalTitle - 🐝 Hive Mind branding', () => {
  afterEach(() => {
    delete process.env['CLI_TITLE'];
  });

  it('static title starts with 🐝 Hive Mind and shows the folder context', () => {
    const title = computeTerminalTitle({ ...baseOptions, useDynamicTitle: false });
    expect(title.startsWith('🐝 Hive Mind (HIVE-MIND-RAILWAY)')).toBe(true);
  });

  it('idle state shows 🐝 Hive Mind — ◇ Ready', () => {
    const title = computeTerminalTitle(baseOptions);
    expect(title).toContain('🐝 Hive Mind — ◇  Ready (HIVE-MIND-RAILWAY)');
  });

  it('confirmation state shows 🐝 Hive Mind — ✋ Action Required', () => {
    const title = computeTerminalTitle({ ...baseOptions, isConfirming: true });
    expect(title).toContain('🐝 Hive Mind — ✋  Action Required (HIVE-MIND-RAILWAY)');
  });

  it('silent working state shows 🐝 Hive Mind — ⏲ Working…', () => {
    const title = computeTerminalTitle({ ...baseOptions, isSilentWorking: true });
    expect(title).toContain('🐝 Hive Mind — ⏲  Working… (HIVE-MIND-RAILWAY)');
  });

  it('active state shows 🐝 Hive Mind — ✦ thought subject', () => {
    const title = computeTerminalTitle({
      ...baseOptions,
      streamingState: StreamingState.Responding,
      thoughtSubject: 'Refactoring the header',
    });
    expect(title).toContain('🐝 Hive Mind — ✦  Refactoring the header (HIVE-MIND-RAILWAY)');
  });

  it('waiting-for-confirmation streaming state maps to Action Required', () => {
    const title = computeTerminalTitle({
      ...baseOptions,
      streamingState: StreamingState.WaitingForConfirmation,
    });
    expect(title).toContain('🐝 Hive Mind — ✋  Action Required');
  });

  it('strips control characters and always pads to exactly 80 chars', () => {
    const title = computeTerminalTitle({ ...baseOptions, folderName: 'evil\nfolder' });
    const hasControlChar = title.split('').some((ch) => {
      const code = ch.charCodeAt(0);
      return (code >= 0 && code <= 31) || code === 127;
    });
    expect(hasControlChar).toBe(false);
    expect(title).toHaveLength(80);
  });

  it('CLI_TITLE env var overrides the folder context', () => {
    process.env['CLI_TITLE'] = 'custom-session';
    const title = computeTerminalTitle(baseOptions);
    expect(title).toContain('(custom-session)');
  });
});
