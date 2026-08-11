/**
 * hiveSettingsSchema — Schéma de configuration simplifié pour la TUI HIVE-MIND
 */

export interface SettingDefinition {
  type: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object';
  ref?: string;
  label?: string;
  description: string;
  options?: ReadonlyArray<{ value: string | number | boolean; label: string }>;
  properties?: Record<string, SettingDefinition>;
  items?: SettingCollectionDefinition;
  additionalProperties?: SettingCollectionDefinition;
  mergeStrategy?: MergeStrategy;
  default?: unknown;
  category?: string;
  showInDialog?: boolean;
  requiresRestart?: boolean;
  unit?: string;
}

export interface SettingCollectionDefinition {
  type: 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object';
  ref?: string;
  options?: ReadonlyArray<{ value: string | number | boolean; label: string }>;
  properties?: Record<string, SettingDefinition>;
  mergeStrategy?: MergeStrategy;
}

export const SETTINGS_SCHEMA_DEFINITIONS: Record<string, unknown> = {
  TelemetrySettings: {
    type: 'object',
    properties: {
      enabled: { type: 'boolean', description: 'Enable anonymous usage statistics' },
    },
  },
};

const hiveSchema: Record<string, SettingDefinition> = {
  defaultModel: {
    type: 'string',
    description: 'Default LLM model to use',
    default: 'default',
  },
  temperature: {
    type: 'number',
    description: 'LLM temperature (0.0 to 1.0)',
    default: 0.7,
  },
  approvalMode: {
    type: 'enum',
    description: 'Human-in-the-Loop permission approval mode',
    options: [
      { value: 'always', label: 'Always ask for permission' },
      { value: 'never', label: 'Never ask (fully autonomous)' },
      { value: 'semi', label: 'Semi-autonomous (ask for sensitive tools only)' },
    ],
    default: 'semi',
  },
  trustedFolders: {
    type: 'array',
    description: 'List of folders trusted for code execution',
    items: { type: 'string' },
    default: [],
  },
  theme: {
    type: 'string',
    description: 'Terminal UI theme name',
    default: 'default-dark',
  },
  general: {
    type: 'object',
    description: 'General settings',
    properties: {
      preferredEditor: { type: 'string', description: 'Preferred editor', default: '' },
      debugKeystrokeLogging: {
        type: 'boolean',
        description: 'Enable keystroke logging',
        default: false,
      },
      devtools: { type: 'boolean', description: 'Enable developer tools', default: false },
      sessionRetention: {
        type: 'object',
        description: 'Session retention settings',
        properties: {
          enabled: { type: 'boolean', description: 'Enable session retention', default: false },
          maxAge: { type: 'string', description: 'Max age of sessions to keep', default: '30d' },
          maxCount: { type: 'number', description: 'Max count of sessions to keep', default: 100 },
          minRetention: { type: 'string', description: 'Min retention duration', default: '1d' },
        },
        default: {
          enabled: false,
          maxAge: '30d',
          maxCount: 100,
          minRetention: '1d',
        },
      },
    },
    default: {
      preferredEditor: '',
      debugKeystrokeLogging: false,
      devtools: false,
      sessionRetention: {
        enabled: false,
        maxAge: '30d',
        maxCount: 100,
        minRetention: '1d',
      },
    },
  },
  ui: {
    type: 'object',
    description: 'UI settings',
    properties: {
      theme: { type: 'string', description: 'UI theme', default: 'default-dark' },
      hideBanner: { type: 'boolean', description: 'Hide startup banner', default: false },
      hideTips: { type: 'boolean', description: 'Hide status tips', default: false },
      hideFooter: { type: 'boolean', description: 'Hide footer', default: false },
      showUserIdentity: { type: 'boolean', description: 'Show user identity', default: true },
      showSpinner: { type: 'boolean', description: 'Show progress spinner', default: true },
      hideWindowTitle: { type: 'boolean', description: 'Hide window title', default: false },
      showStatusInTitle: {
        type: 'boolean',
        description: 'Show status in window title',
        default: true,
      },
      dynamicWindowTitle: {
        type: 'boolean',
        description: 'Dynamically update window title',
        default: true,
      },
      loadingPhrases: {
        type: 'enum',
        description: 'Loading phrases mode',
        options: [
          { value: 'tips', label: 'Tips' },
          { value: 'witty', label: 'Witty' },
          { value: 'all', label: 'All' },
          { value: 'off', label: 'Off' },
        ],
        default: 'tips',
      },
      customWittyPhrases: {
        type: 'array',
        description: 'Custom witty loading phrases',
        default: [],
      },
      errorVerbosity: {
        type: 'enum',
        description: 'Error message verbosity',
        options: [
          { value: 'low', label: 'Low' },
          { value: 'full', label: 'Full' },
        ],
        default: 'full',
      },
      escapePastedAtSymbols: {
        type: 'boolean',
        description: 'Escape pasted @ symbols',
        default: false,
      },
      footer: {
        type: 'object',
        description: 'Footer items configuration',
        properties: {
          hideCWD: {
            type: 'boolean',
            description: 'Hide current working directory',
            default: false,
          },
          hideSandboxStatus: {
            type: 'boolean',
            description: 'Hide sandbox status indicator',
            default: false,
          },
          hideModelInfo: { type: 'boolean', description: 'Hide model information', default: false },
          hideContextPercentage: {
            type: 'boolean',
            description: 'Hide context percentage',
            default: false,
          },
          items: {
            type: 'array',
            description: 'Footer items order',
            default: ['workspace', 'sandbox', 'model-name', 'context-used'],
          },
          showLabels: {
            type: 'boolean',
            description: 'Show text labels in footer',
            default: false,
          },
        },
        default: {
          hideCWD: false,
          hideSandboxStatus: false,
          hideModelInfo: false,
          hideContextPercentage: false,
          items: ['workspace', 'sandbox', 'model-name', 'context-used'],
          showLabels: false,
        },
      },
      showMemoryUsage: {
        type: 'boolean',
        description: 'Show memory usage indicator',
        default: false,
      },
      showLineNumbers: {
        type: 'boolean',
        description: 'Show line numbers in code blocks',
        default: true,
      },
      useAlternateBuffer: {
        type: 'boolean',
        description: 'Use alternate screen buffer',
        default: false,
      },
      autoThemeSwitching: {
        type: 'boolean',
        description: 'Automatically switch theme based on terminal background color',
        default: false,
      },
      terminalBackgroundPollingInterval: {
        type: 'number',
        description: 'Polling interval in seconds to check terminal background color',
        default: 5,
      },
      customThemes: { type: 'object', description: 'Custom themes definition', default: {} },
      collapseDrawerDuringApproval: {
        type: 'boolean',
        description: 'Collapse the side drawer during tool approvals',
        default: true,
      },
    },
    default: {
      theme: 'default-dark',
      hideBanner: false,
      hideTips: false,
      hideFooter: false,
      showUserIdentity: true,
      showSpinner: true,
      hideWindowTitle: false,
      showStatusInTitle: true,
      dynamicWindowTitle: true,
      loadingPhrases: 'tips',
      customWittyPhrases: [],
      errorVerbosity: 'full',
      escapePastedAtSymbols: false,
      footer: {
        hideCWD: false,
        hideSandboxStatus: false,
        hideModelInfo: false,
        hideContextPercentage: false,
        items: ['workspace', 'sandbox', 'model-name', 'context-used'],
        showLabels: false,
      },
      showMemoryUsage: false,
      showLineNumbers: true,
      useAlternateBuffer: false,
      autoThemeSwitching: false,
      terminalBackgroundPollingInterval: 5,
      customThemes: {},
      collapseDrawerDuringApproval: true,
    },
  },
  security: {
    type: 'object',
    description: 'Security settings',
    properties: {
      folderTrust: {
        type: 'object',
        description: 'Folder trust check configuration',
        properties: {
          enabled: { type: 'boolean', description: 'Enable folder trust warnings', default: true },
        },
        default: {
          enabled: true,
        },
      },
    },
    default: {
      folderTrust: {
        enabled: true,
      },
    },
  },
  tools: {
    type: 'object',
    description: 'Tools configuration',
    properties: {
      shell: {
        type: 'object',
        description: 'Shell execution configuration',
        properties: {
          pager: { type: 'string', description: 'Pager command', default: 'less' },
          showColor: { type: 'boolean', description: 'Enable colored shell output', default: true },
        },
        default: {
          pager: 'less',
          showColor: true,
        },
      },
      sandbox: {
        type: 'boolean',
        description: 'Run all execution commands in a sandbox environment',
        default: false,
      },
    },
    default: {
      shell: {
        pager: 'less',
        showColor: true,
      },
      sandbox: false,
    },
  },
  experimental: {
    type: 'object',
    description: 'Experimental features',
    properties: {
      worktrees: {
        type: 'boolean',
        description: 'Enable experimental git worktrees support',
        default: false,
      },
      useOSC52Paste: {
        type: 'boolean',
        description: 'Use OSC 52 paste integration',
        default: false,
      },
      useOSC52Copy: { type: 'boolean', description: 'Use OSC 52 copy integration', default: false },
      voice: {
        type: 'object',
        description: 'Voice mode configuration',
        properties: {
          activationMode: {
            type: 'string',
            description: 'Voice activation mode (push-to-talk, etc.)',
            default: 'push-to-talk',
          },
          backend: {
            type: 'string',
            description: 'Voice backend to use (gemini-live, whisper, etc.)',
            default: 'gemini-live',
          },
          ttsProvider: {
            type: 'string',
            description: 'TTS Provider (minimax, gemini, gtts)',
            default: 'minimax',
          },
          sttProvider: {
            type: 'string',
            description: 'STT Provider (groq, gemini-live)',
            default: 'groq',
          },
          geminiVoice: { type: 'string', description: 'Gemini Voice to use', default: 'Aoede' },
          stopGracePeriodMs: {
            type: 'number',
            description: 'Grace period before stopping transcription',
            default: 500,
          },
        },
        default: {
          activationMode: 'push-to-talk',
          backend: 'gemini-live',
          ttsProvider: 'minimax',
          sttProvider: 'groq',
          geminiVoice: 'Aoede',
          stopGracePeriodMs: 500,
        },
      },
    },
    default: {
      worktrees: false,
      useOSC52Paste: false,
      useOSC52Copy: false,
      voice: {
        activationMode: 'push-to-talk',
        backend: 'gemini-live',
        ttsProvider: 'minimax',
        sttProvider: 'groq',
        geminiVoice: 'Aoede',
        stopGracePeriodMs: 500,
      },
    },
  },
  context: {
    type: 'object',
    description: 'Context settings',
    properties: {
      fileName: { type: 'string', description: 'Context file name', default: 'hive.md' },
    },
    default: {
      fileName: 'hive.md',
    },
  },
};

export function getSettingsSchema(): Record<string, SettingDefinition> {
  return hiveSchema;
}

export type DnsResolutionOrder = 'ipv4' | 'ipv6' | 'both';

export interface TelemetrySettings {
  enabled?: boolean;
}

export interface SessionRetentionSettings {
  enabled?: boolean;
  maxAge?: string;
  maxCount?: number;
  minRetention?: string;
  mode?: 'default' | 'keep' | 'forget';
  days?: number;
}

export interface GeneralSettings {
  preferredEditor?: string;
  debugKeystrokeLogging?: boolean;
  devtools?: boolean;
  sessionRetention?: SessionRetentionSettings;
}

export interface UiSettings {
  theme?: string;
  inlineThinkingMode?: string;
  hideBanner?: boolean;
  hideTips?: boolean;
  hideFooter?: boolean;
  showUserIdentity?: boolean;
  showSpinner?: boolean;
  hideWindowTitle?: boolean;
  showStatusInTitle?: boolean;
  dynamicWindowTitle?: boolean;
  loadingPhrases?: string;
  customWittyPhrases?: string[];
  errorVerbosity?: string;
  escapePastedAtSymbols?: boolean;
  footer?: {
    hideCWD?: boolean;
    hideSandboxStatus?: boolean;
    hideModelInfo?: boolean;
    hideContextPercentage?: boolean;
    items?: string[];
    showLabels?: boolean;
  };
  showMemoryUsage?: boolean;
  showLineNumbers?: boolean;
  useAlternateBuffer?: boolean;
  autoThemeSwitching?: boolean;
  terminalBackgroundPollingInterval?: number;
  customThemes?: Record<string, unknown>;
  collapseDrawerDuringApproval?: boolean;
  compactToolOutput?: boolean;
}

export interface SecuritySettings {
  folderTrust?: {
    enabled?: boolean;
  };
}

export interface ShellSettings {
  pager?: string;
  showColor?: boolean;
}

export interface ToolsSettings {
  shell?: ShellSettings;
  sandbox?: boolean;
}

export interface ContextSettings {
  fileName?: string;
}

export interface HooksConfigSettings {
  notifications?: boolean;
}

export interface ModelSettings {
  compressionThreshold?: number;
}

export interface ExperimentalSettings {
  worktrees?: boolean;
  useOSC52Paste?: boolean;
  useOSC52Copy?: boolean;
  voice?: {
    activationMode?: string;
    backend?: string;
    stopGracePeriodMs?: number;
    ttsProvider?: string;
    sttProvider?: string;
    geminiVoice?: string;
  };
}

export interface IdeSettings {
  hasSeenNudge?: boolean;
}

export interface AdminSettings {
  secureModeEnabled?: boolean;
  mcp?: {
    enabled?: boolean;
    config?: unknown;
    requiredConfig?: unknown;
  };
  extensions?: {
    enabled?: boolean;
  };
  skills?: {
    enabled?: boolean;
  };
  [key: string]: unknown;
}

export interface MergedSettings {
  general: Required<GeneralSettings>;
  ui: Required<UiSettings> & {
    footer: Required<NonNullable<UiSettings['footer']>>;
  };
  security: Required<SecuritySettings> & {
    folderTrust: Required<NonNullable<SecuritySettings['folderTrust']>>;
  };
  tools: Required<ToolsSettings> & {
    shell: Required<ShellSettings>;
  };
  context: Required<ContextSettings>;
  hooksConfig: Required<HooksConfigSettings>;
  model: Required<ModelSettings>;
  experimental: Required<ExperimentalSettings>;
  ide: Required<IdeSettings>;
  admin: AdminSettings;
  mcp?: {
    excluded?: string[];
    allowed?: string[];
  };
  advanced?: {
    ignoreLocalEnv?: boolean;
    excludedEnvVars?: string[];
  };
  agents?: Record<string, unknown>;
}

export type Settings = Partial<MergedSettings>;

export type MergeStrategy = 'replace' | 'concat' | 'union' | 'shallow_merge';
export const MergeStrategy = {
  REPLACE: 'replace' as MergeStrategy,
  CONCAT: 'concat' as MergeStrategy,
  UNION: 'union' as MergeStrategy,
  SHALLOW_MERGE: 'shallow_merge' as MergeStrategy,
};

export type MemoryImportFormat = 'json' | 'text';

export type SettingsSchema = Record<string, SettingDefinition>;

export type SettingsType = 'string' | 'number' | 'boolean' | 'enum' | 'array' | 'object';

export type SettingsValue =
  string | number | boolean | string[] | Record<string, unknown> | undefined;

export const TOGGLE_TYPES = new Set<string>(['boolean', 'enum']);
