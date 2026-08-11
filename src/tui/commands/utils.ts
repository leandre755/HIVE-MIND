import { runExitCleanup } from '../utils/cleanup.js';

export async function exitCli(exitCode = 0) {
  await runExitCleanup();
  process.exit(exitCode);
}
