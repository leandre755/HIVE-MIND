import { promises as fs } from 'node:fs';
import { join } from 'node:path';

const cleanupFunctions: Array<(() => void) | (() => Promise<void>)> = [];
const syncCleanupFunctions: Array<() => void> = [];
let activeConfig: { dispose(): Promise<void> } | null = null;
let isShuttingDown = false;

export function registerCleanup(fn: (() => void) | (() => Promise<void>)) {
  cleanupFunctions.push(fn);
}

export function removeCleanup(fn: (() => void) | (() => Promise<void>)) {
  const index = cleanupFunctions.indexOf(fn);
  if (index !== -1) {
    cleanupFunctions.splice(index, 1);
  }
}

export function registerSyncCleanup(fn: () => void) {
  syncCleanupFunctions.push(fn);
}

export function removeSyncCleanup(fn: () => void) {
  const index = syncCleanupFunctions.indexOf(fn);
  if (index !== -1) {
    syncCleanupFunctions.splice(index, 1);
  }
}

/**
 * Resets the internal cleanup state for testing purposes.
 * This allows tests to run in isolation without vi.resetModules().
 */
export function resetCleanupForTesting() {
  cleanupFunctions.length = 0;
  syncCleanupFunctions.length = 0;
  isShuttingDown = false;
}

export function runSyncCleanup() {
  for (const fn of syncCleanupFunctions) {
    try {
      fn();
    } catch {
      // Ignore errors during cleanup.
    }
  }
  syncCleanupFunctions.length = 0;
}

/**
 * Register the config instance for application shutdown.
 */
export function registerConfig(config: { dispose(): Promise<void> }) {
  activeConfig = config;
}

export async function runExitCleanup() {
  // drain stdin to prevent printing garbage on exit
  await drainStdin();

  runSyncCleanup();
  for (const fn of cleanupFunctions) {
    try {
      await fn();
    } catch {
      // Ignore errors during cleanup.
    }
  }
  cleanupFunctions.length = 0; // Clear the array

  if (activeConfig) {
    try {
      await activeConfig.dispose();
    } catch {
      // Ignore errors during disposal
    }
  }
}

async function drainStdin() {
  if (!process.stdin?.isTTY) return;
  // Resume stdin and attach a no-op listener to drain the buffer.
  // We use removeAllListeners to ensure we don't trigger other handlers.
  process.stdin
    .resume()
    .removeAllListeners('data')
    .on('data', () => {});
  // Give it a moment to flush the OS buffer.
  await new Promise((resolve) => setTimeout(resolve, 50));
}

/**
 * Gracefully shuts down the process, ensuring cleanup runs exactly once.
 * Guards against concurrent shutdown from signals (SIGHUP, SIGTERM, SIGINT)
 * and TTY loss detection racing each other.
 *
 * @see legacy issue 15874
 */
async function gracefulShutdown(_reason: string) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  await runExitCleanup();
  process.exit(0);
}

export function setupSignalHandlers() {
  process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

export function setupTtyCheck(): () => void {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let isCheckingTty = false;

  intervalId = setInterval(async () => {
    if (isCheckingTty || isShuttingDown) {
      return;
    }

    if (process.env['SANDBOX']) {
      return;
    }

    if (!process.stdin.isTTY && !process.stdout.isTTY) {
      isCheckingTty = true;

      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }

      await gracefulShutdown('TTY loss');
    }
  }, 5000);

  // Don't keep the process alive just for this interval
  intervalId.unref();

  return () => {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

export async function cleanupCheckpoints() {
  const checkpointsDir = join(process.cwd(), '.hivemind', 'temp', 'checkpoints');
  try {
    await fs.rm(checkpointsDir, { recursive: true, force: true });
  } catch {
    // Ignore errors
  }
}
