import type React from 'react';
import { Text, useIsScreenReaderEnabled } from 'ink';
import type { SpinnerName } from 'cli-spinners';
import { useStreamingContext } from '../contexts/StreamingContext.js';
import { StreamingState } from '../contexts/UIStateContext.js';
import { SCREEN_READER_LOADING, SCREEN_READER_RESPONDING } from '../textConstants.js';
import { theme } from '../semantic-colors.js';
import { HiveSpinner } from './HiveSpinner.js';

interface HiveRespondingSpinnerProps {
  /**
   * Optional string to display when not in Responding state.
   * If not provided and not Responding, renders null.
   */
  nonRespondingDisplay?: string;
  spinnerType?: SpinnerName;
  /**
   * If true, we prioritize showing the nonRespondingDisplay (hook icon)
   * even if the state is Responding.
   */
  isHookActive?: boolean;
  color?: string;
}

export const HiveRespondingSpinner: React.FC<HiveRespondingSpinnerProps> = ({
  nonRespondingDisplay,
  spinnerType = 'dots',
  isHookActive = false,
  color,
}) => {
  const streamingState = useStreamingContext();
  const isScreenReaderEnabled = useIsScreenReaderEnabled();

  if (streamingState === StreamingState.Responding && !isHookActive) {
    return <HiveSpinner spinnerType={spinnerType} altText={SCREEN_READER_RESPONDING} />;
  }

  if (nonRespondingDisplay) {
    return isScreenReaderEnabled ? (
      <Text>{SCREEN_READER_LOADING}</Text>
    ) : (
      <Text color={color ?? theme.text.primary}>{nonRespondingDisplay}</Text>
    );
  }

  return null;
};
