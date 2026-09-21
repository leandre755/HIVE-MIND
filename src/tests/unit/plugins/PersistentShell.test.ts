import { describe, it, expect, afterEach } from '@jest/globals';
import { PersistentShell } from '../../../plugins/base/dev_tools/PersistentShell.js';

describe('PersistentShell Lifecycle & Execution', () => {
  let shell: PersistentShell | null = null;

  afterEach(() => {
    if (shell) {
      shell.shutdown();
      shell = null;
    }
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

    // Wait a brief tick to ensure the exit event did not spawn a replacement
    await new Promise((resolve) => setTimeout(resolve, 100));

    const stillNull = (shell as unknown as { shell: unknown }).shell;
    expect(stillNull).toBeNull();
  });
});
