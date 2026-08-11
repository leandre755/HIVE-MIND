import type { IndividualToolCallDisplay } from './tools.js';

export interface Part {
  kind?: string;
  text?: string;
  media?: unknown;
  toolCall?: unknown;
  toolResult?: unknown;
  error?: unknown;
  functionCall?: unknown;
  functionResponse?: unknown;
}

export type { IndividualToolCallDisplay };

export type CompressionInfo = Record<string, unknown>;
export type ExportSessionProps = Record<string, unknown>;
export type SkillDefinition = Record<string, unknown>;
export type AgentDefinition = Record<string, unknown>;
export type ChatDetail = Record<string, unknown>;

export type HistoryType =
  | 'thinking'
  | 'hint'
  | 'user'
  | 'user_shell'
  | 'assistant'
  | 'assistant_content'
  | 'info'
  | 'warning'
  | 'error'
  | 'about'
  | 'help'
  | 'stats'
  | 'model_stats'
  | 'tool_stats'
  | 'model'
  | 'quit'
  | 'tool_group'
  | 'tool_display_group'
  | 'subagent'
  | 'compression'
  | 'export_session'
  | 'extensions_list'
  | 'tools_list'
  | 'skills_list'
  | 'agents_list'
  | 'mcp_status'
  | 'gemma_status'
  | 'chat_list';

export interface HistoryItem {
  id: number;
  type: HistoryType;
  text?: string;
  parts?: Part[];
  thought?: string;
  timestamp?: number;
  metadata?: Record<string, unknown>;
  tools?: IndividualToolCallDisplay[];
  secondaryText?: string;
  source?: string;
  icon?: string;
  color?: string;
  marginBottom?: number;
  cliVersion?: string;
  osVersion?: string;
  sandboxEnv?: string;
  modelVersion?: string;
  selectedAuthType?: string;
  gcpProject?: string;
  ideClient?: string;
  userEmail?: string;
  currentModel?: string;
  model?: string;
  duration?: number;
  borderTop?: boolean;
  borderBottom?: boolean;
  compression?: CompressionInfo;
  exportSession?: ExportSessionProps;
  showDescriptions?: boolean;
  skills?: SkillDefinition[];
  agents?: AgentDefinition[];
  chats?: ChatDetail[];
  content?: string;
  title?: string;
  error?: string;
  llmContent?: string;
  [key: string]: unknown;
}

export type HistoryItemWithoutId = Omit<HistoryItem, 'id'>;
