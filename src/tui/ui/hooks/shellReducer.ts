import type { AnsiOutput, CompletionBehavior, BackgroundTask } from '../types/backgroundTask.js';
import { MAX_SHELL_OUTPUT_SIZE, SHELL_OUTPUT_TRUNCATION_BUFFER } from '../constants.js';
export type { BackgroundTask, AnsiOutput, CompletionBehavior };

export interface ShellState {
  activeShellPtyId: number | null;
  lastShellOutputTime: number;
  backgroundTasks: Map<number, BackgroundTask>;
  isBackgroundTaskVisible: boolean;
}

export type ShellAction =
  | { type: 'SET_ACTIVE_PTY'; pid: number | null }
  | { type: 'SET_OUTPUT_TIME'; time: number }
  | { type: 'SET_VISIBILITY'; visible: boolean }
  | { type: 'TOGGLE_VISIBILITY' }
  | {
      type: 'REGISTER_TASK';
      pid: number;
      command: string;
      initialOutput: string | AnsiOutput;
      completionBehavior?: CompletionBehavior;
    }
  | { type: 'UPDATE_TASK'; pid: number; update: Partial<BackgroundTask> }
  | { type: 'APPEND_TASK_OUTPUT'; pid: number; chunk: string | AnsiOutput }
  | { type: 'SYNC_BACKGROUND_TASKS' }
  | { type: 'DISMISS_TASK'; pid: number };

export const initialState: ShellState = {
  activeShellPtyId: null,
  lastShellOutputTime: 0,
  backgroundTasks: new Map(),
  isBackgroundTaskVisible: false,
};

function appendChunkToOutput(
  currentOutput: string | AnsiOutput,
  chunk: string | AnsiOutput,
): string | AnsiOutput {
  if (typeof chunk !== 'string') {
    return chunk || currentOutput;
  }
  const currentStr = typeof currentOutput === 'string' ? currentOutput : '';
  const combinedLength = currentStr.length + chunk.length;

  if (combinedLength <= MAX_SHELL_OUTPUT_SIZE + SHELL_OUTPUT_TRUNCATION_BUFFER) {
    return currentStr + chunk;
  }

  let newOutput =
    chunk.length >= MAX_SHELL_OUTPUT_SIZE
      ? chunk.slice(-MAX_SHELL_OUTPUT_SIZE)
      : currentStr.slice(-(MAX_SHELL_OUTPUT_SIZE - chunk.length)) + chunk;

  if (newOutput.length > 0) {
    const firstCharCode = newOutput.charCodeAt(0);
    if (firstCharCode >= 0xdc00 && firstCharCode <= 0xdfff) {
      newOutput = newOutput.slice(1);
    }
  }
  return newOutput;
}

export function shellReducer(state: ShellState, action: ShellAction): ShellState {
  switch (action.type) {
    case 'SET_ACTIVE_PTY':
      return { ...state, activeShellPtyId: action.pid };
    case 'SET_OUTPUT_TIME':
      return { ...state, lastShellOutputTime: action.time };
    case 'SET_VISIBILITY':
      return { ...state, isBackgroundTaskVisible: action.visible };
    case 'TOGGLE_VISIBILITY':
      return {
        ...state,
        isBackgroundTaskVisible: !state.isBackgroundTaskVisible,
      };
    case 'REGISTER_TASK': {
      if (state.backgroundTasks.has(action.pid)) return state;
      const nextTasks = new Map(state.backgroundTasks);
      nextTasks.set(action.pid, {
        pid: action.pid,
        command: action.command,
        output: action.initialOutput,
        isBinary: false,
        binaryBytesReceived: 0,
        status: 'running',
        completionBehavior: action.completionBehavior,
      });
      return { ...state, backgroundTasks: nextTasks };
    }
    case 'UPDATE_TASK': {
      const task = state.backgroundTasks.get(action.pid);
      if (!task) return state;
      const nextTasks = new Map(state.backgroundTasks);
      const updatedTask = { ...task, ...action.update };
      // Maintain insertion order, move to end if status changed to exited
      if (action.update.status === 'exited') {
        nextTasks.delete(action.pid);
      }
      nextTasks.set(action.pid, updatedTask);
      return { ...state, backgroundTasks: nextTasks };
    }
    case 'APPEND_TASK_OUTPUT': {
      const task = state.backgroundTasks.get(action.pid);
      if (!task) return state;
      task.output = appendChunkToOutput(task.output, action.chunk);

      const nextState = { ...state, lastShellOutputTime: Date.now() };

      if (state.isBackgroundTaskVisible) {
        return {
          ...nextState,
          backgroundTasks: new Map(state.backgroundTasks),
        };
      }
      return nextState;
    }
    case 'SYNC_BACKGROUND_TASKS': {
      return { ...state, backgroundTasks: new Map(state.backgroundTasks) };
    }
    case 'DISMISS_TASK': {
      const nextTasks = new Map(state.backgroundTasks);
      nextTasks.delete(action.pid);
      return {
        ...state,
        backgroundTasks: nextTasks,
        isBackgroundTaskVisible: nextTasks.size === 0 ? false : state.isBackgroundTaskVisible,
      };
    }
    default:
      return state;
  }
}
