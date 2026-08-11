import { spawn, spawnSync } from 'node:child_process';
import type { ReadStream } from 'node:tty';
import { CoreEvent, coreEvents } from '../../utils/coreEvents.js';
import {
  ALL_EDITORS,
  EditorType,
  getEditorCommand,
  getEditorExtraArgs,
  getEditorWaitFlag,
  isGuiEditor,
  isTerminalEditor,
  isValidEditorType,
  resolveEditorTypeFromCommand,
} from '../contexts/UIStateContext.js';

/**
 * Command name substrings used to guess whether an unknown $VISUAL/$EDITOR
 * value is a GUI editor. This is a fallback for editors not in the registry;
 * registered editors are detected via resolveEditorTypeFromCommand instead.
 */
const HEURISTIC_GUI_COMMANDS = ['code', 'cursor', 'subl', 'zed', 'atom', 'agy'] as const;

/**
 * Opens a file in an external editor and waits for it to close.
 * Handles raw mode switching to ensure the editor can interact with the terminal.
 *
 * @param filePath Path to the file to open
 * @param stdin The stdin stream from Ink/Node
 * @param setRawMode Function to toggle raw mode
 * @param preferredEditorType The user's preferred editor from config
 * @param openInNewWindow Whether to open VS Code-family editors in a new window
 */
interface EditorResolution {
  command: string;
  args: string[];
  extraArgs: string[];
}

function resolvePreferredEditor(
  preferredEditorType: EditorType,
  openInNewWindow: boolean | undefined,
  args: string[],
  extraArgs: string[],
): string | undefined {
  if (!isValidEditorType(preferredEditorType)) {
    coreEvents.emitFeedback(
      'error',
      `Editor '${preferredEditorType}' is not a recognized editor identifier. ` +
        `Supported editors: ${ALL_EDITORS.join(', ')}. ` +
        'Use /editor to select one, or set the $VISUAL or $EDITOR environment variable.',
    );
    return undefined;
  }
  const command = getEditorCommand(preferredEditorType);
  if (isGuiEditor(preferredEditorType)) {
    args.unshift(getEditorWaitFlag(preferredEditorType));
  }
  extraArgs.push(...getEditorExtraArgs(preferredEditorType, { newWindow: openInNewWindow }));
  return command;
}

function resolveEnvEditor(
  envCommand: string,
  args: string[],
  extraArgs: string[],
  openInNewWindow: boolean | undefined,
): string {
  const [envExecutable = ''] = envCommand.split(' ');
  const resolvedType = resolveEditorTypeFromCommand(envExecutable);
  if (resolvedType) {
    if (isGuiEditor(resolvedType) && !envCommand.includes('--wait') && !envCommand.includes('-w')) {
      args.unshift(getEditorWaitFlag(resolvedType));
    }
    extraArgs.push(...getEditorExtraArgs(resolvedType, { newWindow: openInNewWindow }));
  } else {
    const lower = envCommand.toLowerCase();
    const isGui = HEURISTIC_GUI_COMMANDS.some((g) => lower.includes(g));
    if (isGui && !lower.includes('--wait') && !lower.includes('-w')) {
      args.unshift(lower.includes('subl') ? '-w' : '--wait');
    }
  }
  return envCommand;
}

function resolveEditorCommand(
  filePath: string,
  preferredEditorType: EditorType | undefined,
  openInNewWindow: boolean | undefined,
): EditorResolution | undefined {
  const args = [filePath];
  const extraArgs: string[] = [];
  let command: string | undefined;

  if (preferredEditorType) {
    command = resolvePreferredEditor(preferredEditorType, openInNewWindow, args, extraArgs);
    if (!command) return undefined;
  }

  if (!command) {
    const envCommand = process.env['VISUAL'] ?? process.env['EDITOR'];
    if (envCommand) {
      command = resolveEnvEditor(envCommand, args, extraArgs, openInNewWindow);
    }
  }

  if (!command) {
    command = process.platform === 'win32' ? 'notepad' : 'vi';
  }

  return { command, args, extraArgs };
}

function isTerminalEditorCommand(
  executable: string,
  preferredEditorType: EditorType | undefined,
): boolean {
  const terminalEditors = ['vi', 'vim', 'nvim', 'emacs', 'emacsclient', 'hx', 'nano', 'micro'];
  return preferredEditorType
    ? isTerminalEditor(preferredEditorType)
    : terminalEditors.some((te) => executable.toLowerCase().includes(te));
}

function runTerminalEditor(
  executable: string,
  spawnArgs: string[],
  extraArgs: string[],
  args: string[],
): void {
  const result = spawnSync(executable, [...spawnArgs, ...extraArgs, ...args], {
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) {
    const spawnErr = result.error as NodeJS.ErrnoException;
    coreEvents.emitFeedback(
      'error',
      spawnErr.code === 'ENOENT'
        ? `Editor command '${executable}' was not found in PATH. Install it or use /editor to choose another editor.`
        : (spawnErr.message ?? String(spawnErr)),
    );
    return;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    coreEvents.emitFeedback('error', `External editor exited with status ${result.status}`);
  }
}

function runGuiEditor(
  executable: string,
  spawnArgs: string[],
  extraArgs: string[],
  args: string[],
): Promise<void> {
  return new Promise<void>((resolve) => {
    const child = spawn(executable, [...spawnArgs, ...extraArgs, ...args], {
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', (err) => {
      const spawnErr = err as NodeJS.ErrnoException;
      resolve();
      coreEvents.emitFeedback(
        'error',
        spawnErr.code === 'ENOENT'
          ? `Editor command '${executable}' was not found in PATH. Install it or use /editor to choose another editor.`
          : (spawnErr.message ?? String(spawnErr)),
      );
    });

    child.on('close', (status) => {
      resolve();
      if (typeof status === 'number' && status !== 0) {
        coreEvents.emitFeedback('error', `External editor exited with status ${status}`);
      }
    });
  });
}

export async function openFileInEditor(
  filePath: string,
  stdin: ReadStream | null | undefined,
  setRawMode: ((mode: boolean) => void) | undefined,
  preferredEditorType?: EditorType,
  openInNewWindow?: boolean,
): Promise<void> {
  if (/[&|;<>$`\r\n]/.test(filePath)) {
    coreEvents.emitFeedback(
      'error',
      `Invalid file path for editor: contains shell metacharacters.`,
    );
    return;
  }

  const resolved = resolveEditorCommand(filePath, preferredEditorType, openInNewWindow);
  if (!resolved) return;

  const { command, args, extraArgs } = resolved;
  const [executable = '', ...initialArgs] = command.split(' ');

  if (/[&|;<>$`\r\n]/.test(executable)) {
    coreEvents.emitFeedback('error', `Invalid editor command: contains shell metacharacters.`);
    return;
  }

  const isTerminal = isTerminalEditorCommand(executable, preferredEditorType);

  if (
    isTerminal &&
    (executable.includes('vi') || executable.includes('vim') || executable.includes('nvim'))
  ) {
    args.unshift('-i', 'NONE');
  }

  const wasRaw = stdin?.isRaw ?? false;
  setRawMode?.(false);

  try {
    if (isTerminal) {
      runTerminalEditor(executable, initialArgs, extraArgs, args);
    } else {
      await runGuiEditor(executable, initialArgs, extraArgs, args);
    }
  } finally {
    if (wasRaw) {
      setRawMode?.(true);
    }
    coreEvents.emit(CoreEvent.ExternalEditorClosed);
  }
}
