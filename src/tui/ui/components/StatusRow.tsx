import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Text, type DOMElement } from 'ink';
import { useMouseClick } from '../hooks/useMouseClick.js';
import { hiveCoreConnection, type ActiveServiceInfo } from '../../core/connection.js';

import { ThoughtSummary } from '../utils/formatters.js';
import {
  isUserVisibleHook,
  type ActiveHook,
  useUIState,
  ApprovalMode,
} from '../contexts/UIStateContext.js';
import stripAnsi from 'strip-ansi';
import { useSettings } from '../contexts/SettingsContext.js';

import { theme } from '../semantic-colors.js';
import { GENERIC_WORKING_LABEL } from '../textConstants.js';
import { INTERACTIVE_SHELL_WAITING_PHRASE } from '../hooks/usePhraseCycler.js';
import { LoadingIndicator } from './LoadingIndicator.js';
import { StatusDisplay } from './StatusDisplay.js';
import { ContextUsageDisplay } from './ContextUsageDisplay.js';
import { HorizontalLine } from './shared/HorizontalLine.js';
import { ApprovalModeIndicator } from './ApprovalModeIndicator.js';
import { ShellModeIndicator } from './ShellModeIndicator.js';
import { RawMarkdownIndicator } from './RawMarkdownIndicator.js';
import { useComposerStatus } from '../hooks/useComposerStatus.js';

/**
 * Layout constants to prevent magic numbers.
 */
const LAYOUT = {
  STATUS_MIN_HEIGHT: 1,
  TIP_LEFT_MARGIN: 2,
  TIP_RIGHT_MARGIN_NARROW: 0,
  TIP_RIGHT_MARGIN_WIDE: 1,
  INDICATOR_LEFT_MARGIN: 1,
  CONTEXT_DISPLAY_TOP_MARGIN_NARROW: 1,
  CONTEXT_DISPLAY_LEFT_MARGIN_NARROW: 1,
  CONTEXT_DISPLAY_LEFT_MARGIN_WIDE: 0,
  COLLISION_GAP: 10,
};

interface StatusRowProps {
  showUiDetails: boolean;
  isNarrow: boolean;
  terminalWidth: number;
  hideContextSummary: boolean;
  hideUiDetailsForSuggestions: boolean;
  hasPendingActionRequired: boolean;
}

/**
 * Renders the loading or hook execution status.
 */
export const StatusNode: React.FC<{
  showTips: boolean;
  showWit: boolean;
  thought: ThoughtSummary | null;
  elapsedTime: number;
  currentWittyPhrase: string | undefined;
  activeHooks: ActiveHook[];
  showLoadingIndicator: boolean;
  errorVerbosity: 'low' | 'full' | undefined;
}> = ({
  showTips,
  showWit,
  thought,
  elapsedTime,
  currentWittyPhrase,
  activeHooks,
  showLoadingIndicator,
  errorVerbosity,
}) => {
  if (activeHooks.length === 0 && !showLoadingIndicator) return null;

  let currentLoadingPhrase: string | undefined = undefined;
  let currentThought: ThoughtSummary | null = null;

  if (activeHooks.length > 0) {
    const userVisibleHooks = activeHooks.filter((h) => isUserVisibleHook(h.source));

    if (userVisibleHooks.length > 0) {
      const label = userVisibleHooks.length > 1 ? 'Executing Hooks' : 'Executing Hook';
      const displayNames = userVisibleHooks.map((h) => {
        let name = stripAnsi(h.name);
        if (h.index && h.total && h.total > 1) {
          name += ` (${h.index}/${h.total})`;
        }
        return name;
      });
      currentLoadingPhrase = `${label}: ${displayNames.join(', ')}`;
    } else {
      currentLoadingPhrase = GENERIC_WORKING_LABEL;
    }
  } else {
    // Sanitize thought subject to prevent terminal injection
    currentThought = thought ? { ...thought, subject: stripAnsi(thought.subject ?? '') } : null;
  }

  return (
    <Box>
      <LoadingIndicator
        inline
        showTips={showTips}
        showWit={showWit}
        errorVerbosity={errorVerbosity}
        thought={currentThought}
        currentLoadingPhrase={currentLoadingPhrase}
        elapsedTime={elapsedTime}
        forceRealStatusOnly={false}
        wittyPhrase={currentWittyPhrase}
      />
    </Box>
  );
};

import { useInputState } from '../contexts/InputContext.js';

function computeTipContent(
  showTips: boolean,
  currentTip: string | undefined,
  isInteractiveShellWaiting: boolean,
  showShortcutsHint: boolean,
  hideUiDetailsForSuggestions: boolean,
  hasPendingActionRequired: boolean,
  bufferTextLength: number,
  showUiDetails: boolean,
): string | undefined {
  if (
    showTips &&
    currentTip &&
    !(isInteractiveShellWaiting && currentTip === INTERACTIVE_SHELL_WAITING_PHRASE)
  ) {
    return currentTip;
  }
  // In full UI mode the '? for shortcuts' hint lives in the Footer (Claude Code
  // style bottom line); StatusRow only carries the minimal-mode variant.
  if (
    showShortcutsHint &&
    !hideUiDetailsForSuggestions &&
    !hasPendingActionRequired &&
    bufferTextLength === 0 &&
    !showUiDetails
  ) {
    return 'press tab twice for more';
  }
  return undefined;
}

const TipNode: React.FC<{
  tipContentStr: string;
  currentTip: string | undefined;
  currentWittyPhrase: string | undefined;
  shortcutsHelpVisible: boolean;
  onTipRefChange: (node: DOMElement | null) => void;
}> = ({ tipContentStr, currentTip, currentWittyPhrase, shortcutsHelpVisible, onTipRefChange }) => {
  const isShortcutHint =
    tipContentStr === '? for shortcuts' || tipContentStr === 'press tab twice for more';
  const color = isShortcutHint && shortcutsHelpVisible ? theme.text.accent : theme.text.secondary;
  return (
    <Box flexDirection="row" justifyContent="flex-end" ref={onTipRefChange}>
      <Text
        color={color}
        wrap="truncate-end"
        italic={!isShortcutHint && tipContentStr === currentWittyPhrase}
      >
        {tipContentStr === currentTip ? `Tip: ${tipContentStr}` : tipContentStr}
      </Text>
    </Box>
  );
};

const ServiceIndicator: React.FC<{
  service: ActiveServiceInfo;
  onSelect: (service: ActiveServiceInfo) => void;
}> = ({ service, onSelect }) => {
  const ref = useRef<DOMElement | null>(null);
  useMouseClick(ref, () => {
    onSelect(service);
  });

  let displayLabel = `${service.service}...`;
  if (service.service === 'MAPLE') {
    displayLabel = 'learning...';
  } else if (service.service === 'VIGIL') {
    displayLabel = 'VIGIL...';
  }

  return (
    <Box ref={ref} marginLeft={1}>
      <Text color={theme.text.accent} bold>
        *{displayLabel}*
      </Text>
    </Box>
  );
};

const StatusRowRow1: React.FC<{
  showUiDetails: boolean;
  showRow1Minimal: boolean;
  showRow2Minimal: boolean;
  isInteractiveShellWaiting: boolean;
  isNarrow: boolean;
  showTipLine: boolean;
  tipContentStr: string | undefined;
  modeContentObj: { color: string; text: string } | null;
  statusNode: React.ReactNode;
  currentTip: string | undefined;
  currentWittyPhrase: string | undefined;
  shortcutsHelpVisible: boolean;
  onTipRefChange: (node: DOMElement | null) => void;
  activeServices: ActiveServiceInfo[];
  selectedService: ActiveServiceInfo | null;
  onServiceSelect: (service: ActiveServiceInfo) => void;
}> = ({
  showUiDetails,
  showRow1Minimal,
  showRow2Minimal,
  isInteractiveShellWaiting,
  isNarrow,
  showTipLine,
  tipContentStr,
  modeContentObj,
  statusNode,
  currentTip,
  currentWittyPhrase,
  shortcutsHelpVisible,
  onTipRefChange,
  activeServices,
  selectedService,
  onServiceSelect,
}) => {
  let mainContentNode: React.ReactNode;
  if (!showUiDetails && showRow1Minimal) {
    mainContentNode = (
      <Box flexDirection="row" columnGap={1} alignItems="center">
        {statusNode}
        {showRow2Minimal && modeContentObj && (
          <Box>
            <Text color={modeContentObj.color}>● {modeContentObj.text}</Text>
          </Box>
        )}
        {activeServices.map((service) => (
          <ServiceIndicator key={service.service} service={service} onSelect={onServiceSelect} />
        ))}
        {selectedService && (
          <Box marginLeft={1}>
            <Text color={theme.text.secondary}>
              ({selectedService.service}: {selectedService.action} -{' '}
              {Math.round((Date.now() - selectedService.timestamp) / 1000)}s)
            </Text>
          </Box>
        )}
      </Box>
    );
  } else if (isInteractiveShellWaiting) {
    mainContentNode = (
      <Box width="100%" marginLeft={LAYOUT.INDICATOR_LEFT_MARGIN}>
        <Text color={theme.status.warning}>{INTERACTIVE_SHELL_WAITING_PHRASE}</Text>
      </Box>
    );
  } else {
    mainContentNode = (
      <Box
        flexDirection="row"
        alignItems={isNarrow ? 'flex-start' : 'center'}
        flexGrow={1}
        flexShrink={0}
        marginLeft={LAYOUT.INDICATOR_LEFT_MARGIN}
      >
        {statusNode}
        {activeServices.map((service) => (
          <ServiceIndicator key={service.service} service={service} onSelect={onServiceSelect} />
        ))}
        {selectedService && (
          <Box marginLeft={1}>
            <Text color={theme.text.secondary}>
              ({selectedService.service}: {selectedService.action} -{' '}
              {Math.round((Date.now() - selectedService.timestamp) / 1000)}s)
            </Text>
          </Box>
        )}
      </Box>
    );
  }

  let tipMarginRight = 0;
  if (showTipLine) {
    tipMarginRight = isNarrow ? LAYOUT.TIP_RIGHT_MARGIN_NARROW : LAYOUT.TIP_RIGHT_MARGIN_WIDE;
  }

  return (
    <Box
      width="100%"
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      minHeight={LAYOUT.STATUS_MIN_HEIGHT}
    >
      <Box flexDirection="row" flexGrow={1} flexShrink={1} alignItems="center">
        {mainContentNode}
      </Box>
      <Box
        flexShrink={0}
        marginLeft={showTipLine ? LAYOUT.TIP_LEFT_MARGIN : 0}
        marginRight={tipMarginRight}
        position={showTipLine ? 'relative' : 'absolute'}
        {...(showTipLine ? {} : { top: -100, left: -100 })}
      >
        {!isNarrow && tipContentStr && (
          <TipNode
            tipContentStr={tipContentStr}
            currentTip={currentTip}
            currentWittyPhrase={currentWittyPhrase}
            shortcutsHelpVisible={shortcutsHelpVisible}
            onTipRefChange={onTipRefChange}
          />
        )}
      </Box>
    </Box>
  );
};

function getContextUsageColor(percentage: number): string {
  if (percentage >= 0.8) return theme.status.error;
  if (percentage >= 0.6) return theme.status.warning;
  return theme.text.secondary;
}

function computeEstimatedStatusWidth(
  showLoadingIndicator: boolean,
  activeHooksLength: number,
  thoughtSubject?: string,
): number {
  if (showLoadingIndicator || activeHooksLength > 0) {
    return activeHooksLength > 0 ? 40 : 25;
  }
  if (thoughtSubject) {
    return stripAnsi(thoughtSubject).length + 15;
  }
  return 15;
}

const StatusRowRow2: React.FC<{
  showUiDetails: boolean;
  isNarrow: boolean;
  hideUiDetailsForSuggestions: boolean;
  shellModeActive: boolean;
  showApprovalModeIndicator: ApprovalMode;
  allowPlanMode: boolean;
  renderMarkdown: boolean;
  showMinimalContext: boolean;
  modeContentObj: { color: string; text: string } | null;
  hideContextSummary: boolean;
  lastPromptTokenCount: number;
  currentModel: string;
  terminalWidth: number;
  showRow2Minimal: boolean;
  contextUsage: { consumed: number; limit: number; percentage: number; model: string } | null;
}> = ({
  showUiDetails,
  isNarrow,
  hideUiDetailsForSuggestions,
  shellModeActive,
  showApprovalModeIndicator,
  allowPlanMode,
  renderMarkdown,
  showMinimalContext,
  modeContentObj,
  hideContextSummary,
  lastPromptTokenCount,
  currentModel,
  terminalWidth,
  showRow2Minimal,
  contextUsage,
}) => (
  <Box
    width="100%"
    flexDirection={isNarrow ? 'column' : 'row'}
    alignItems={isNarrow ? 'flex-start' : 'center'}
    justifyContent="space-between"
  >
    <Box flexDirection="row" alignItems="center" marginLeft={LAYOUT.INDICATOR_LEFT_MARGIN}>
      {showUiDetails ? (
        <>
          {!hideUiDetailsForSuggestions && !shellModeActive && (
            <ApprovalModeIndicator
              approvalMode={showApprovalModeIndicator}
              allowPlanMode={allowPlanMode}
            />
          )}
          {shellModeActive && (
            <Box marginLeft={LAYOUT.INDICATOR_LEFT_MARGIN}>
              <ShellModeIndicator />
            </Box>
          )}
          {!renderMarkdown && (
            <Box marginLeft={LAYOUT.INDICATOR_LEFT_MARGIN}>
              <RawMarkdownIndicator />
            </Box>
          )}
        </>
      ) : (
        showRow2Minimal &&
        modeContentObj && <Text color={modeContentObj.color}>● {modeContentObj.text}</Text>
      )}
    </Box>
    <Box
      marginTop={isNarrow ? LAYOUT.CONTEXT_DISPLAY_TOP_MARGIN_NARROW : 0}
      flexDirection="row"
      alignItems="center"
      marginLeft={
        isNarrow
          ? LAYOUT.CONTEXT_DISPLAY_LEFT_MARGIN_NARROW
          : LAYOUT.CONTEXT_DISPLAY_LEFT_MARGIN_WIDE
      }
    >
      {(showUiDetails || showMinimalContext) && (
        <StatusDisplay hideContextSummary={hideContextSummary} />
      )}
      {showMinimalContext && !showUiDetails && (
        <Box marginLeft={LAYOUT.INDICATOR_LEFT_MARGIN}>
          {contextUsage ? (
            <Text color={getContextUsageColor(contextUsage.percentage)}>
              [Context:{' '}
              {(() => {
                const formatTokens = (tokens: number): string => {
                  if (tokens >= 1000000)
                    return `${(tokens / 1000000).toFixed(1).replace('.0', '')}M`;
                  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1).replace('.0', '')}k`;
                  return String(tokens);
                };
                return `${formatTokens(contextUsage.consumed)}/${formatTokens(contextUsage.limit)} (${(contextUsage.percentage * 100).toFixed(0)}%)`;
              })()}
              ]
            </Text>
          ) : (
            <ContextUsageDisplay
              promptTokenCount={lastPromptTokenCount}
              model={typeof currentModel === 'string' ? currentModel : undefined}
              terminalWidth={terminalWidth}
            />
          )}
        </Box>
      )}
    </Box>
  </Box>
);

export const StatusRow: React.FC<StatusRowProps> = ({
  showUiDetails,
  isNarrow,
  terminalWidth,
  hideContextSummary,
  hideUiDetailsForSuggestions,
  hasPendingActionRequired,
}) => {
  const uiState = useUIState();
  const inputState = useInputState();
  const settings = useSettings();
  const {
    isInteractiveShellWaiting,
    showLoadingIndicator,
    showTips,
    showWit,
    modeContentObj,
    showMinimalContext,
  } = useComposerStatus();

  const [activeServices, setActiveServices] = useState<ActiveServiceInfo[]>([]);
  const [selectedService, setSelectedService] = useState<ActiveServiceInfo | null>(null);
  const [contextUsage, setContextUsage] = useState<{
    consumed: number;
    limit: number;
    percentage: number;
    model: string;
  } | null>(null);

  useEffect(() => {
    setActiveServices(hiveCoreConnection.getActiveServices());

    const unsubscribe = hiveCoreConnection.subscribe((event) => {
      if (!event || event.type !== 'custom') return;
      if (event.name === 'service_start' || event.name === 'service_end') {
        const current = hiveCoreConnection.getActiveServices();
        setActiveServices(current);
        if (event.name === 'service_end') {
          setSelectedService((prev) => (prev?.service === event.message ? null : prev));
        }
      } else if (event.name === 'context_usage_update' && event.message) {
        try {
          const usage = JSON.parse(event.message);
          setContextUsage(usage);
        } catch {
          // ignore
        }
      }
    });
    return () => unsubscribe();
  }, []);

  const handleServiceSelect = useCallback((service: ActiveServiceInfo) => {
    setSelectedService((prev) => (prev?.service === service.service ? null : service));
  }, []);

  const tipContentStr = computeTipContent(
    showTips,
    uiState.currentTip,
    isInteractiveShellWaiting,
    (settings.merged.ui as { showShortcutsHint?: boolean }).showShortcutsHint ?? true,
    hideUiDetailsForSuggestions,
    hasPendingActionRequired,
    inputState.buffer.text.length,
    showUiDetails,
  );

  // Calculate static estimated widths to prevent ResizeObserver render loops
  const estimatedStatusWidth = computeEstimatedStatusWidth(
    showLoadingIndicator,
    uiState.activeHooks.length,
    uiState.thought?.subject,
  );
  const estimatedTipWidth = tipContentStr ? tipContentStr.length + 5 : 0;

  const willCollideTip =
    estimatedStatusWidth + estimatedTipWidth + LAYOUT.COLLISION_GAP > terminalWidth;
  const showTipLine = Boolean(
    !hasPendingActionRequired && tipContentStr && !willCollideTip && !isNarrow,
  );
  const showRow1Minimal =
    showLoadingIndicator ||
    uiState.activeHooks.length > 0 ||
    showTipLine ||
    activeServices.length > 0;
  const showRow2Minimal =
    (Boolean(modeContentObj) && !hideUiDetailsForSuggestions) || showMinimalContext;
  const showRow1 = showUiDetails || showRow1Minimal;
  const showRow2 = showUiDetails || showRow2Minimal;

  const statusNode = (
    <StatusNode
      showTips={showTips}
      showWit={showWit}
      thought={uiState.thought}
      elapsedTime={uiState.elapsedTime}
      currentWittyPhrase={uiState.currentWittyPhrase}
      activeHooks={uiState.activeHooks}
      showLoadingIndicator={showLoadingIndicator}
      errorVerbosity={settings.merged.ui.errorVerbosity as 'low' | 'full' | undefined}
    />
  );

  if (!showUiDetails && !showRow1Minimal && !showRow2Minimal) {
    return <Box height={LAYOUT.STATUS_MIN_HEIGHT} />;
  }

  return (
    <Box flexDirection="column" width="100%">
      {showRow1 && (
        <StatusRowRow1
          showUiDetails={showUiDetails}
          showRow1Minimal={showRow1Minimal}
          showRow2Minimal={showRow2Minimal}
          isInteractiveShellWaiting={isInteractiveShellWaiting}
          isNarrow={isNarrow}
          showTipLine={showTipLine}
          tipContentStr={tipContentStr}
          modeContentObj={modeContentObj}
          statusNode={statusNode}
          currentTip={uiState.currentTip}
          currentWittyPhrase={uiState.currentWittyPhrase}
          shortcutsHelpVisible={uiState.shortcutsHelpVisible}
          onTipRefChange={() => {}}
          activeServices={activeServices}
          selectedService={selectedService}
          onServiceSelect={handleServiceSelect}
        />
      )}
      {showRow1 && showRow2 && (showUiDetails || (showRow1Minimal && showRow2Minimal)) && (
        <Box width="100%">
          <HorizontalLine dim />
        </Box>
      )}
      {showRow2 && (
        <StatusRowRow2
          showUiDetails={showUiDetails}
          isNarrow={isNarrow}
          hideUiDetailsForSuggestions={hideUiDetailsForSuggestions}
          shellModeActive={inputState.shellModeActive}
          showApprovalModeIndicator={uiState.showApprovalModeIndicator}
          allowPlanMode={uiState.allowPlanMode}
          renderMarkdown={uiState.renderMarkdown}
          showMinimalContext={showMinimalContext}
          modeContentObj={modeContentObj}
          hideContextSummary={hideContextSummary}
          lastPromptTokenCount={uiState.sessionStats.lastPromptTokenCount}
          currentModel={typeof uiState.currentModel === 'string' ? uiState.currentModel : ''}
          terminalWidth={terminalWidth}
          showRow2Minimal={showRow2Minimal}
          contextUsage={contextUsage}
        />
      )}
    </Box>
  );
};
