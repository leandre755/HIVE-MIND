export enum CoreToolCallStatus {
  Pending = 'pending',
  Running = 'running',
  Completed = 'completed',
  Failed = 'failed',
  Aborted = 'aborted',
  Executing = 'executing',
  Success = 'success',
  Error = 'error',
  Cancelled = 'cancelled',
  Canceled = 'canceled',
  Confirming = 'confirming',
  Scheduled = 'scheduled',
  AwaitingApproval = 'awaiting_approval',
}

export enum ApprovalMode {
  DEFAULT = 'default',
  ALWAYS = 'always',
  NEVER = 'never',
  SEMI = 'semi',
  YOLO = 'yolo',
  AUTO_EDIT = 'auto_edit',
  PLAN = 'plan',
}

export enum ToolConfirmationOutcome {
  Cancel = 'cancel',
  Proceed = 'proceed',
  ProceedOnce = 'proceed_once',
  ProceedAlways = 'proceed_always',
  ProceedAlwaysAndSave = 'proceed_always_and_save',
  ProceedAlwaysTool = 'proceed_always_tool',
  ProceedAlwaysServer = 'proceed_always_server',
  ModifyWithEditor = 'modify_with_editor',
}

export type AnsiOutput = string | { text: string; ansi?: boolean; [key: string]: unknown };

export interface SubagentActivityItem {
  id: string;
  role?: string;
  status: string;
  message?: string;
  timestamp?: number;
  [key: string]: unknown;
}

export interface ToolCallConfirmationDetails {
  type: string;
  title: string;
  command: string;
  rootCommand: string;
  rootCommands: string[];
  commands: string[];
  onConfirm: (outcome: ToolConfirmationOutcome) => Promise<void> | void;
  questions?: Array<{ header?: string }>;
}

export interface ToolCallDisplay {
  format?: string;
  result?: unknown;
  title?: string;
  language?: string;
  filePath?: string;
  fileDiff?: string;
  [key: string]: unknown;
}

export interface IndividualToolCallDisplay {
  callId: string;
  name: string;
  originalRequestName?: string;
  description: string;
  display?: ToolCallDisplay;
  status: CoreToolCallStatus;
  isClientInitiated?: boolean;
  renderOutputAsMarkdown?: boolean;
  kind?: unknown;
  resultDisplay?: string | AnsiOutput;
  progressMessage?: string;
  progress?: number;
  progressTotal?: number;
  ptyId?: number;
  args?: Record<string, unknown>;
  outputFile?: string;
  confirmationDetails?: ToolCallConfirmationDetails;
  approvalMode?: ApprovalMode;
  parentCallId?: string;
  subagentHistory?: SubagentActivityItem[];
  format?: string;
  [key: string]: unknown;
}
