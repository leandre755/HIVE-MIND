/**
 * @license
 * Copyright 2025 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo, useEffect, useState, useRef } from 'react';
import process from 'node:process';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';
import { useSessionStats } from '../contexts/SessionContext.js';
import type { LoadedSettings } from '../../config/settings.js';
import { CommandService } from '../../services/CommandService.js';
import { BuiltinCommandLoader } from '../../services/BuiltinCommandLoader.js';
import { parseSlashCommand } from '../../utils/commands.js';
import { runExitCleanup } from '../../utils/cleanup.js';
import { coreEvents } from '../../utils/coreEvents.js';
import { HiveConfig } from '../../config/hiveConfig.js';
import {
  MessageType,
  ToolConfirmationOutcome,
  CoreToolCallStatus,
  IdeClient,
  SlashCommandStatus,
  makeSlashCommandEvent,
  logSlashCommand,
  addMCPStatusChangeListener,
  removeMCPStatusChangeListener,
  GitService,
  Logger,
  Storage,
  MCPDiscoveryState,
  type CommandContext,
  type SlashCommand,
  type HistoryItem,
  type HistoryItemWithoutId,
  type ConfirmationRequest,
  type AgentDefinition,
  type ToolCallConfirmationDetails,
  type IndividualToolCallDisplay,
  type Message,
  type SlashCommandResult,
  type SlashCommandProcessorResult,
  type ExtensionUpdateAction,
  type ExtensionUpdateStatus,
  type PartListUnion,
} from '../contexts/UIStateContext.js';

interface SlashCommandProcessorActions {
  openThemeDialog: () => void;
  openEditorDialog: () => void;
  openPrivacyNotice: () => void;
  openSettingsDialog: () => void;
  openSessionBrowser: () => void;
  openModelDialog: () => void;

  openAgentConfigDialog: (name: string, displayName: string, definition: AgentDefinition) => void;
  openPermissionsDialog: (props?: { targetDirectory?: string }) => void;
  quit: (messages: HistoryItem[]) => void;
  setDebugMessage: (message: string) => void;
  toggleCorgiMode: () => void;

  toggleDebugProfiler: () => void;
  dispatchExtensionStateUpdate: (action: ExtensionUpdateAction) => void;
  addConfirmUpdateExtensionRequest: (request: ConfirmationRequest) => void;
  toggleBackgroundTasks: () => void;
  toggleShortcutsHelp: () => void;
  setText: (text: string) => void;
}

async function deleteCurrentSessionRecording(_config: HiveConfig | null): Promise<void> {
  // Session recording deletion handled by Core / SessionManager
}

interface SlashCommandResultContext {
  commandContext: CommandContext;
  addItem: UseHistoryManagerReturn['addItem'];
  addMessage: (message: Message) => void;
  actions: SlashCommandProcessorActions;
  setCustomDialog: (dialog: React.ReactNode | null) => void;
  setPendingItem: React.Dispatch<React.SetStateAction<HistoryItemWithoutId | null>>;
  setSessionShellAllowlist: React.Dispatch<React.SetStateAction<Set<string>>>;
  setConfirmationRequest: React.Dispatch<
    React.SetStateAction<{
      prompt: React.ReactNode;
      onConfirm: (confirmed: boolean) => void;
    } | null>
  >;
  config: HiveConfig | null;
  handleSlashCommand: (
    rawQuery: PartListUnion | string,
    oneTimeShellAllowlist?: Set<string>,
    overwriteConfirmed?: boolean,
    addToHistory?: boolean,
  ) => Promise<SlashCommandProcessorResult | false>;
}

async function handleCommandResult(
  result: SlashCommandResult,
  ctx: SlashCommandResultContext,
): Promise<SlashCommandProcessorResult> {
  switch (result.type) {
    case 'tool':
      return {
        type: 'schedule_tool',
        toolName: result.toolName,
        toolArgs: result.toolArgs,
        postSubmitPrompt: result.postSubmitPrompt,
      };
    case 'message':
      ctx.addItem(
        {
          type: result.messageType === 'error' ? MessageType.ERROR : MessageType.INFO,
          text: result.content,
        },
        Date.now(),
      );
      return { type: 'handled' };
    case 'logout':
      ctx.addItem({ type: MessageType.INFO, text: 'Logging out and exiting...' }, Date.now());
      await runExitCleanup();
      process.exit(0);
      return { type: 'handled' };
    case 'dialog':
      return handleDialogResult(result, ctx);
    case 'load_history':
      ctx.commandContext.ui?.clear();
      result.history.forEach((item, index) => {
        ctx.commandContext.ui?.addItem(item, index);
      });
      return { type: 'handled' };
    case 'quit':
      if (result.deleteSession) {
        try {
          await deleteCurrentSessionRecording(ctx.config);
        } catch {
          /* ok */
        }
      }
      ctx.actions.quit(result.messages ?? []);
      return { type: 'handled' };
    case 'submit_prompt':
      return { type: 'submit_prompt', content: result.content };
    case 'confirm_shell_commands':
      return handleConfirmShellCommands(result, ctx);
    case 'confirm_action':
      return handleConfirmAction(result, ctx);
    case 'custom_dialog':
      ctx.setCustomDialog(result.component);
      return { type: 'handled' };
    default: {
      const unhandled = result as unknown;
      throw new Error(`Unhandled slash command result: ${String(unhandled)}`);
    }
  }
}

function handleDialogResult(
  result: Extract<SlashCommandResult, { type: 'dialog' }>,
  ctx: SlashCommandResultContext,
): SlashCommandProcessorResult {
  const a = ctx.actions;
  const dialogMap: Record<string, () => void> = {
    theme: () => a.openThemeDialog(),
    editor: () => a.openEditorDialog(),
    privacy: () => a.openPrivacyNotice(),
    sessionBrowser: () => a.openSessionBrowser(),
    settings: () => a.openSettingsDialog(),
    model: () => a.openModelDialog(),
    permissions: () => a.openPermissionsDialog(result.props as { targetDirectory?: string }),
    help: () => {},
  };
  if (result.dialog === 'agentConfig') {
    const props = result.props as Record<string, unknown>;
    if (
      !props ||
      typeof props['name'] !== 'string' ||
      typeof props['displayName'] !== 'string' ||
      !props['definition']
    ) {
      throw new Error('Received invalid properties for agentConfig dialog action.');
    }
    a.openAgentConfigDialog(
      props['name'],
      props['displayName'],
      props['definition'] as AgentDefinition,
    );
    return { type: 'handled' };
  }
  const handler = dialogMap[result.dialog];
  if (handler) {
    handler();
    return { type: 'handled' };
  }
  const unhandled = result.dialog as unknown;
  throw new Error(`Unhandled dialog type: ${String(unhandled)}`);
}

async function handleConfirmShellCommands(
  result: Extract<SlashCommandResult, { type: 'confirm_shell_commands' }>,
  ctx: SlashCommandResultContext,
): Promise<SlashCommandProcessorResult> {
  const callId = `expansion-${Date.now()}`;
  const { outcome, approvedCommands } = await new Promise<{
    outcome: ToolConfirmationOutcome;
    approvedCommands?: string[];
  }>((resolve) => {
    const confirmationDetails: ToolCallConfirmationDetails = {
      type: 'exec',
      title: 'Confirm Shell Expansion',
      command: result.commandsToConfirm[0] || '',
      rootCommand: result.commandsToConfirm[0] || '',
      rootCommands: result.commandsToConfirm,
      commands: result.commandsToConfirm,
      onConfirm: async (resolvedOutcome) => {
        resolve({
          outcome: resolvedOutcome,
          approvedCommands:
            resolvedOutcome === ToolConfirmationOutcome.Cancel ? [] : result.commandsToConfirm,
        });
      },
    };
    const toolDisplay: IndividualToolCallDisplay = {
      callId,
      name: 'Expansion',
      description: 'Command expansion needs shell access',
      status: CoreToolCallStatus.AwaitingApproval,
      isClientInitiated: true,
      resultDisplay: undefined,
      confirmationDetails,
    };
    ctx.setPendingItem({ type: 'tool_group', tools: [toolDisplay] });
  });
  ctx.setPendingItem(null);
  if (
    outcome === ToolConfirmationOutcome.Cancel ||
    !approvedCommands ||
    approvedCommands.length === 0
  ) {
    ctx.addItem(
      { type: MessageType.INFO, text: 'Slash command shell execution declined.' },
      Date.now(),
    );
    return { type: 'handled' };
  }
  if (outcome === ToolConfirmationOutcome.ProceedAlways) {
    ctx.setSessionShellAllowlist((prev) => new Set([...prev, ...approvedCommands]));
  }
  return (
    (await ctx.handleSlashCommand(
      result.originalInvocation.raw,
      new Set(approvedCommands),
      undefined,
      false,
    )) || { type: 'handled' }
  );
}

async function handleConfirmAction(
  result: Extract<SlashCommandResult, { type: 'confirm_action' }>,
  ctx: SlashCommandResultContext,
): Promise<SlashCommandProcessorResult> {
  const { confirmed } = await new Promise<{ confirmed: boolean }>((resolve) => {
    ctx.setConfirmationRequest({
      prompt: result.prompt,
      onConfirm: (resolvedConfirmed) => {
        ctx.setConfirmationRequest(null);
        resolve({ confirmed: resolvedConfirmed });
      },
    });
  });
  if (!confirmed) {
    ctx.addItem({ type: MessageType.INFO, text: 'Operation cancelled.' }, Date.now());
    return { type: 'handled' };
  }
  return (
    (await ctx.handleSlashCommand(result.originalInvocation.raw, undefined, true)) || {
      type: 'handled',
    }
  );
}

interface SlashCommandHandlerContext {
  commands: readonly SlashCommand[];
  config: HiveConfig | null;
  commandContext: CommandContext;
  addItem: UseHistoryManagerReturn['addItem'];
  addMessage: (message: Message) => void;
  setIsProcessing: (isProcessing: boolean) => void;
  actions: SlashCommandProcessorActions;
  setCustomDialog: (dialog: React.ReactNode | null) => void;
  setPendingItem: React.Dispatch<React.SetStateAction<HistoryItemWithoutId | null>>;
  setSessionShellAllowlist: React.Dispatch<React.SetStateAction<Set<string>>>;
  setConfirmationRequest: React.Dispatch<
    React.SetStateAction<{
      prompt: React.ReactNode;
      onConfirm: (confirmed: boolean) => void;
    } | null>
  >;
}

type SelfRefType = {
  current:
    | ((
        q: PartListUnion | string,
        al?: Set<string>,
        oc?: boolean,
        ah?: boolean,
      ) => Promise<SlashCommandProcessorResult | false>)
    | null;
};

function parseQueryString(rawQuery: PartListUnion | string): string {
  if (typeof rawQuery === 'string') return rawQuery;
  const pq = rawQuery as unknown as { parts?: { text?: string }[] };
  return pq.parts?.map((p) => p.text ?? '').join('') || '';
}

function handleUnknownCommand(
  trimmed: string,
  addToHistory: boolean,
  hctx: SlashCommandHandlerContext,
): SlashCommandProcessorResult | false {
  const isMcpLoading =
    (hctx.config as unknown as { getMcpClientManager?: () => { getDiscoveryState?: () => string } })
      ?.getMcpClientManager?.()
      ?.getDiscoveryState?.() === MCPDiscoveryState.IN_PROGRESS;

  if (isMcpLoading) {
    hctx.setIsProcessing(true);
    if (addToHistory) hctx.addItem({ type: MessageType.USER, text: trimmed }, Date.now());
    hctx.addMessage({
      type: MessageType.ERROR,
      content: `Unknown command: ${trimmed}. Command might have been from an MCP server but MCP servers are not done loading.`,
      timestamp: new Date(),
    });
    hctx.setIsProcessing(false);
    return { type: 'handled' };
  }
  return false;
}

function createFullContext(
  trimmed: string,
  commandToExecute: SlashCommand,
  args: string,
  oneTimeShellAllowlist: Set<string> | undefined,
  overwriteConfirmed: boolean | undefined,
  hctx: SlashCommandHandlerContext,
): CommandContext {
  const fullCommandContext: CommandContext = {
    ...hctx.commandContext,
    invocation: { raw: trimmed, name: commandToExecute.name, args },
    overwriteConfirmed,
  };

  if (oneTimeShellAllowlist && oneTimeShellAllowlist.size > 0) {
    const currentSession = fullCommandContext.session;
    fullCommandContext.session = {
      ...currentSession,
      sessionShellAllowlist: new Set([
        ...(currentSession?.sessionShellAllowlist ?? []),
        ...oneTimeShellAllowlist,
      ]),
    } as unknown as CommandContext['session'];
  }
  return fullCommandContext;
}

async function doExecuteSlashCommand(
  trimmed: string,
  commandToExecute: SlashCommand,
  args: string,
  oneTimeShellAllowlist: Set<string> | undefined,
  overwriteConfirmed: boolean | undefined,
  hctx: SlashCommandHandlerContext,
  selfRef: SelfRefType,
): Promise<SlashCommandProcessorResult | false> {
  if (!commandToExecute.action) {
    if (commandToExecute.subCommands) {
      const subList = commandToExecute.subCommands
        .map((sc) => `  - ${sc.name}: ${sc.description || ''}`)
        .join('\n');
      const helpText = `Command '/${commandToExecute.name}' requires a subcommand. Available:\n${subList}`;
      hctx.addMessage({ type: MessageType.INFO, content: helpText, timestamp: new Date() });
    }
    return { type: 'handled' };
  }

  const fullCommandContext = createFullContext(
    trimmed,
    commandToExecute,
    args,
    oneTimeShellAllowlist,
    overwriteConfirmed,
    hctx,
  );

  const result = await commandToExecute.action(fullCommandContext, args);
  if (result) {
    return handleCommandResult(result as SlashCommandResult, {
      commandContext: hctx.commandContext,
      addItem: hctx.addItem,
      addMessage: hctx.addMessage,
      actions: hctx.actions,
      setCustomDialog: hctx.setCustomDialog,
      setPendingItem: hctx.setPendingItem,
      setSessionShellAllowlist: hctx.setSessionShellAllowlist,
      setConfirmationRequest: hctx.setConfirmationRequest,
      config: hctx.config,
      handleSlashCommand: (q, al, oc, ah) =>
        selfRef.current?.(q, al, oc, ah) ?? Promise.resolve(false),
    });
  }
  return { type: 'handled' };
}

async function executeSlashCommand(
  rawQuery: PartListUnion | string,
  oneTimeShellAllowlist: Set<string> | undefined,
  overwriteConfirmed: boolean | undefined,
  addToHistory: boolean,
  hctx: SlashCommandHandlerContext,
  selfRef: SelfRefType,
): Promise<SlashCommandProcessorResult | false> {
  if (!hctx.commands) return false;
  const queryString = parseQueryString(rawQuery);
  if (!queryString) return false;

  const trimmed = queryString.trim();
  if (!trimmed.startsWith('/') && !trimmed.startsWith('?')) return false;

  const {
    commandToExecute,
    args,
    canonicalPath: resolvedCommandPath,
  } = parseSlashCommand(trimmed, hctx.commands);

  if (!commandToExecute) {
    return handleUnknownCommand(trimmed, addToHistory, hctx);
  }

  hctx.setIsProcessing(true);
  if (addToHistory) hctx.addItem({ type: MessageType.USER, text: trimmed }, Date.now());

  let hasError = false;
  const subcommand =
    resolvedCommandPath.length > 1 ? resolvedCommandPath.slice(1).join(' ') : undefined;

  try {
    return await doExecuteSlashCommand(
      trimmed,
      commandToExecute,
      args,
      oneTimeShellAllowlist,
      overwriteConfirmed,
      hctx,
      selfRef,
    );
  } catch (e: unknown) {
    hasError = true;
    if (hctx.config) {
      const event = makeSlashCommandEvent({
        command: resolvedCommandPath[0] || '',
        subcommand,
        status: SlashCommandStatus.ERROR,
        extension_id: commandToExecute?.extensionId,
      });
      logSlashCommand(hctx.config, event);
    }
    hctx.addItem(
      { type: MessageType.ERROR, text: e instanceof Error ? e.message : String(e) },
      Date.now(),
    );
    return { type: 'handled' };
  } finally {
    if (hctx.config && resolvedCommandPath[0] && !hasError) {
      const event = makeSlashCommandEvent({
        command: resolvedCommandPath[0],
        subcommand,
        status: SlashCommandStatus.SUCCESS,
        extension_id: commandToExecute?.extensionId,
      });
      logSlashCommand(hctx.config, event);
    }
    hctx.setIsProcessing(false);
  }
}

function useSlashCommandMessages(addItem: UseHistoryManagerReturn['addItem']) {
  return useCallback(
    (message: Message) => {
      const typeMap: Record<string, string> = {
        [MessageType.ABOUT]: 'about',
        [MessageType.HELP]: 'help',
        [MessageType.STATS]: 'stats',
        [MessageType.MODEL_STATS]: 'model_stats',
        [MessageType.TOOL_STATS]: 'tool_stats',
        [MessageType.QUIT]: 'quit',
        [MessageType.COMPRESSION]: 'compression',
      };
      const mappedType = typeMap[message.type];
      let historyItemContent: HistoryItemWithoutId;
      if (mappedType) {
        historyItemContent = {
          type: mappedType,
          ...(message.type === MessageType.ABOUT
            ? {
                cliVersion: (message as unknown as { cliVersion: string }).cliVersion,
                osVersion: (message as unknown as { osVersion: string }).osVersion,
                sandboxEnv: (message as unknown as { sandboxEnv: string }).sandboxEnv,
                modelVersion: (message as unknown as { modelVersion: string }).modelVersion,
                selectedAuthType: (message as unknown as { selectedAuthType: string })
                  .selectedAuthType,
                gcpProject: (message as unknown as { gcpProject: string }).gcpProject,
                ideClient: (message as unknown as { ideClient: string }).ideClient,
              }
            : {}),
          ...(message.type === MessageType.HELP ? { timestamp: message.timestamp } : {}),
          ...(message.type === MessageType.STATS
            ? { duration: (message as unknown as { duration: number }).duration }
            : {}),
          ...(message.type === MessageType.QUIT
            ? { duration: (message as unknown as { duration: number }).duration }
            : {}),
          ...(message.type === MessageType.COMPRESSION
            ? { compression: (message as unknown as { compression: unknown }).compression }
            : {}),
        } as HistoryItemWithoutId;
      } else {
        historyItemContent = { type: message.type, text: message.content };
      }
      addItem(historyItemContent, message.timestamp.getTime());
    },
    [addItem],
  );
}

function useSlashCommandLoader(config: HiveConfig | null, isConfigInitialized: boolean) {
  const [commands, setCommands] = useState<readonly SlashCommand[] | undefined>(undefined);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  const reloadCommands = useCallback(() => {
    setReloadTrigger((v) => v + 1);
  }, []);

  useEffect(() => {
    if (!config) return;

    const listener = () => reloadCommands();
    let isActive = true;
    let activeIdeClient: IdeClient | undefined;

    (async () => {
      const ideClient = await IdeClient.getInstance();
      if (!isActive) return;
      activeIdeClient = ideClient;
      ideClient.addStatusChangeListener(listener);
    })();

    addMCPStatusChangeListener(listener);

    const extensionEventListener = () => reloadCommands();
    coreEvents.on('extensionsStarting', extensionEventListener);
    coreEvents.on('extensionsStopping', extensionEventListener);

    return () => {
      isActive = false;
      activeIdeClient?.removeStatusChangeListener(listener);
      removeMCPStatusChangeListener(listener);
      coreEvents.off('extensionsStarting', extensionEventListener);
      coreEvents.off('extensionsStopping', extensionEventListener);
    };
  }, [config, reloadCommands]);

  useEffect(() => {
    const controller = new AbortController();

    (async () => {
      const commandService = await CommandService.create(
        [new BuiltinCommandLoader()],
        controller.signal,
      );

      if (controller.signal.aborted) return;
      setCommands(commandService.getCommands());
    })();

    return () => controller.abort();
  }, [config, reloadTrigger, isConfigInitialized]);

  return { commands, reloadCommands };
}

/**
 * Hook to define and process slash commands (e.g., /help, /clear).
 */
export const useSlashCommandProcessor = (
  config: HiveConfig | null,
  settings: LoadedSettings,
  addItem: UseHistoryManagerReturn['addItem'],
  clearItems: UseHistoryManagerReturn['clearItems'],
  loadHistory: UseHistoryManagerReturn['loadHistory'],
  refreshStatic: () => void,
  toggleVimEnabled: () => Promise<boolean>,
  setIsProcessing: (isProcessing: boolean) => void,
  actions: SlashCommandProcessorActions,
  extensionsUpdateState: Map<string, ExtensionUpdateStatus>,
  isConfigInitialized: boolean,
  setBannerVisible: (visible: boolean) => void,
  setCustomDialog: (dialog: React.ReactNode | null) => void,
) => {
  const session = useSessionStats();
  const { commands, reloadCommands } = useSlashCommandLoader(config, isConfigInitialized);

  const [confirmationRequest, setConfirmationRequest] = useState<null | {
    prompt: React.ReactNode;
    onConfirm: (confirmed: boolean) => void;
  }>(null);

  const [sessionShellAllowlist, setSessionShellAllowlist] = useState(new Set<string>());
  const gitService = useMemo(() => {
    if (!config?.getProjectRoot()) return;
    return new GitService(config.getProjectRoot(), config.storage);
  }, [config]);

  const logger = useMemo(() => {
    return new Logger(config?.getSessionId() || '', config?.storage ?? new Storage(process.cwd()));
  }, [config]);

  const [pendingItem, setPendingItem] = useState<HistoryItemWithoutId | null>(null);

  const pendingHistoryItems = useMemo(() => {
    const items: HistoryItemWithoutId[] = [];
    if (pendingItem != null) {
      items.push(pendingItem);
    }
    return items;
  }, [pendingItem]);

  const addMessage = useSlashCommandMessages(addItem);

  const clearUi = useCallback(() => {
    clearItems();
    refreshStatic();
    setBannerVisible(false);
  }, [clearItems, refreshStatic, setBannerVisible]);

  const loadHistoryUi = useCallback(
    (history: unknown, postLoadInput: unknown) => {
      loadHistory(history as HistoryItem[]);
      refreshStatic();
      if (postLoadInput !== undefined) {
        actions.setText(postLoadInput as string);
      }
    },
    [loadHistory, refreshStatic, actions],
  );

  const removeComponentUi = useCallback(() => {
    setCustomDialog(null);
  }, [setCustomDialog]);

  const commandContext = useMemo(
    (): CommandContext =>
      ({
        services: { agentContext: config, settings, git: gitService, logger },
        ui: {
          addItem,
          clear: clearUi,
          loadHistory: loadHistoryUi,
          setDebugMessage: actions.setDebugMessage,
          pendingItem,
          setPendingItem,
          toggleCorgiMode: actions.toggleCorgiMode,
          toggleDebugProfiler: actions.toggleDebugProfiler,
          toggleVimEnabled,
          reloadCommands,
          openAgentConfigDialog: actions.openAgentConfigDialog,
          extensionsUpdateState,
          dispatchExtensionStateUpdate: actions.dispatchExtensionStateUpdate,
          addConfirmUpdateExtensionRequest: actions.addConfirmUpdateExtensionRequest,
          setConfirmationRequest: setConfirmationRequest as React.Dispatch<
            React.SetStateAction<ConfirmationRequest | null>
          >,
          removeComponent: removeComponentUi,
          toggleBackgroundTasks: actions.toggleBackgroundTasks,
          toggleShortcutsHelp: actions.toggleShortcutsHelp,
        } as unknown as CommandContext['ui'],
        session: { stats: session.stats, sessionShellAllowlist },
      }) as unknown as CommandContext,
    [
      config,
      settings,
      gitService,
      logger,
      loadHistoryUi,
      addItem,
      clearUi,
      session.stats,
      actions,
      pendingItem,
      setPendingItem,
      setConfirmationRequest,
      toggleVimEnabled,
      sessionShellAllowlist,
      reloadCommands,
      extensionsUpdateState,
      removeComponentUi,
    ],
  );

  const selfRef = useRef<SelfRefType['current']>(null);

  const handleSlashCommand = useCallback(
    (
      rawQuery: PartListUnion | string,
      oneTimeShellAllowlist?: Set<string>,
      overwriteConfirmed?: boolean,
      addToHistory: boolean = true,
    ): Promise<SlashCommandProcessorResult | false> => {
      return executeSlashCommand(
        rawQuery,
        oneTimeShellAllowlist,
        overwriteConfirmed,
        addToHistory,
        {
          commands: commands || [],
          config,
          commandContext,
          addItem,
          addMessage,
          setIsProcessing,
          actions,
          setCustomDialog,
          setPendingItem,
          setSessionShellAllowlist,
          setConfirmationRequest,
        },
        selfRef,
      );
    },
    [
      config,
      addItem,
      actions,
      commands,
      commandContext,
      addMessage,
      setSessionShellAllowlist,
      setIsProcessing,
      setConfirmationRequest,
      setCustomDialog,
    ],
  );
  selfRef.current = handleSlashCommand;

  return {
    handleSlashCommand,
    slashCommands: commands,
    pendingHistoryItems,
    commandContext,
    confirmationRequest,
  };
};
