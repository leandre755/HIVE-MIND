import type React from 'react';

declare global {
  interface Config {
    getSessionId(): string;
    [key: string]: unknown;
  }
  interface Storage {
    [key: string]: unknown;
  }
  interface StubLogger {
    [key: string]: unknown;
  }
  interface ExitCodes {
    [key: string]: unknown;
  }
  interface PromptPipelineContent {
    [key: string]: unknown;
  }
  interface IPromptProcessor {
    [key: string]: unknown;
  }
  interface TextMatch {
    before: string;
    match: string;
    after: string;
    role: 'user' | 'assistant';
  }
  interface SessionInfo {
    id: string;
    file: string;
    fileName: string;
    startTime: string;
    messageCount: number;
    lastUpdated: string;
    displayName: string;
    firstUserMessage: string;
    isCurrentSession: boolean;
    index: number;
    sessionPath?: string;
    createdAt?: string | Date;
    firstMessage?: string;
    lastMessage?: string;
    matchSnippets?: TextMatch[];
    matchCount?: number;
    title?: string;
    updatedAt?: string | Date;
    fileSize?: number;
    previewText?: string;
  }
  interface EditorType {
    id: string;
    command?: string;
    name?: string;
    args?: string[];
  }
  type SlashCommandActionReturn =
    | {
        type: 'tool';
        toolName: string;
        toolArgs: Record<string, unknown>;
        postSubmitPrompt?: string;
      }
    | { type: 'message'; content: string; messageType: 'error' | 'info' | 'warning' }
    | { type: 'dialog'; dialog: string; props?: Record<string, unknown> }
    | { type: 'quit'; deleteSession?: boolean; messages?: HistoryItem[] }
    | { type: 'logout' }
    | { type: 'submit_prompt'; content: unknown }
    | {
        type: 'confirm_shell_commands';
        commandsToConfirm: string[];
        originalInvocation: { raw: string };
      }
    | { type: 'confirm_action'; prompt: React.ReactNode; originalInvocation: { raw: string } }
    | { type: 'custom_dialog'; component: React.ReactNode }
    | void
    | undefined;

  const SHELL_INJECTION_TRIGGER: unknown;
  const AT_FILE_INJECTION_TRIGGER: unknown;
  const SHORTHAND_ARGS_PLACEHOLDER: unknown;
  function getSessionFiles(
    chatsDir?: unknown,
    sessionId?: unknown,
    options?: unknown,
  ): Promise<SessionInfo[]>;
  function formatRelativeTime(date?: string | number | Date | null, style?: string): string;
  function loadApiKey(...args: unknown[]): unknown;
  function getErrorMessage(...args: unknown[]): unknown;
  function isAccountSuspendedError(...args: unknown[]): unknown;
  const ProjectIdRequiredError: unknown;
  const keyMatchers: Record<string, unknown>;
  const showRow2Minimal: unknown;
  const showRow1: unknown;
  const showRow2: unknown;
  const mode: unknown;
  interface ApprovalMode {
    [key: string]: unknown;
  }
  interface AuthType {
    [key: string]: unknown;
  }
  interface LlmRole {
    [key: string]: unknown;
  }
  interface QuestionType {
    [key: string]: unknown;
  }
  interface SubagentState {
    [key: string]: unknown;
  }
  interface WarningPriority {
    [key: string]: unknown;
  }
  interface MCPServerStatus {
    [key: string]: unknown;
  }
  interface SessionEndReason {
    [key: string]: unknown;
  }
  interface SessionStartSource {
    [key: string]: unknown;
  }
  interface ToolConfirmationOutcome {
    [key: string]: unknown;
  }
  interface ToolErrorType {
    [key: string]: unknown;
  }
  interface TrustLevel {
    [key: string]: unknown;
  }
  interface AdminControlsSettings {
    [key: string]: unknown;
  }
  interface AgentDefinition {
    [key: string]: unknown;
  }
  interface AgentLoopContext {
    [key: string]: unknown;
  }
  interface AgentOverride {
    [key: string]: unknown;
  }
  interface AgentsDiscoveredPayload {
    [key: string]: unknown;
  }
  interface AnsiLine {
    tokens?: unknown;
    text?: string;
    [key: string]: unknown;
  }
  interface AnsiOutput {
    lines?: unknown[];
    [key: string]: unknown;
  }
  interface AnsiToken {
    [key: string]: unknown;
  }
  interface ApprovalModeChangedPayload {
    [key: string]: unknown;
  }
  interface BugCommandSettings {
    [key: string]: unknown;
  }
  interface ChatRecordingService {
    [key: string]: unknown;
  }
  interface CompressionStatus {
    [key: string]: unknown;
  }
  interface ConfigParameters {
    [key: string]: unknown;
  }
  interface ConsentRequestPayload {
    [key: string]: unknown;
  }
  interface ConversationRecord {
    [key: string]: unknown;
  }
  interface CoreEvents {
    emit(event: unknown, data?: unknown): boolean;
    on(event: unknown, listener: (...args: unknown[]) => void): void;
    off(event: unknown, listener: (...args: unknown[]) => void): void;
    [key: string]: unknown;
  }
  interface ExtensionEvents {
    [key: string]: unknown;
  }
  interface ExtensionInstallMetadata {
    [key: string]: unknown;
  }
  interface ExtensionSetting {
    [key: string]: unknown;
  }
  interface FallbackModelHandler {
    [key: string]: unknown;
  }
  interface File {
    [key: string]: unknown;
  }
  interface FileDiff {
    filePath: string;
    fileName: string;
    newContent: string;
    originalContent: string;
    isNewFile?: boolean;
    fileDiff: string;
    diffStat?: { addedLines: number; removedLines: number };
  }
  interface FileSearch {
    [key: string]: unknown;
  }
  interface FileSystemService {
    [key: string]: unknown;
  }
  interface FilterFilesOptions {
    [key: string]: unknown;
  }
  interface GeminiCLIExtension {
    [key: string]: unknown;
  }
  interface GeminiChat {
    [key: string]: unknown;
  }
  interface GeminiClient {
    [key: string]: unknown;
  }
  interface HeadlessModeOptions {
    [key: string]: unknown;
  }
  interface HookDefinition {
    [key: string]: unknown;
  }
  interface HookEndPayload {
    [key: string]: unknown;
  }
  interface HookEventName {
    [key: string]: unknown;
  }
  interface HookStartPayload {
    [key: string]: unknown;
  }
  interface IDEConnectionState {
    [key: string]: unknown;
  }
  interface IExtensionIntegrity {
    [key: string]: unknown;
  }
  interface IdeContext {
    [key: string]: unknown;
  }
  interface IdeInfo {
    [key: string]: unknown;
  }
  interface InboxMemoryPatch {
    [key: string]: unknown;
  }
  interface InboxPatch {
    [key: string]: unknown;
  }
  interface InboxSkill {
    [key: string]: unknown;
  }
  interface InboxSkillDestination {
    [key: string]: unknown;
  }
  interface InjectionSource {
    [key: string]: unknown;
  }
  interface ListDirectoryResult {
    [key: string]: unknown;
  }
  interface LoadedTrustedFolders {
    [key: string]: unknown;
  }
  interface MCPServerConfig {
    [key: string]: unknown;
  }
  interface MemoryChangedPayload {
    [key: string]: unknown;
  }
  interface MessageActionReturn {
    [key: string]: unknown;
  }
  interface MessageBus {
    [key: string]: unknown;
  }
  interface MessageRecord {
    [key: string]: unknown;
  }
  interface OutputFormat {
    [key: string]: unknown;
  }
  interface OutputPayload {
    [key: string]: unknown;
  }
  interface OverageOption {
    [key: string]: unknown;
  }
  interface Part {
    [key: string]: unknown;
  }
  interface PolicyEngine {
    [key: string]: unknown;
  }
  interface PolicyEngineConfig {
    [key: string]: unknown;
  }
  interface PolicyRule {
    [key: string]: unknown;
  }
  interface PolicySettings {
    [key: string]: unknown;
  }
  interface Question {
    [key: string]: unknown;
  }
  interface ReadManyFilesResult {
    [key: string]: unknown;
  }
  interface RequiredMcpServerConfig {
    [key: string]: unknown;
  }
  interface ResolvedAtCommandPath {
    [key: string]: unknown;
  }
  interface ResolvedExtensionSetting {
    [key: string]: unknown;
  }
  interface ResumedSessionData {
    [key: string]: unknown;
  }
  interface RetrieveUserQuotaResponse {
    [key: string]: unknown;
  }
  interface RetryAttemptPayload {
    [key: string]: unknown;
  }
  interface SafetyCheckerRule {
    [key: string]: unknown;
  }
  interface SandboxConfig {
    [key: string]: unknown;
  }
  interface SerializableConfirmationDetails {
    [key: string]: unknown;
  }
  interface SlashCommandConflict {
    [key: string]: unknown;
  }
  interface SlashCommandConflictsPayload {
    [key: string]: unknown;
  }
  interface SubagentActivityItem {
    id?: string;
    status?: string;
    displayName?: React.ReactNode;
    content?: React.ReactNode;
    description?: string;
    type?: string;
    args?: string;
    timestamp?: number;
    result?: unknown;
  }
  type SubagentProgress =
    | string
    | AnsiOutput
    | AnsiLine[]
    | {
        state?: unknown;
        agentName?: string;
        recentActivity?: SubagentActivityItem[];
        result?: React.ReactNode;
        terminateReason?: React.ReactNode;
        progressPercent?: number;
        status?: string;
        currentStep?: string;
        detail?: string;
      };

  interface TelemetrySettings {
    [key: string]: unknown;
  }
  interface ThoughtSummary {
    [key: string]: unknown;
  }
  interface TodoList {
    [key: string]: unknown;
  }
  interface ToolCall {
    [key: string]: unknown;
  }
  interface ToolCallConfirmationDetails {
    [key: string]: unknown;
  }
  interface ToolCallData {
    [key: string]: unknown;
  }
  interface ToolConfirmationRequest {
    [key: string]: unknown;
  }
  interface ToolDisplay {
    [key: string]: unknown;
  }
  interface ToolResult {
    [key: string]: unknown;
  }
  interface ToolResultDisplay {
    [key: string]: unknown;
  }
  interface TranscriptionProvider {
    [key: string]: unknown;
  }
  interface ValidationHandler {
    [key: string]: unknown;
  }
  interface VertexAiRoutingConfig {
    [key: string]: unknown;
  }
  interface WhisperModelProgress {
    [key: string]: unknown;
  }
  interface WorktreeInfo {
    [key: string]: unknown;
  }
  interface WorktreeSettings {
    [key: string]: unknown;
  }

  // Global variables/functions in runtime
  function resetBrowserSession(...args: unknown[]): unknown;
  function isTelemetrySdkInitialized(): boolean;
  function shutdownTelemetry(): void;
  const ExitCodes: Record<string, unknown>;
  const coreEvents: CoreEvents;
  const debugLogger: Record<string, unknown>;
  const Storage: Record<string, unknown>;
  const Config: Record<string, unknown>;
  const AuthType: Record<string, unknown>;
  const ApprovalMode: Record<string, unknown>;
  const CoreEvent: {
    EditorSelected: string;
    [key: string]: unknown;
  };
  const LlmRole: Record<string, unknown>;
  const MCPServerStatus: Record<string, unknown>;
  function getFileDiffFromResultDisplay(display: unknown): FileDiff | undefined;
  function computeModelAddedAndRemovedLines(model: unknown): {
    addedLines: number;
    removedLines: number;
  };
  function checkPathTrust(...args: unknown[]): unknown;
  function loadTrustedFolders(...args: unknown[]): unknown;
  function saveTrustedFolders(...args: unknown[]): unknown;

  interface HistoryItem {
    id: number;
    type: unknown;
    text?: string;
    timestamp?: number;
    [key: string]: unknown;
  }
  interface HistoryItemWithoutId {
    text?: string;
    timestamp?: number;
    [key: string]: unknown;
  }
  interface Message {
    id?: string;
    role?: string;
    content?: unknown;
    timestamp?: number;
    [key: string]: unknown;
  }
  interface Suggestion {
    id?: string;
    text?: string;
    description?: string;
    [key: string]: unknown;
  }
  interface UIActions {
    [key: string]: unknown;
  }
  interface UIState {
    [key: string]: unknown;
  }
  interface BackgroundTask {
    id?: string;
    name?: string;
    status?: string;
    [key: string]: unknown;
  }
  interface ConfirmationRequest {
    id?: string;
    message?: string;
    [key: string]: unknown;
  }
  interface PermissionConfirmationRequest {
    id?: string;
    permission?: string;
    [key: string]: unknown;
  }
  interface LoopDetectionConfirmationRequest {
    id?: string;
    message?: string;
    [key: string]: unknown;
  }
  interface Keyboard {
    [key: string]: unknown;
  }
  interface Key {
    name?: string;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
    [key: string]: unknown;
  }
  interface Theme {
    name?: string;
    colors?: Record<string, string>;
    [key: string]: unknown;
  }

  enum MessageType {
    INFO = 'info',
    ERROR = 'error',
    WARNING = 'warning',
    USER = 'user',
    ABOUT = 'about',
    HELP = 'help',
    STATS = 'stats',
    MODEL_STATS = 'model_stats',
    TOOL_STATS = 'tool_stats',
    QUIT = 'quit',
    COMPRESSION = 'compression',
    EXPORT_SESSION = 'export_session',
    MCP_STATUS = 'mcp_status',
    GEMMA_STATUS = 'gemma-status',
    CHAT_LIST = 'chat_list',
    THINKING = 'thinking',
    SUBAGENT = 'subagent',
    TOOLS_LIST = 'tools_list',
    SKILLS_LIST = 'skills_list',
    AGENTS_LIST = 'agents_list',
  }

  enum AuthState {
    Unauthenticated = 'unauthenticated',
    Updating = 'updating',
    AwaitingApiKeyInput = 'awaiting_api_key_input',
    Authenticated = 'authenticated',
    AwaitingLoginRestart = 'awaiting_login_restart',
  }

  enum StreamingState {
    Idle = 'idle',
    Responding = 'responding',
    WaitingForConfirmation = 'waiting_for_confirmation',
  }

  enum ToolCallStatus {
    Pending = 'Pending',
    Canceled = 'Canceled',
    Confirming = 'Confirming',
    Executing = 'Executing',
    Success = 'Success',
    Error = 'Error',
  }
}

export {};
