import os from 'node:os';
import { join as pathJoin } from 'node:path';
import { getErrorMessage } from './errors.js';
import { safePath, safeUnlink, safeReadFile } from '../../utils/safeFs.js';

const warningsFilePath = pathJoin(os.tmpdir(), 'hive-mind-warnings.txt');

export async function getStartupWarnings(): Promise<string[]> {
  try {
    const safeWarningsFilePath = safePath(warningsFilePath);
    const warningsContent = await safeReadFile(safeWarningsFilePath);
    const warnings = warningsContent.split('\n').filter((line) => line.trim() !== '');
    try {
      await safeUnlink(safeWarningsFilePath);
    } catch {
      warnings.push('Warning: Could not delete temporary warnings file.');
    }
    return warnings;
  } catch (err: unknown) {
    // If reading throws, it means the file doesn't exist or is not accessible.
    // This is not an error in the context of fetching warnings, so return empty.
    // Only return an error message if it's not a "file not found" type error.
    // However, the original logic returned an error message for any fs.existsSync failure.
    // To maintain closer parity while making it async, we'll check the error code.
    // ENOENT is "Error NO ENTry" (file not found).
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
      return []; // File not found, no warnings to return.
    }
    // For other errors (permissions, etc.), return the error message.
    return [`Error checking/reading warnings file: ${getErrorMessage(err)}`];
  }
}
