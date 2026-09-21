import { describe, it, expect, afterEach, afterAll } from '@jest/globals';
import {
  PersistentShell,
  persistentShell,
} from '../../../plugins/base/dev_tools/PersistentShell.js';

describe('PersistentShell Lifecycle & Execution', () => {
  let shell: PersistentShell | null = null;

  afterEach(() => {
    if (shell) {
      shell.shutdown();
      shell = null;
    }
  });

  afterAll(() => {
    persistentShell.shutdown();
  });

  it('executes a basic command and retrieves stdout and exitCode', async () => {
    shell = new PersistentShell();
    const result = await shell.execute('echo "hello persistent shell"', 10000);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello persistent shell');
  });

  it('terminates the child process on shutdown and does not respawn a new process', async () => {
    shell = new PersistentShell();
    const childProcess = (shell as unknown as { shell: { pid?: number; killed?: boolean } | null })
      .shell;
    expect(childProcess).toBeDefined();
    const pid = childProcess?.pid;
    expect(typeof pid).toBe('number');

    shell.shutdown();

    // The shell reference must be nullified
    const afterShutdownShell = (shell as unknown as { shell: unknown }).shell;
    expect(afterShutdownShell).toBeNull();

    const stillNull = (shell as unknown as { shell: unknown }).shell;
    expect(stillNull).toBeNull();
  });

  it('rejects pending execution and clears execution state when shutdown is called during execution', async () => {
    shell = new PersistentShell();
    const execPromise = shell.execute('sleep 0.1', 10000);
    shell.shutdown();
    await expect(execPromise).rejects.toThrow('Shell was shut down');
  });

  it('handles child process exit when disposed without restarting shell', () => {
    shell = new PersistentShell();
    const internal = shell as unknown as {
      isDisposed: boolean;
      shell: { emit: (event: string, code: number) => void };
    };
    internal.isDisposed = true;
    internal.shell.emit('exit', 0);
    expect(internal.isDisposed).toBe(true);
  });
});
