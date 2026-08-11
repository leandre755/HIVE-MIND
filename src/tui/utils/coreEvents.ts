import { EventEmitter } from 'events';

export enum CoreEvent {
  SESSION_START = 'session_start',
  SESSION_END = 'session_end',
  TOOL_CALL = 'tool_call',
  TOOL_RESULT = 'tool_result',
  ERROR = 'error',
  STREAM_CHUNK = 'stream_chunk',
  STREAM_END = 'stream_end',
  THOUGHT_START = 'thought_start',
  THOUGHT_END = 'thought_end',
  PROGRESS = 'progress',
  SettingsChanged = 'settings_changed',
  ModelChanged = 'model_changed',
  QuotaChanged = 'quota_changed',
  AdminSettingsChanged = 'admin_settings_changed',
  AgentsDiscovered = 'agents_discovered',
  ExternalEditorClosed = 'external_editor_closed',
  RequestEditorSelection = 'request_editor_selection',
  ConsentRequest = 'consent_request',
  UserFeedback = 'user_feedback',
  HookSystemMessage = 'hook_system_message',
  MemoryChanged = 'memory_changed',
  McpClientUpdate = 'mcp_client_update',
  ConsoleLog = 'console_log',
  HookStart = 'hook_start',
  HookEnd = 'hook_end',
  Output = 'output',
}

class TuiEventEmitter extends EventEmitter {
  emitFeedback(type: string, message: string, details?: unknown): void {
    this.emit('feedback', { type, message, details });
  }

  emitSettingsChanged(): void {
    this.emit(CoreEvent.SettingsChanged);
  }

  emitSlashCommandConflicts(conflicts: unknown[]): void {
    this.emit('slash_command_conflicts', conflicts);
  }

  drainBacklogs(): void {
    // No-op for now.
  }
}

export const coreEvents = new TuiEventEmitter();
