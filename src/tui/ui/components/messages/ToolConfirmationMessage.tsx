/**
 * @license
 * Copyright 2025 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, ResizeObserver, type DOMElement } from 'ink';
import { DiffRenderer } from './DiffRenderer.js';
import { RenderInline } from '../../utils/InlineMarkdownRenderer.js';
import { debugLogger } from '../../../utils/errors.js';
import { HiveConfig } from '../../../config/hiveConfig.js';
import {
  ToolConfirmationOutcome,
  ApprovalMode,
  SerializableConfirmationDetails,
  ToolConfirmationPayload,
  EditorType,
  hasRedirection,
  calculateBodyContentHeight,
} from '../../contexts/UIStateContext.js';
import { useToolActions } from '../../contexts/ToolActionsContext.js';
import { RadioButtonSelect, type RadioSelectItem } from '../shared/RadioButtonSelect.js';
import { MaxSizedBox } from '../shared/MaxSizedBox.js';
import { sanitizeForDisplay, stripUnsafeCharacters } from '../../utils/textUtils.js';
import { useKeypress } from '../../hooks/useKeypress.js';
import { theme } from '../../semantic-colors.js';
import { themeManager } from '../../themes/theme-manager.js';
import { useSettings } from '../../contexts/SettingsContext.js';
import { Command } from '../../key/keyMatchers.js';
import { formatCommand } from '../../key/keybindingUtils.js';
import { AskUserDialog } from '../AskUserDialog.js';
import { ExitPlanModeDialog } from '../ExitPlanModeDialog.js';
import { WarningMessage } from './WarningMessage.js';
import { colorizeCode } from '../../utils/CodeColorizer.js';
import {
  getDeceptiveUrlDetails,
  toUnicodeUrl,
  type DeceptiveUrlDetails,
} from '../../utils/urlSecurityUtils.js';
import { useKeyMatchers } from '../../hooks/useKeyMatchers.js';
import { isShellTool } from './ToolShared.js';

export interface ToolConfirmationMessageProps {
  callId: string;
  confirmationDetails: SerializableConfirmationDetails;
  config: HiveConfig;
  getPreferredEditor: () => EditorType | undefined;
  isFocused?: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
  toolName: string;
}

import type { Theme } from '../../themes/theme.js';

interface ContentContext {
  toolName: string;
  config: HiveConfig;
  terminalWidth: number;
  bodyHeight: number;
  settings: ReturnType<typeof useSettings>;
  activeTheme: Theme;
  handleConfirm: (outcome: ToolConfirmationOutcome, details?: unknown) => void;
  hasMcpToolDetails: boolean;
  isMcpToolDetailsExpanded: boolean;
  expandDetailsHintKey: string;
  mcpToolDetailsText: string | null;
  getPreferredEditor: () => EditorType | undefined;
}

function buildEditContent(
  details: Extract<SerializableConfirmationDetails, { type: 'edit' }>,
  ctx: ContentContext,
): { question: React.ReactNode; body: React.ReactNode } {
  if (!details.isModifying) {
    return {
      question: 'Apply this change?',
      body: (
        <>
          <Box
            borderStyle="round"
            borderColor={ctx.activeTheme.semanticColors.border.default}
            paddingX={1}
            paddingY={0}
            marginBottom={0}
          >
            <DiffRenderer
              diffContent={stripUnsafeCharacters(details.fileDiff)}
              filename={sanitizeForDisplay(details.fileName)}
              availableTerminalHeight={
                ctx.bodyHeight !== undefined ? Math.max(ctx.bodyHeight - 2, 2) : undefined
              }
              terminalWidth={Math.max(ctx.terminalWidth, 1) - 4}
            />
          </Box>
        </>
      ),
    };
  }
  return { question: '', body: null };
}

function buildSandboxContent(
  details: Extract<SerializableConfirmationDetails, { type: 'sandbox_expansion' }>,
  ctx: ContentContext,
): { question: React.ReactNode; body: React.ReactNode } {
  const { additionalPermissions, command } = details;
  const readPaths = additionalPermissions?.fileSystem?.read || [];
  const writePaths = additionalPermissions?.fileSystem?.write || [];
  const network = additionalPermissions?.network;
  const isShell = isShellTool(ctx.toolName);
  const commandNames = isShell ? 'Shell' : ctx.toolName;
  const body = (
    <>
      <Box
        borderStyle="round"
        borderColor={ctx.activeTheme.semanticColors.border.default}
        paddingX={1}
        paddingY={0}
        marginBottom={0}
      >
        {colorizeCode({
          code: command.trim(),
          language: 'bash',
          maxWidth: Math.max(ctx.terminalWidth, 1) - 6,
          settings: ctx.settings,
          theme: ctx.activeTheme,
          hideLineNumbers: true,
          availableHeight:
            ctx.bodyHeight !== undefined ? Math.max(ctx.bodyHeight - 2, 2) : undefined,
        })}
      </Box>
      <Box flexDirection="column">
        <Text>
          To run{' '}
          <Text
            color={isShell ? ctx.activeTheme.semanticColors.status.warning : undefined}
            bold={isShell}
          >
            [{sanitizeForDisplay(commandNames)}]
          </Text>
          , allow access to the following?
        </Text>
        {network && (
          <Text>
            <Text color={isShell ? ctx.activeTheme.semanticColors.status.warning : undefined} bold>
              • Network:
            </Text>{' '}
            All Urls
          </Text>
        )}
        {writePaths.length > 0 && (
          <Text>
            <Text color={isShell ? ctx.activeTheme.semanticColors.status.warning : undefined} bold>
              • Write:
            </Text>{' '}
            {writePaths.map((p) => sanitizeForDisplay(p)).join(', ')}
          </Text>
        )}
        {readPaths.length > 0 && (
          <Text>
            <Text color={isShell ? ctx.activeTheme.semanticColors.status.warning : undefined} bold>
              • Read:
            </Text>{' '}
            {readPaths.map((p) => sanitizeForDisplay(p)).join(', ')}
          </Text>
        )}
      </Box>
    </>
  );
  return { question: '', body };
}

function buildExecContent(
  details: Extract<SerializableConfirmationDetails, { type: 'exec' }>,
  ctx: ContentContext,
): { question: React.ReactNode; body: React.ReactNode } {
  const isShell = isShellTool(ctx.toolName);
  const commandsToDisplay =
    details.commands && details.commands.length > 1 ? details.commands : [details.command];
  const containsRedirection = commandsToDisplay.some((cmd) => hasRedirection(cmd));
  const isAutoEdit =
    ctx.config.getApprovalMode() === ApprovalMode.YOLO ||
    ctx.config.getApprovalMode() === ApprovalMode.AUTO_EDIT;
  const warnings =
    containsRedirection && !isAutoEdit ? (
      <Box flexDirection="column" marginBottom={0}>
        <Text color={ctx.activeTheme.semanticColors.text.primary}>
          Redirection detected.{' '}
          <Text
            color={ctx.activeTheme.semanticColors.text.secondary}
          >{`To auto-accept, press ${formatCommand(Command.CYCLE_APPROVAL_MODE)}`}</Text>
        </Text>
      </Box>
    ) : null;
  const commandNames = isShell ? 'Shell' : ctx.toolName;
  const question = (
    <Box flexDirection="column">
      <Text>
        Allow execution of{' '}
        <Text
          color={isShell ? ctx.activeTheme.semanticColors.status.warning : undefined}
          bold={isShell}
        >
          [{sanitizeForDisplay(commandNames)}]
        </Text>
        {'?'}
      </Text>
      {warnings}
    </Box>
  );
  const body = (
    <>
      <Box
        borderStyle="round"
        borderColor={ctx.activeTheme.semanticColors.border.default}
        paddingX={1}
        paddingY={0}
        marginBottom={0}
      >
        <MaxSizedBox
          maxHeight={ctx.bodyHeight !== undefined ? Math.max(ctx.bodyHeight - 2, 2) : undefined}
          maxWidth={Math.max(ctx.terminalWidth, 1) - 4}
        >
          <Box flexDirection="column">
            {commandsToDisplay.map((cmd, idx) => (
              <Box
                key={idx}
                flexDirection="column"
                paddingBottom={idx < commandsToDisplay.length - 1 ? 1 : 0}
              >
                {colorizeCode({
                  code: cmd.trim(),
                  language: 'bash',
                  maxWidth: Math.max(ctx.terminalWidth, 1) - 6,
                  settings: ctx.settings,
                  theme: ctx.activeTheme,
                  hideLineNumbers: true,
                  availableHeight:
                    ctx.bodyHeight !== undefined ? Math.max(ctx.bodyHeight - 2, 2) : undefined,
                })}
              </Box>
            ))}
          </Box>
        </MaxSizedBox>
      </Box>
    </>
  );
  return { question, body };
}

function buildInfoContent(
  details: Extract<SerializableConfirmationDetails, { type: 'info' }>,
  ctx: ContentContext,
): { question: React.ReactNode; body: React.ReactNode } {
  const displayUrls =
    details.urls && !(details.urls.length === 1 && details.urls[0] === details.prompt);
  const body = (
    <Box flexDirection="column">
      <Text color={ctx.activeTheme.semanticColors.text.link}>
        <RenderInline
          text={details.prompt}
          defaultColor={ctx.activeTheme.semanticColors.text.link}
        />
      </Text>
      {displayUrls && details.urls && details.urls.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={ctx.activeTheme.semanticColors.text.primary}>URLs to fetch:</Text>
          {details.urls.map((urlString) => (
            <Text key={urlString}>
              {' '}
              - <RenderInline text={toUnicodeUrl(urlString)} />
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
  return { question: 'Do you want to proceed?', body };
}

function buildMcpContent(
  details: Extract<SerializableConfirmationDetails, { type: 'mcp' }>,
  ctx: ContentContext,
): { question: React.ReactNode; body: React.ReactNode } {
  const question = `Allow execution of MCP tool "${sanitizeForDisplay(details.toolName)}" from server "${sanitizeForDisplay(details.serverName)}"?`;
  const body = (
    <Box flexDirection="column">
      <>
        <Text color={ctx.activeTheme.semanticColors.text.link}>
          MCP Server: {sanitizeForDisplay(details.serverName)}
        </Text>
        <Text color={ctx.activeTheme.semanticColors.text.link}>
          Tool: {sanitizeForDisplay(details.toolName)}
        </Text>
      </>
      {ctx.hasMcpToolDetails && (
        <Box flexDirection="column" marginTop={1}>
          <Text color={ctx.activeTheme.semanticColors.text.primary}>MCP Tool Details:</Text>
          {ctx.isMcpToolDetailsExpanded ? (
            <>
              <Text color={ctx.activeTheme.semanticColors.text.secondary}>
                (press {ctx.expandDetailsHintKey} to collapse MCP tool details)
              </Text>
              <Box
                borderStyle="round"
                borderColor={ctx.activeTheme.semanticColors.border.default}
                paddingX={1}
                paddingY={0}
                marginBottom={0}
              >
                {colorizeCode({
                  code: ctx.mcpToolDetailsText || '',
                  language: 'json',
                  maxWidth: Math.max(ctx.terminalWidth, 1) - 4,
                  settings: ctx.settings,
                  theme: ctx.activeTheme,
                  hideLineNumbers: true,
                  availableHeight:
                    ctx.bodyHeight !== undefined ? Math.max(ctx.bodyHeight - 2, 2) : undefined,
                })}
              </Box>
            </>
          ) : (
            <Text color={ctx.activeTheme.semanticColors.text.secondary}>
              (press {ctx.expandDetailsHintKey} to expand MCP tool details)
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
  return { question, body };
}

function buildConfirmationContent(
  details: SerializableConfirmationDetails,
  ctx: ContentContext,
): { question: React.ReactNode; body: React.ReactNode } {
  if (details.type === 'edit') return buildEditContent(details, ctx);
  if (details.type === 'sandbox_expansion') return buildSandboxContent(details, ctx);
  if (details.type === 'exec') return buildExecContent(details, ctx);
  if (details.type === 'info') return buildInfoContent(details, ctx);
  if (details.type === 'mcp') return buildMcpContent(details, ctx);
  return { question: '', body: null };
}

interface OptionsContext {
  isTrustedFolder: boolean;
  allowPermanentApproval: boolean;
  config: HiveConfig;
  isDiffingEnabled: boolean;
}

function buildGenericConfirmationOptions(
  ctx: OptionsContext,
  permanentLabel = 'Allow for all future sessions',
): Array<RadioSelectItem<ToolConfirmationOutcome>> {
  const options: Array<RadioSelectItem<ToolConfirmationOutcome>> = [
    {
      label: 'Allow once',
      value: ToolConfirmationOutcome.ProceedOnce,
      key: 'Allow once',
    },
  ];
  if (ctx.isTrustedFolder) {
    options.push({
      label: 'Allow for this session',
      value: ToolConfirmationOutcome.ProceedAlways,
      key: 'Allow for this session',
    });
    if (ctx.allowPermanentApproval) {
      options.push({
        label: permanentLabel,
        value: ToolConfirmationOutcome.ProceedAlwaysAndSave,
        key: 'Allow for all future sessions',
      });
    }
  }
  options.push({
    label: 'No, suggest changes (esc)',
    value: ToolConfirmationOutcome.Cancel,
    key: 'No, suggest changes (esc)',
  });
  return options;
}

function buildEditConfirmationOptions(
  details: Extract<SerializableConfirmationDetails, { type: 'edit' }>,
  ctx: OptionsContext,
): Array<RadioSelectItem<ToolConfirmationOutcome>> {
  if (details.isModifying) return [];
  const options: Array<RadioSelectItem<ToolConfirmationOutcome>> = [
    {
      label: 'Allow once',
      value: ToolConfirmationOutcome.ProceedOnce,
      key: 'Allow once',
    },
  ];
  if (ctx.isTrustedFolder) {
    options.push({
      label: 'Allow for this session',
      value: ToolConfirmationOutcome.ProceedAlways,
      key: 'Allow for this session',
    });
    if (ctx.allowPermanentApproval) {
      options.push({
        label: 'Allow for this file in all future sessions',
        value: ToolConfirmationOutcome.ProceedAlwaysAndSave,
        key: 'Allow for this file in all future sessions',
      });
    }
  }
  if (!ctx.config.getIdeMode() || !ctx.isDiffingEnabled) {
    options.push({
      label: 'Modify with external editor',
      value: ToolConfirmationOutcome.ModifyWithEditor,
      key: 'Modify with external editor',
    });
  }
  options.push({
    label: 'No, suggest changes (esc)',
    value: ToolConfirmationOutcome.Cancel,
    key: 'No, suggest changes (esc)',
  });
  return options;
}

function buildMcpConfirmationOptions(
  ctx: OptionsContext,
): Array<RadioSelectItem<ToolConfirmationOutcome>> {
  const options: Array<RadioSelectItem<ToolConfirmationOutcome>> = [
    {
      label: 'Allow once',
      value: ToolConfirmationOutcome.ProceedOnce,
      key: 'Allow once',
    },
  ];
  if (ctx.isTrustedFolder) {
    options.push({
      label: 'Allow tool for this session',
      value: ToolConfirmationOutcome.ProceedAlwaysTool,
      key: 'Allow tool for this session',
    });
    options.push({
      label: 'Allow all server tools for this session',
      value: ToolConfirmationOutcome.ProceedAlwaysServer,
      key: 'Allow all server tools for this session',
    });
    if (ctx.allowPermanentApproval) {
      options.push({
        label: 'Allow tool for all future sessions',
        value: ToolConfirmationOutcome.ProceedAlwaysAndSave,
        key: 'Allow tool for all future sessions',
      });
    }
  }
  options.push({
    label: 'No, suggest changes (esc)',
    value: ToolConfirmationOutcome.Cancel,
    key: 'No, suggest changes (esc)',
  });
  return options;
}

function buildConfirmationOptions(
  details: SerializableConfirmationDetails,
  ctx: OptionsContext,
): Array<RadioSelectItem<ToolConfirmationOutcome>> {
  if (details.type === 'edit') return buildEditConfirmationOptions(details, ctx);
  if (details.type === 'sandbox_expansion') return buildGenericConfirmationOptions(ctx);
  if (details.type === 'exec')
    return buildGenericConfirmationOptions(ctx, 'Allow this command for all future sessions');
  if (details.type === 'info') return buildGenericConfirmationOptions(ctx);
  if (details.type === 'mcp') return buildMcpConfirmationOptions(ctx);
  return [];
}

function computeDeceptiveUrlWarnings(
  confirmationDetails: SerializableConfirmationDetails,
): DeceptiveUrlDetails[] {
  const urls: string[] = [];
  if (confirmationDetails.type === 'info' && confirmationDetails.urls) {
    urls.push(...confirmationDetails.urls);
  } else if (confirmationDetails.type === 'exec') {
    const commands =
      confirmationDetails.commands && confirmationDetails.commands.length > 0
        ? confirmationDetails.commands
        : [confirmationDetails.command];
    for (const cmd of commands) {
      const matches = cmd.match(/https?:\/\/[^\s"'`<>;&|()]+/g);
      if (matches) urls.push(...matches);
    }
  }
  return Array.from(new Set(urls))
    .map(getDeceptiveUrlDetails)
    .filter((d): d is DeceptiveUrlDetails => d !== null);
}

function computeMcpToolDetailsText(
  confirmationDetails: SerializableConfirmationDetails,
): string | null {
  if (confirmationDetails.type !== 'mcp') return null;
  const detailsLines: string[] = [];
  const hasNonEmptyToolArgs =
    confirmationDetails.toolArgs !== undefined &&
    !(
      typeof confirmationDetails.toolArgs === 'object' &&
      confirmationDetails.toolArgs !== null &&
      Object.keys(confirmationDetails.toolArgs).length === 0
    );
  if (hasNonEmptyToolArgs) {
    let argsText: string;
    try {
      argsText = stripUnsafeCharacters(JSON.stringify(confirmationDetails.toolArgs, null, 2));
    } catch {
      argsText = '[unserializable arguments]';
    }
    detailsLines.push('Invocation Arguments:', argsText);
  }
  const description = confirmationDetails.toolDescription?.trim();
  if (description) {
    if (detailsLines.length > 0) detailsLines.push('');
    detailsLines.push('Description:', stripUnsafeCharacters(description));
  }
  if (confirmationDetails.toolParameterSchema !== undefined) {
    let schemaText: string;
    try {
      schemaText = stripUnsafeCharacters(
        JSON.stringify(confirmationDetails.toolParameterSchema, null, 2),
      );
    } catch {
      schemaText = '[unserializable schema]';
    }
    if (detailsLines.length > 0) detailsLines.push('');
    detailsLines.push('Input Schema:', schemaText);
  }
  return detailsLines.length === 0 ? null : detailsLines.join('\n');
}

function computeConfirmationContent(ctx: {
  confirmationDetails: SerializableConfirmationDetails;
  options: Array<RadioSelectItem<ToolConfirmationOutcome>>;
  terminalWidth: number;
  handleConfirm: (outcome: ToolConfirmationOutcome, payload?: unknown) => void;
  deceptiveUrlWarningText: string | null;
  isMcpToolDetailsExpanded: boolean;
  hasMcpToolDetails: boolean;
  mcpToolDetailsText: string | null;
  expandDetailsHintKey: string;
  getPreferredEditor: () => EditorType | undefined;
  isTrustedFolder: boolean;
  allowPermanentApproval: boolean;
  settings: ReturnType<typeof useSettings>;
  activeTheme: Theme;
  config: HiveConfig;
  toolName: string;
  measuredSecurityWarningsHeight: number;
  availableTerminalHeight: number | undefined;
  handlesOwnUI: boolean;
}): {
  question: React.ReactNode;
  bodyContent: React.ReactNode;
  securityWarnings: React.ReactNode;
  initialIndex: number;
} {
  let parsedInitialIndex = 0;
  if (ctx.isTrustedFolder && ctx.allowPermanentApproval) {
    const isSafeToPersist =
      ctx.confirmationDetails.type === 'info' ||
      ctx.confirmationDetails.type === 'edit' ||
      ctx.confirmationDetails.type === 'mcp';
    const securitySettings = ctx.settings.merged.security as { autoAddToPolicyByDefault?: boolean };
    if (isSafeToPersist && securitySettings.autoAddToPolicyByDefault) {
      const idx = ctx.options.findIndex(
        (o) => o.value === ToolConfirmationOutcome.ProceedAlwaysAndSave,
      );
      if (idx !== -1) parsedInitialIndex = idx;
    }
  }
  const parsedWarnings = ctx.deceptiveUrlWarningText ? (
    <WarningMessage text={ctx.deceptiveUrlWarningText} />
  ) : null;
  const bodyHeight = calculateBodyContentHeight({
    availableTerminalHeight: ctx.availableTerminalHeight,
    handlesOwnUI: ctx.handlesOwnUI,
    optionsCount: ctx.options.length,
    measuredSecurityWarningsHeight: ctx.measuredSecurityWarningsHeight,
    deceptiveUrlWarningText: ctx.deceptiveUrlWarningText,
    confirmationDetails: ctx.confirmationDetails,
    config: ctx.config,
  });
  if (ctx.confirmationDetails.type === 'ask_user') {
    return {
      question: '',
      bodyContent: (
        <AskUserDialog
          questions={ctx.confirmationDetails.questions}
          onSubmit={(answers) =>
            ctx.handleConfirm(ToolConfirmationOutcome.ProceedOnce, { answers })
          }
          onCancel={() => ctx.handleConfirm(ToolConfirmationOutcome.Cancel)}
          width={ctx.terminalWidth}
          availableHeight={bodyHeight}
        />
      ),
      securityWarnings: null,
      initialIndex: 0,
    };
  }
  if (ctx.confirmationDetails.type === 'exit_plan_mode') {
    return {
      question: '',
      bodyContent: (
        <ExitPlanModeDialog
          planPath={ctx.confirmationDetails.planPath}
          getPreferredEditor={ctx.getPreferredEditor}
          onApprove={(approvalMode) =>
            ctx.handleConfirm(ToolConfirmationOutcome.ProceedOnce, { approved: true, approvalMode })
          }
          onFeedback={(feedback) =>
            ctx.handleConfirm(ToolConfirmationOutcome.ProceedOnce, { approved: false, feedback })
          }
          onCancel={() => ctx.handleConfirm(ToolConfirmationOutcome.Cancel)}
          width={ctx.terminalWidth}
          availableHeight={bodyHeight}
        />
      ),
      securityWarnings: null,
      initialIndex: 0,
    };
  }
  const content = buildConfirmationContent(ctx.confirmationDetails, {
    toolName: ctx.toolName,
    config: ctx.config,
    terminalWidth: ctx.terminalWidth,
    bodyHeight,
    settings: ctx.settings,
    activeTheme: ctx.activeTheme,
    handleConfirm: ctx.handleConfirm,
    hasMcpToolDetails: ctx.hasMcpToolDetails,
    isMcpToolDetailsExpanded: ctx.isMcpToolDetailsExpanded,
    expandDetailsHintKey: ctx.expandDetailsHintKey,
    mcpToolDetailsText: ctx.mcpToolDetailsText,
    getPreferredEditor: ctx.getPreferredEditor,
  });
  return {
    question: content.question,
    bodyContent: content.body,
    securityWarnings: parsedWarnings,
    initialIndex: parsedInitialIndex,
  };
}

function ToolConfirmationLayout(props: {
  confirmationDetails: SerializableConfirmationDetails;
  handlesOwnUI: boolean;
  bodyContent: React.ReactNode;
  question: React.ReactNode;
  securityWarnings: React.ReactNode;
  options: Array<RadioSelectItem<ToolConfirmationOutcome>>;
  initialIndex: number;
  isFocused: boolean;
  terminalWidth: number;
  bodyOverflowDirection: 'top' | 'bottom';
  handleSelect: (item: ToolConfirmationOutcome) => void;
  renderRadioItem: (
    item: RadioSelectItem<ToolConfirmationOutcome>,
    ctx: { titleColor: string },
  ) => React.ReactNode;
  onSecurityWarningsRefChange: (node: DOMElement | null) => void;
  getAvailableBodyContentHeight: () => number;
}) {
  const {
    confirmationDetails,
    handlesOwnUI,
    bodyContent,
    question,
    securityWarnings,
    options,
    initialIndex,
    isFocused,
    terminalWidth,
    bodyOverflowDirection,
    handleSelect,
    renderRadioItem,
    onSecurityWarningsRefChange,
    getAvailableBodyContentHeight,
  } = props;
  if (confirmationDetails.type === 'edit' && confirmationDetails.isModifying) {
    return (
      <Box
        width={terminalWidth}
        borderStyle="round"
        borderColor={theme.border.default}
        justifyContent="space-around"
        paddingTop={1}
        paddingBottom={1}
        overflow="hidden"
      >
        <Text color={theme.text.primary}>Modify in progress: </Text>
        <Text color={theme.status.success}>Save and close external editor to continue</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" paddingTop={0} paddingBottom={0}>
      {!!confirmationDetails.systemMessage && (
        <Box marginBottom={1}>
          <Text color={theme.status.warning}>{confirmationDetails.systemMessage}</Text>
        </Box>
      )}
      {handlesOwnUI ? (
        bodyContent
      ) : (
        <>
          <Box
            flexShrink={1}
            overflow="hidden"
            marginBottom={!question && !securityWarnings ? 1 : 0}
          >
            <MaxSizedBox
              maxHeight={getAvailableBodyContentHeight()}
              maxWidth={terminalWidth}
              overflowDirection={bodyOverflowDirection}
            >
              {bodyContent}
            </MaxSizedBox>
          </Box>
          {securityWarnings && (
            <Box flexShrink={0} marginBottom={1} ref={onSecurityWarningsRefChange}>
              {securityWarnings}
            </Box>
          )}
          {!!question && (
            <Box marginBottom={1} flexShrink={0}>
              {typeof question === 'string' ? (
                <Text color={theme.text.primary}>{question}</Text>
              ) : (
                question
              )}
            </Box>
          )}
          <Box flexShrink={0}>
            <RadioButtonSelect
              items={options}
              onSelect={handleSelect}
              isFocused={isFocused}
              initialIndex={initialIndex}
              renderItem={renderRadioItem}
            />
          </Box>
        </>
      )}
    </Box>
  );
}

function useSecurityWarningObserver() {
  const [measuredSecurityWarningsHeight, setMeasuredSecurityWarningsHeight] = useState(0);
  const observerRef = useRef<ResizeObserver | null>(null);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
    },
    [],
  );

  const onSecurityWarningsRefChange = useCallback((node: DOMElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }

    if (node) {
      const observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          const newHeight = Math.round(entry.contentRect.height);
          setMeasuredSecurityWarningsHeight((prev) => (newHeight !== prev ? newHeight : prev));
        }
      });
      observer.observe(node);
      observerRef.current = observer;
    } else {
      setMeasuredSecurityWarningsHeight((prev) => (prev !== 0 ? 0 : prev));
    }
  }, []);

  return { measuredSecurityWarningsHeight, onSecurityWarningsRefChange };
}

function useConfirmationOptions(
  confirmationDetails: SerializableConfirmationDetails,
  config: HiveConfig,
  isDiffingEnabled: boolean,
) {
  const settings = useSettings();
  const allowPermanentApproval =
    Boolean(
      (settings.merged.security as { enablePermanentToolApproval?: boolean })
        .enablePermanentToolApproval,
    ) && !config.getDisableAlwaysAllow();
  const isTrustedFolder = config.isTrustedFolder() && !config.getDisableAlwaysAllow();

  return useMemo(
    () =>
      buildConfirmationOptions(confirmationDetails, {
        isTrustedFolder,
        allowPermanentApproval,
        config,
        isDiffingEnabled,
      }),
    [confirmationDetails, isTrustedFolder, allowPermanentApproval, config, isDiffingEnabled],
  );
}

export const ToolConfirmationMessage: React.FC<ToolConfirmationMessageProps> = ({
  callId,
  confirmationDetails,
  config,
  getPreferredEditor,
  isFocused = true,
  availableTerminalHeight,
  terminalWidth,
  toolName,
}) => {
  const keyMatchers = useKeyMatchers();
  const { confirm, isDiffingEnabled } = useToolActions();
  const [mcpDetailsExpansionState, setMcpDetailsExpansionState] = useState<{
    callId: string;
    expanded: boolean;
  }>({
    callId,
    expanded: false,
  });
  const [isCancelling, setIsCancelling] = useState(false);
  const isMcpToolDetailsExpanded =
    mcpDetailsExpansionState.callId === callId ? mcpDetailsExpansionState.expanded : false;

  const { measuredSecurityWarningsHeight, onSecurityWarningsRefChange } =
    useSecurityWarningObserver();

  const deceptiveUrlWarnings = useMemo(
    () => computeDeceptiveUrlWarnings(confirmationDetails),
    [confirmationDetails],
  );

  const deceptiveUrlWarningText = useMemo(() => {
    if (deceptiveUrlWarnings.length === 0) return null;
    return `**Warning:** Deceptive URL(s) detected:\n\n${deceptiveUrlWarnings
      .map(
        (w) => `   **Original:** ${w.originalUrl}\n   **Actual Host (Punycode):** ${w.punycodeUrl}`,
      )
      .join('\n\n')}`;
  }, [deceptiveUrlWarnings]);

  const settings = useSettings();
  const activeTheme = themeManager.getActiveTheme();
  const securityMerged = settings.merged.security as { enablePermanentToolApproval?: boolean };
  const allowPermanentApproval =
    Boolean(securityMerged.enablePermanentToolApproval) && !config.getDisableAlwaysAllow();

  const handlesOwnUI =
    confirmationDetails.type === 'ask_user' || confirmationDetails.type === 'exit_plan_mode';
  const isTrustedFolder = config.isTrustedFolder() && !config.getDisableAlwaysAllow();

  const handleConfirm = useCallback(
    (outcome: ToolConfirmationOutcome, payload?: unknown) => {
      void confirm(callId, outcome, payload as ToolConfirmationPayload).catch((error: unknown) => {
        debugLogger.error(`Failed to handle tool confirmation for ${callId}:`, error);
      });
    },
    [confirm, callId],
  );

  const mcpToolDetailsText = useMemo(
    () => computeMcpToolDetailsText(confirmationDetails),
    [confirmationDetails],
  );

  const hasMcpToolDetails = !!mcpToolDetailsText;
  const expandDetailsHintKey = formatCommand(Command.SHOW_MORE_LINES);

  useKeypress(
    (key) => {
      if (!isFocused) return false;
      if (
        confirmationDetails.type === 'mcp' &&
        hasMcpToolDetails &&
        keyMatchers[Command.SHOW_MORE_LINES](key)
      ) {
        setMcpDetailsExpansionState({
          callId,
          expanded: !isMcpToolDetailsExpanded,
        });
        return true;
      }
      if (keyMatchers[Command.ESCAPE](key)) {
        setIsCancelling(true);
        return true;
      }
      if (keyMatchers[Command.QUIT](key)) {
        return false;
      }
      return false;
    },
    { isActive: isFocused, priority: true },
  );

  useEffect(() => {
    if (isCancelling) {
      handleConfirm(ToolConfirmationOutcome.Cancel);
    }
  }, [isCancelling, handleConfirm]);

  const handleSelect = useCallback(
    (item: ToolConfirmationOutcome) => handleConfirm(item),
    [handleConfirm],
  );

  const options = useConfirmationOptions(confirmationDetails, config, isDiffingEnabled);

  const { question, bodyContent, securityWarnings, initialIndex } = useMemo<{
    question: React.ReactNode;
    bodyContent: React.ReactNode;
    securityWarnings: React.ReactNode;
    initialIndex: number;
  }>(
    () =>
      computeConfirmationContent({
        confirmationDetails,
        options,
        terminalWidth,
        handleConfirm,
        deceptiveUrlWarningText,
        isMcpToolDetailsExpanded,
        hasMcpToolDetails,
        mcpToolDetailsText,
        expandDetailsHintKey,
        getPreferredEditor,
        isTrustedFolder,
        allowPermanentApproval,
        settings,
        activeTheme,
        config,
        toolName,
        measuredSecurityWarningsHeight,
        availableTerminalHeight,
        handlesOwnUI,
      }),
    [
      confirmationDetails,
      options,
      terminalWidth,
      handleConfirm,
      deceptiveUrlWarningText,
      isMcpToolDetailsExpanded,
      hasMcpToolDetails,
      mcpToolDetailsText,
      expandDetailsHintKey,
      getPreferredEditor,
      isTrustedFolder,
      allowPermanentApproval,
      settings,
      activeTheme,
      config,
      toolName,
      measuredSecurityWarningsHeight,
      availableTerminalHeight,
      handlesOwnUI,
    ],
  );

  const bodyOverflowDirection: 'top' | 'bottom' =
    confirmationDetails.type === 'mcp' && isMcpToolDetailsExpanded ? 'bottom' : 'top';

  const renderRadioItem = useCallback(
    (item: RadioSelectItem<ToolConfirmationOutcome>, { titleColor }: { titleColor: string }) => {
      if (item.value === ToolConfirmationOutcome.ProceedAlwaysAndSave) {
        return (
          <Text color={titleColor} wrap="truncate">
            {item.label}{' '}
            <Text color={theme.text.secondary}>~/.hive-mind/policies/auto-saved.toml</Text>
          </Text>
        );
      }
      return (
        <Text color={titleColor} wrap="truncate">
          {item.label}
        </Text>
      );
    },
    [],
  );

  return (
    <ToolConfirmationLayout
      confirmationDetails={confirmationDetails}
      handlesOwnUI={handlesOwnUI}
      bodyContent={bodyContent}
      question={question}
      securityWarnings={securityWarnings}
      options={options}
      initialIndex={initialIndex}
      isFocused={isFocused}
      terminalWidth={terminalWidth}
      bodyOverflowDirection={bodyOverflowDirection}
      handleSelect={handleSelect}
      renderRadioItem={renderRadioItem}
      onSecurityWarningsRefChange={onSecurityWarningsRefChange}
      getAvailableBodyContentHeight={() =>
        calculateBodyContentHeight({
          availableTerminalHeight,
          handlesOwnUI,
          optionsCount: options.length,
          measuredSecurityWarningsHeight,
          deceptiveUrlWarningText,
          confirmationDetails,
          config,
        })
      }
    />
  );
};
