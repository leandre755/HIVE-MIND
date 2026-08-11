import { type DOMElement, measureElement } from 'ink';
import { useEffect } from 'react';
import { useConfig } from '../contexts/ConfigContext.js';
import { recordFlickerFrame, useUIState } from '../contexts/UIStateContext.js';
import { appEvents, AppEvent } from '../../utils/events.js';

/**
 * A hook that detects when the UI flickers (renders taller than the terminal).
 * This is a sign of a rendering bug that should be fixed.
 *
 * @param rootUiRef A ref to the root UI element.
 * @param terminalHeight The height of the terminal.
 */
export function useFlickerDetector(
  rootUiRef: React.RefObject<DOMElement | null>,
  terminalHeight: number,
) {
  useConfig();
  const { constrainHeight } = useUIState();

  useEffect(() => {
    if (rootUiRef.current) {
      const measurement = measureElement(rootUiRef.current);
      if (measurement.height > terminalHeight) {
        if (!constrainHeight) {
          return;
        }

        recordFlickerFrame();
        appEvents.emit(AppEvent.Flicker);
      }
    }
  }, [rootUiRef, terminalHeight, constrainHeight]);
}
