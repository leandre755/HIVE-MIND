import { handleVimAction } from '../../../tui/ui/components/shared/vim-buffer-actions.js';
import type { TextBufferState } from '../../../tui/ui/components/shared/text-buffer.js';

describe('vim-buffer-actions pure state transitions', () => {
  const createInitialState = (lines: string[] = ['hello world']): TextBufferState => ({
    lines,
    cursorRow: 0,
    cursorCol: 0,
    transformationsByLine: lines.map(() => []),
    preferredCol: null,
    undoStack: [],
    redoStack: [],
    clipboard: null,
    selectionAnchor: null,
    viewportWidth: 80,
    viewportHeight: 24,
    visualLayout: {
      visualLines: lines,
      logicalToVisualMap: lines.map((_, i) => [[i, 0]]),
      visualToLogicalMap: lines.map((_, i) => [i, 0]),
      transformedToLogicalMaps: lines.map((l) => Array.from({ length: l.length }, (_, k) => k)),
      visualToTransformedMap: lines.map(() => 0),
    },
    pastedContent: {},
    expandedPaste: null,
    yankRegister: null,
  });

  it('handles vim movement action: word-forward (vim_move_word_forward)', () => {
    const initialState = createInitialState(['hello world']);
    const nextState = handleVimAction(initialState, {
      type: 'vim_move_word_forward',
      payload: { count: 1 },
    });
    expect(nextState.cursorCol).toBe(6);
  });

  it('handles vim movement action: word-backward (vim_move_word_backward)', () => {
    const initialState = createInitialState(['hello world']);
    initialState.cursorCol = 6;
    const nextState = handleVimAction(initialState, {
      type: 'vim_move_word_backward',
      payload: { count: 1 },
    });
    expect(nextState.cursorCol).toBe(0);
  });

  it('handles vim deletion action: delete-character (vim_delete_char)', () => {
    const initialState = createInitialState(['hello world']);
    const nextState = handleVimAction(initialState, {
      type: 'vim_delete_char',
      payload: { count: 1 },
    });
    expect(nextState.lines[0]).toBe('ello world');
  });

  it('handles vim delete-word action (vim_delete_word_forward)', () => {
    const initialState = createInitialState(['hello world']);
    const nextState = handleVimAction(initialState, {
      type: 'vim_delete_word_forward',
      payload: { count: 1 },
    });
    expect(nextState.lines[0]).toBe('world');
  });
});
