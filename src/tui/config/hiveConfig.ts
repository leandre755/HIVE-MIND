/**
 * hiveConfig — Configuration minimale pour le TUI HIVE-MIND
 *
 * Comme WhatsApp/Telegram/Discord, le TUI est un simple transport.
 * Pas d'OAuth, pas d'extensions, pas de MCP — juste le pont vers le core.
 */

import { Storage } from '../ui/utils/Storage.js';
import { findHiveMdFilesSync, countHiveMdFilesSync, buildHiveMdContext } from '../utils/hiveMd.js';
import { hiveTransport } from '../transport/HiveTransport.js';
import crypto from 'node:crypto';

export interface MessageBus {
  subscribe(type: string, handler: (payload: unknown) => void): void;
  unsubscribe(type: string, handler: (payload: unknown) => void): void;
  publish(event: { type: string; [key: string]: unknown }): void;
}

export interface WorkspaceContext {
  getDirectories(): string[];
  addReadOnlyPath(path: string): void;
}

export interface HookSystem {
  fireSessionStartEvent(source: string): Promise<unknown> | unknown;
  fireSessionEndEvent(reason: string): Promise<unknown> | unknown;
}

export interface MemoryContextManager {
  refresh(): Promise<void>;
}

export interface InjectionService {
  addInjection(content: string, type: string): void;
}

export interface AgentRegistry {
  getAgents(): unknown[];
  acknowledgeAgent(agent: unknown): void;
  /** Trouve un agent par son nom, retourne null si absent. */
  getDefinition(name: string): unknown | null;
}

export interface FileService {
  /** Vérifie si le chemin doit être ignoré selon les options données. */
  shouldIgnoreFile(
    path: string,
    options?: { respectGitIgnore?: boolean; respectHiveIgnore?: boolean },
  ): boolean;
}

export interface ResourceRegistry {
  findResourceByUri(
    uri: string,
  ): { uri: string; serverName: string; mimeType?: string } | undefined;
}

export interface McpClientManager {
  getClient(serverName: string):
    | {
        readResource(
          uri: string,
          opts?: { signal?: AbortSignal },
        ): Promise<{ contents?: unknown[] }>;
      }
    | undefined;
}

export interface FileFilteringOptions {
  respectGitIgnore: boolean;
  respectHiveIgnore?: boolean;
  enableFileWatcher: boolean;
  maxFileCount: number;
  searchTimeout: number;
}

export interface ToolRegistry {
  getTool(name: string): unknown;
}

export interface ExtensionLoader {
  setRequestConsent(consent: unknown): void;
  setRequestSetting(setting: unknown): void;
  getExtensions(): unknown[];
}

export interface Experiments {
  flags: Record<string, boolean>;
}

export interface HiveConfig {
  getApiKey(): string;
  getModel(): string;
  setModel(model: string, tempOnly?: boolean): void;
  refreshUserQuota(): Promise<void>;
  get(key: string): unknown;
  getAll(): Record<string, unknown>;
  getUseAlternateBuffer(): boolean;
  getScreenReader(): boolean;
  getApprovalMode(): string;
  getProjectRoot(): string;
  getSessionId(): string;
  setSessionId(id: string): void;
  isSkillsSupportEnabled(): boolean;
  getMessageBus(): MessageBus;
  getFileFilteringOptions(): FileFilteringOptions;
  getFileService(): FileService;
  getToolRegistry(): ToolRegistry;
  getWorkspaceContext(): WorkspaceContext;
  getTargetDir(): string;
  getEnableRecursiveFileSearch(): boolean;
  validatePathAccess(path: string, mode: string): boolean;
  getIdeMode(): boolean;
  isBrowserLaunchSuppressed(): boolean;
  getContentGeneratorConfig(): { authType: string; apiKey?: string } | null;
  isModelSteeringEnabled(): boolean;
  isInteractiveShellEnabled(): boolean;
  isAutoMemoryEnabled(): boolean;
  reloadSkills(): Promise<void>;
  isInitialized(): boolean;
  initialize(): Promise<void>;
  getHookSystem(): HookSystem;
  refreshAuth(authType?: unknown): Promise<void>;
  getMemoryContextManager(): MemoryContextManager;
  updateSystemInstructionIfInitialized(): void;
  getUserMemory(): unknown;
  getHiveMdFileCount(): number;
  getHiveMdContext(): string;
  getDebugMode(): boolean;
  getUseTerminalBuffer(): boolean;
  getEnableExtensionReloading(): boolean;
  getExtensionLoader(): ExtensionLoader;
  setRemoteAdminSettings(settings: unknown): void;
  sanitizationConfig: unknown;
  sandboxManager: unknown;
  getRemoteAdminSettings(): unknown;
  getAgentRegistry(): AgentRegistry;
  getResourceRegistry(): ResourceRegistry;
  getMcpClientManager(): McpClientManager | null;
  getSkillManager(): { getDisplayableSkills(): unknown[] };
  setShellExecutionConfig(config: unknown): void;
  getQuestion(): string | null;
  isPlanEnabled(): boolean;
  getPolicyUpdateConfirmationRequest(): unknown;
  getBannerTextNoCapacityIssues(): string;
  getBannerTextCapacityIssues(): string;
  getTerminalBackground(): string;
  injectionService: InjectionService;
  storage: Storage;
  getExperiments(): Experiments;
  getUseBackgroundColor(): boolean;
  getWorktreeSettings(): { enabled: boolean };
  getSandboxEnabled(): boolean;
  isYoloModeDisabled(): boolean;
  getEnableInteractiveShell(): boolean;
  setTerminalBackground(color: string): void;
  getDisableAlwaysAllow(): boolean;
  isTrustedFolder(): boolean;
  enablePermanentToolApproval?: boolean;
  autoAddToPolicyByDefault?: boolean;
  answers?: unknown;
}

let currentSessionId = `tui-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;

// hive.md helper functions are imported from utils/hiveMd.js

export function createHiveConfig(): HiveConfig {
  let currentModel = process.env.HIVE_MODEL || 'default';
  return {
    getApiKey: () => process.env.GOOGLE_AI_KEY || '',
    getModel: () => currentModel,
    setModel: (model: string, _tempOnly?: boolean) => {
      currentModel = model;
      // Also update the core smart router
      import('../../providers/index.js')
        .then(({ providerRouter }) => {
          const parsed = providerRouter.parseModelString(model);
          if (parsed) {
            providerRouter.forcedFamily = parsed.family;
            providerRouter.forcedModel = parsed.model;
          } else {
            providerRouter.forcedFamily = undefined;
            providerRouter.forcedModel = model;
          }
        })
        .catch((err) => {
          console.error('[HiveConfig] Failed to update providerRouter:', err);
        });
    },
    refreshUserQuota: async () => {},
    get: (key: string) => {
      const map = new Map<string, unknown>([
        ['useAlternateBuffer', false],
        ['screenReader', false],
        ['approvalMode', 'default'],
        ['theme', undefined],
      ]);
      return map.get(key) ?? null;
    },
    getAll: () => ({}),
    getUseAlternateBuffer: () => false,
    getScreenReader: () => false,
    getApprovalMode: () => 'default',
    getProjectRoot: () => process.cwd(),
    getSessionId: () => currentSessionId,
    setSessionId: (id: string) => {
      currentSessionId = id;
      hiveTransport.setSessionId(id);
    },

    isSkillsSupportEnabled: () => false,

    getMessageBus: () => ({
      subscribe: () => {
        /* noop */
      },
      unsubscribe: () => {
        /* noop */
      },
      publish: () => {
        /* noop */
      },
    }),
    getFileService: () => ({
      shouldIgnoreFile: () => false,
    }),
    getFileFilteringOptions: () => ({
      respectGitIgnore: true,
      respectHiveIgnore: true,
      enableFileWatcher: false,
      maxFileCount: 1000,
      searchTimeout: 5000,
    }),
    getToolRegistry: () => ({
      getTool: () => null,
    }),
    getWorkspaceContext: () => ({
      getDirectories: () => [process.cwd()],
      addReadOnlyPath: (_p: string) => {
        /* noop */
      },
    }),
    getTargetDir: () => process.cwd(),
    getEnableRecursiveFileSearch: () => true,
    validatePathAccess: () => true,
    getIdeMode: () => false,
    isBrowserLaunchSuppressed: () => false,
    getContentGeneratorConfig: () => ({
      authType: 'api_key',
      apiKey: process.env.GOOGLE_AI_KEY || '',
    }),
    isModelSteeringEnabled: () => false,
    isInteractiveShellEnabled: () => true,
    isAutoMemoryEnabled: () => false,
    reloadSkills: () => Promise.resolve(),
    isInitialized: () => true,
    initialize: () => Promise.resolve(),
    getHookSystem: () => ({
      fireSessionStartEvent: () => Promise.resolve(),
      fireSessionEndEvent: () => Promise.resolve(),
    }),
    refreshAuth: () => Promise.resolve(),
    getMemoryContextManager: () => ({
      refresh: () => Promise.resolve(),
    }),
    updateSystemInstructionIfInitialized: () => {},
    getUserMemory: () => ({}),
    getHiveMdFileCount: () => {
      const root = process.cwd();
      return countHiveMdFilesSync(root);
    },
    getHiveMdContext: () => {
      const root = process.cwd();
      const files = findHiveMdFilesSync(root);
      return buildHiveMdContext(files);
    },
    getDebugMode: () => false,
    getUseTerminalBuffer: () => false,
    getEnableExtensionReloading: () => false,
    getExtensionLoader: () => ({
      setRequestConsent: () => {},
      setRequestSetting: () => {},
      getExtensions: () => [],
    }),
    setRemoteAdminSettings: () => {},
    sanitizationConfig: {},
    sandboxManager: {},
    getRemoteAdminSettings: () => ({}),
    getAgentRegistry: () => ({
      getAgents: () => [],
      acknowledgeAgent: () => {},
      getDefinition: (_name: string) => null,
    }),
    getResourceRegistry: () => ({
      findResourceByUri: (_uri: string) => undefined,
    }),
    getMcpClientManager: () => null,
    getSkillManager: () => ({
      getDisplayableSkills: () => [],
    }),
    setShellExecutionConfig: () => {},
    getQuestion: () => null,
    isPlanEnabled: () => false,
    getPolicyUpdateConfirmationRequest: () => null,
    getBannerTextNoCapacityIssues: () => 'HIVE-MIND TUI',
    getBannerTextCapacityIssues: () => 'HIVE-MIND TUI',
    getTerminalBackground: () => '#000000',
    injectionService: {
      addInjection: () => {},
    },
    storage: new Storage(),
    getExperiments: () => ({ flags: {} }),
    getUseBackgroundColor: () => false,
    getWorktreeSettings: () => ({ enabled: false }),
    getSandboxEnabled: () => false,
    isYoloModeDisabled: () => true,
    getEnableInteractiveShell: () => true,
    setTerminalBackground: (_color: string) => {},
    getDisableAlwaysAllow: () => false,
    isTrustedFolder: () => true,
  };
}

export const hiveConfig = createHiveConfig();
hiveTransport.setSessionId(hiveConfig.getSessionId());
