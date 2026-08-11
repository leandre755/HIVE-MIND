// plugins/dev_tools/PersistentShell.ts
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { EventEmitter } from 'events';
import * as path from 'path';
import { safeExistsSync, safeMkdirSync } from '../../../utils/safeFs.js';

/**
 * Manages a persistent Shell process (bash) to maintain state (CWD, Env vars).
 * Inspired by the Claude Code pattern (PersistentShell.ts).
 */
class PersistentShell extends EventEmitter {
  private static readonly SENTINEL_PATTERN = /__HIVE_MIND_SHELL_DONE__(\d+)\|([^\n\r]+)/;
  private shell: ChildProcessWithoutNullStreams | null = null;
  private outputBuffer: string = '';
  private currentCwd: string = process.env.SANDBOX_DIR
    ? path.resolve(process.env.SANDBOX_DIR)
    : path.resolve(process.cwd(), 'Sandbox1');
  private sentinel: string = '__HIVE_MIND_SHELL_DONE__';
  private isExecuting: boolean = false;
  private executionPromise: {
    resolve: (val: { stdout: string; exitCode: number }) => void;
    reject: (err: Error) => void;
  } | null = null;

  constructor() {
    super();
    if (!safeExistsSync(this.currentCwd)) {
      safeMkdirSync(this.currentCwd, { recursive: true });
    }
    this._initShell();
  }

  private _initShell() {
    this.shell = spawn('/bin/bash', ['-i'], {
      env: { ...process.env, PS1: '' },
      cwd: this.currentCwd,
      shell: false,
    });

    this.shell.stdout.on('data', (data) => {
      const chunk = data.toString();
      this.outputBuffer += chunk;
      this._checkSentinel();
    });

    this.shell.stderr.on('data', (data) => {
      const chunk = data.toString();
      this.outputBuffer += chunk;
      this._checkSentinel();
    });

    this.shell.on('exit', (code) => {
      console.log(`[PersistentShell] Shell exited with code ${code}. Restarting...`);
      this._initShell();
    });
  }

  private _checkSentinel() {
    if (!this.isExecuting || !this.executionPromise) return;

    // Search for the sentinel pattern: __HIVE_MIND_SHELL_DONE__<exitCode>|<cwd>
    // We look for digits for exitCode to avoid matching raw command echo in interactive bash shells.
    const match = this.outputBuffer.match(PersistentShell.SENTINEL_PATTERN);

    if (match) {
      const matchIndex = match.index!;
      // The actual stdout is everything in the buffer BEFORE the sentinel match
      const output = this.outputBuffer.substring(0, matchIndex).trim();

      const exitCode = parseInt(match[1], 10);
      const newCwd = match[2].trim();
      this.currentCwd = newCwd;

      // Clean buffer for next execution
      this.outputBuffer = '';
      this.isExecuting = false;

      this.executionPromise.resolve({
        stdout: output,
        exitCode,
      });

      this.executionPromise = null;
    }
  }

  /**
   * Returns the current working directory of the shell
   */
  getCwd(): string {
    return this.currentCwd;
  }

  /**
   * Executes a command in the persistent shell
   */
  async execute(
    command: string,
    timeoutMs: number = 120000,
  ): Promise<{ stdout: string; exitCode: number }> {
    if (this.isExecuting) {
      throw new Error('The shell is already executing a command.');
    }

    this.isExecuting = true;
    this.outputBuffer = '';

    return new Promise<{ stdout: string; exitCode: number }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.isExecuting) {
          // Send Ctrl+C (0x03) to interrupt the foreground command in bash
          try {
            this.shell?.stdin.write('\x03');
          } catch {
            // stdin may be closed if shell crashed
          }
          // Reset buffer to prevent stale sentinel from corrupting next command
          this.outputBuffer = '';
          this.isExecuting = false;
          this.executionPromise = null;
          reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
        }
      }, timeoutMs);

      this.executionPromise = {
        resolve: (val) => {
          clearTimeout(timeout);
          resolve(val);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      };

      // Inject command + sentinel echo with exit code and pwd
      // We use ';' to ensure echo runs even if the command fails
      const fullCommand = `${command}\necho "${this.sentinel}$?|$(pwd)"\n`;
      this.shell?.stdin.write(fullCommand);
    });
  }

  /**
   * Terminates the shell
   */
  shutdown() {
    this.shell?.kill();
    this.shell = null;
  }
}

export const persistentShell = new PersistentShell();
export default persistentShell;
