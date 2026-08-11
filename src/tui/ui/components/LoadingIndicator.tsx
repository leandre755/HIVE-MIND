import { ThoughtSummary, formatDuration } from '../utils/formatters.js';
import type React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { useStreamingContext } from '../contexts/StreamingContext.js';
import { StreamingState } from '../contexts/UIStateContext.js';
import { HiveRespondingSpinner } from './HiveRespondingSpinner.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { isNarrowWidth } from '../utils/isNarrowWidth.js';
import { INTERACTIVE_SHELL_WAITING_PHRASE } from '../hooks/usePhraseCycler.js';

interface LoadingIndicatorProps {
  currentLoadingPhrase?: string;
  wittyPhrase?: string;
  showWit?: boolean;
  showTips?: boolean;
  errorVerbosity?: 'low' | 'full';
  elapsedTime: number;
  inline?: boolean;
  rightContent?: React.ReactNode;
  thought?: ThoughtSummary | null;
  thoughtLabel?: string;
  showCancelAndTimer?: boolean;
  forceRealStatusOnly?: boolean;
  spinnerIcon?: string;
  isHookActive?: boolean;
}

const resolvePrimaryText = (
  currentLoadingPhrase: string | undefined,
  thought: ThoughtSummary | null | undefined,
  thoughtLabel: string | undefined,
  streamingState: StreamingState,
): string | undefined => {
  if (currentLoadingPhrase === INTERACTIVE_SHELL_WAITING_PHRASE) {
    return currentLoadingPhrase;
  }
  if (thought?.subject) {
    return thoughtLabel ?? thought.subject;
  }
  if (currentLoadingPhrase) {
    return currentLoadingPhrase;
  }
  if (streamingState === StreamingState.Responding) {
    return 'Thinking...';
  }
  return undefined;
};

const getSpinnerIcon = (spinnerIcon: string | undefined, streamingState: StreamingState): string =>
  spinnerIcon ?? (streamingState === StreamingState.WaitingForConfirmation ? '⠏' : '');

const renderPrimaryTextBlock = (primaryText: string | undefined): React.ReactNode => {
  if (!primaryText) return null;
  const shellWaiting = primaryText === INTERACTIVE_SHELL_WAITING_PHRASE;
  return (
    <Box flexShrink={1}>
      <Text color={theme.text.primary} italic wrap="truncate-end">
        {primaryText}
      </Text>
      {shellWaiting && (
        <Text color={theme.ui.active} italic>
          {' '}
          (press tab to focus)
        </Text>
      )}
    </Box>
  );
};

const renderCancelAndTimer = (
  showCancelAndTimer: boolean,
  streamingState: StreamingState,
  elapsedTime: number,
): string | null => {
  if (!showCancelAndTimer || streamingState !== StreamingState.Responding) {
    return null;
  }
  const time = elapsedTime < 60 ? `${elapsedTime}s` : formatDuration(elapsedTime * 1000);
  return `(esc to cancel, ${time})`;
};

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  currentLoadingPhrase,
  wittyPhrase,
  showWit = false,
  elapsedTime,
  inline = false,
  rightContent,
  thought,
  thoughtLabel,
  showCancelAndTimer = true,
  forceRealStatusOnly = false,
  spinnerIcon,
  isHookActive = false,
}) => {
  const streamingState = useStreamingContext();
  const { columns: terminalWidth } = useTerminalSize();
  const isNarrow = isNarrowWidth(terminalWidth);

  if (streamingState === StreamingState.Idle && !currentLoadingPhrase && !thought) {
    return null;
  }

  const primaryText = resolvePrimaryText(
    currentLoadingPhrase,
    thought,
    thoughtLabel,
    streamingState,
  );

  const cancelAndTimerContent = renderCancelAndTimer(
    showCancelAndTimer,
    streamingState,
    elapsedTime,
  );

  const wittyPhraseNode =
    !forceRealStatusOnly && showWit && wittyPhrase && primaryText === 'Thinking...' ? (
      <Box marginLeft={1}>
        <Text color={theme.text.secondary} dimColor italic>
          {wittyPhrase}
        </Text>
      </Box>
    ) : null;

  const spinner = getSpinnerIcon(spinnerIcon, streamingState);

  if (inline) {
    return (
      <Box>
        <Box marginRight={1}>
          <HiveRespondingSpinner nonRespondingDisplay={spinner} isHookActive={isHookActive} />
        </Box>
        {renderPrimaryTextBlock(primaryText)}
        {cancelAndTimerContent && (
          <>
            <Box flexShrink={0} width={1} />
            <Text color={theme.text.secondary}>{cancelAndTimerContent}</Text>
          </>
        )}
        {wittyPhraseNode}
      </Box>
    );
  }

  return (
    <Box paddingLeft={0} flexDirection="column">
      <Box
        width="100%"
        flexDirection={isNarrow ? 'column' : 'row'}
        alignItems={isNarrow ? 'flex-start' : 'center'}
      >
        <Box>
          <Box marginRight={1}>
            <HiveRespondingSpinner nonRespondingDisplay={spinner} isHookActive={isHookActive} />
          </Box>
          {renderPrimaryTextBlock(primaryText)}
          {!isNarrow && cancelAndTimerContent && (
            <>
              <Box flexShrink={0} width={1} />
              <Text color={theme.text.secondary}>{cancelAndTimerContent}</Text>
            </>
          )}
          {!isNarrow && wittyPhraseNode}
        </Box>
        {!isNarrow && <Box flexGrow={1}>{/* Spacer */}</Box>}
        {!isNarrow && rightContent && <Box>{rightContent}</Box>}
      </Box>
      {isNarrow && cancelAndTimerContent && (
        <Box>
          <Text color={theme.text.secondary}>{cancelAndTimerContent}</Text>
        </Box>
      )}
      {isNarrow && wittyPhraseNode}
      {isNarrow && rightContent && <Box>{rightContent}</Box>}
    </Box>
  );
};
