import * as fs from 'node:fs/promises';
import * as fsTypes from 'node:fs';
import * as path from 'node:path';
import { debugLogger } from './errors.js';
import { HiveConfig } from '../config/hiveConfig.js';
import {
  sanitizeFilenamePart,
  SESSION_FILE_PREFIX,
  Storage,
  TOOL_OUTPUTS_DIR,
  deleteSessionArtifactsAsync,
  deleteSubagentSessionDirAndArtifactsAsync,
} from '../ui/contexts/UIStateContext.js';
import type { Settings, SessionRetentionSettings } from '../config/settings.js';
import { getAllSessionFiles, type SessionFileEntry } from './sessionUtils.js';
import { safeUnlink, safeStat, safeReaddir, safeReadFile } from '../../utils/safeFs.js';

// Constants
export const DEFAULT_MIN_RETENTION = '1d' as string;
const MIN_MAX_COUNT = 1;
const MULTIPLIERS = {
  h: 60 * 60 * 1000, // hours to ms
  d: 24 * 60 * 60 * 1000, // days to ms
  w: 7 * 24 * 60 * 60 * 1000, // weeks to ms
  m: 30 * 24 * 60 * 60 * 1000, // months (30 days) to ms
};

/**
 * Matches a trailing hyphen followed by exactly 8 alphanumeric characters before the .json or .jsonl extension.
 * Example: session-20250110-abcdef12.json -> captures "abcdef12"
 */
const SHORT_ID_REGEX = /-([a-zA-Z0-9]{8})\.jsonl?$/;

function hasProperty<T extends string>(obj: unknown, prop: T): obj is { [key in T]: unknown } {
  return obj !== null && typeof obj === 'object' && prop in obj;
}

function isStringProperty<T extends string>(obj: unknown, prop: T): obj is { [key in T]: string } {
  return hasProperty(obj, prop) && typeof Reflect.get(obj as object, prop) === 'string';
}

function isSessionIdRecord(record: unknown): record is { sessionId: string } {
  return isStringProperty(record, 'sessionId');
}

/**
 * Result of session cleanup operation
 */
export interface CleanupResult {
  disabled: boolean;
  scanned: number;
  deleted: number;
  skipped: number;
  failed: number;
}

/**
 * Helpers for session cleanup.
 */

/**
 * Derives an 8-character shortId from a session filename.
 */
function deriveShortIdFromFileName(fileName: string): string | null {
  if (
    fileName.startsWith(SESSION_FILE_PREFIX) &&
    (fileName.endsWith('.json') || fileName.endsWith('.jsonl'))
  ) {
    const match = fileName.match(SHORT_ID_REGEX);
    return match ? match[1] : null;
  }
  return null;
}

/**
 * Cleans up associated artifacts (logs, tool-outputs, directory) for a session.
 */
async function cleanupSessionAndSubagentsAsync(
  sessionId: string,
  config: HiveConfig,
): Promise<void> {
  const tempDir = config.storage.getProjectTempDir();
  const chatsDir = path.join(tempDir, 'chats');

  await deleteSessionArtifactsAsync(sessionId, tempDir);
  await deleteSubagentSessionDirAndArtifactsAsync(sessionId, chatsDir, tempDir);
}

/**
 * Reads a session file and extracts the sessionId from the first line.
 * Returns undefined if reading or parsing fails.
 */
async function readSessionIdFromFile(filePath: string): Promise<string | undefined> {
  try {
    const fileContent = await safeReadFile(filePath);
    const newlineIndex = fileContent.indexOf('\n');
    const firstLine = newlineIndex !== -1 ? fileContent.substring(0, newlineIndex) : fileContent;
    try {
      const record: unknown = JSON.parse(firstLine);
      if (isSessionIdRecord(record)) {
        return record.sessionId;
      }
    } catch {
      // Ignore first line parse error
    }

    const content: unknown = JSON.parse(fileContent);
    if (isSessionIdRecord(content)) {
      return content.sessionId;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

async function deleteSingleSessionFile(
  file: string,
  chatsDir: string,
  config: HiveConfig,
): Promise<'deleted' | 'skipped' | 'failed'> {
  const filePath = path.join(chatsDir, file);
  try {
    const fullSessionId = await readSessionIdFromFile(filePath);

    if (fullSessionId && fullSessionId === config.getSessionId()) {
      return 'skipped';
    }

    await safeUnlink(filePath);
    if (fullSessionId) {
      await cleanupSessionAndSubagentsAsync(fullSessionId, config);
    }
    return 'deleted';
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      // File already deleted, do nothing.
      return 'skipped';
    }
    debugLogger.warn(
      `Failed to delete matching file ${file}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
    return 'failed';
  }
}

/**
 * Processes all matching files for a given short ID, returning counts of deleted/skipped/failed.
 */
async function processShortIdBranch(
  shortId: string,
  allFiles: SessionFileEntry[],
  chatsDir: string,
  config: HiveConfig,
): Promise<{ deleted: number; skipped: number; failed: number }> {
  let deleted = 0;
  let skipped = 0;
  let failed = 0;

  const matchingFiles = allFiles
    .map((f) => f.fileName)
    .filter(
      (f) =>
        f.startsWith(SESSION_FILE_PREFIX) &&
        (f.endsWith(`-${shortId}.json`) || f.endsWith(`-${shortId}.jsonl`)),
    );

  for (const file of matchingFiles) {
    const outcome = await deleteSingleSessionFile(file, chatsDir, config);
    if (outcome === 'deleted') {
      deleted++;
    } else if (outcome === 'skipped') {
      skipped++;
    } else {
      failed++;
    }
  }

  return { deleted, skipped, failed };
}

async function deleteSessionEntry(
  sessionToDelete: SessionFileEntry,
  chatsDir: string,
  config: HiveConfig,
  allFiles: SessionFileEntry[],
  processedShortIds: Set<string>,
): Promise<{ deleted: number; skipped: number; failed: number }> {
  const shortId = deriveShortIdFromFileName(sessionToDelete.fileName);

  if (shortId) {
    if (processedShortIds.has(shortId)) {
      return { deleted: 0, skipped: 1, failed: 0 };
    }
    processedShortIds.add(shortId);

    return processShortIdBranch(shortId, allFiles, chatsDir, config);
  }

  // Fallback to old logic
  const sessionPath = path.join(chatsDir, sessionToDelete.fileName);
  await safeUnlink(sessionPath);

  const sessionId = sessionToDelete.sessionInfo?.id;
  if (sessionId) {
    await cleanupSessionAndSubagentsAsync(sessionId, config);
  }

  if (config.getDebugMode()) {
    debugLogger.debug(`Deleted fallback session: ${sessionToDelete.fileName}`);
  }
  return { deleted: 1, skipped: 0, failed: 0 };
}

function logDeleteFailure(sessionToDelete: SessionFileEntry, error: unknown): boolean {
  // Ignore ENOENT (file already deleted)
  if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
    return true;
  }
  const sessionId =
    sessionToDelete.sessionInfo === null
      ? sessionToDelete.fileName
      : sessionToDelete.sessionInfo.id;
  debugLogger.warn(
    `Failed to delete session ${sessionId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
  );
  return false;
}

async function deleteSessionEntries(
  sessionsToDelete: SessionFileEntry[],
  chatsDir: string,
  config: HiveConfig,
  allFiles: SessionFileEntry[],
): Promise<{ deleted: number; skipped: number; failed: number }> {
  const counts = { deleted: 0, skipped: 0, failed: 0 };
  const processedShortIds = new Set<string>();

  // Delete all sessions that need to be deleted
  for (const sessionToDelete of sessionsToDelete) {
    try {
      const entryCounts = await deleteSessionEntry(
        sessionToDelete,
        chatsDir,
        config,
        allFiles,
        processedShortIds,
      );
      counts.deleted += entryCounts.deleted;
      counts.skipped += entryCounts.skipped;
      counts.failed += entryCounts.failed;
    } catch (error) {
      if (!logDeleteFailure(sessionToDelete, error)) {
        counts.failed++;
      }
    }
  }

  return counts;
}

/**
 * Main entry point for session cleanup during CLI startup
 */
export async function cleanupExpiredSessions(
  config: HiveConfig,
  settings: Settings,
): Promise<CleanupResult> {
  const result: CleanupResult = {
    disabled: false,
    scanned: 0,
    deleted: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    // Early exit if cleanup is disabled
    if (!settings.general?.sessionRetention?.enabled) {
      return { ...result, disabled: true };
    }

    const retentionConfig = settings.general.sessionRetention;
    const chatsDir = path.join(config.storage.getProjectTempDir(), 'chats');

    // Validate retention configuration
    const validationErrorMessage = validateRetentionConfig(config, retentionConfig);
    if (validationErrorMessage) {
      // Log validation errors to console for visibility
      debugLogger.warn(`Session cleanup disabled: ${validationErrorMessage}`);
      return { ...result, disabled: true };
    }

    const allFiles = await getAllSessionFiles(chatsDir, config.getSessionId());
    result.scanned = allFiles.length;

    if (allFiles.length === 0) {
      return result;
    }

    // Determine which sessions to delete (corrupted and expired)
    const sessionsToDelete = await identifySessionsToDelete(allFiles, retentionConfig);

    const counts = await deleteSessionEntries(sessionsToDelete, chatsDir, config, allFiles);
    result.deleted += counts.deleted;
    result.skipped += counts.skipped;
    result.failed += counts.failed;

    result.skipped = result.scanned - result.deleted - result.failed;

    if (config.getDebugMode() && result.deleted > 0) {
      debugLogger.debug(
        `Session cleanup: deleted ${result.deleted}, skipped ${result.skipped}, failed ${result.failed}`,
      );
    }
  } catch (error) {
    // Global error handler - don't let cleanup failures break startup
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    debugLogger.warn(`Session cleanup failed: ${errorMessage}`);
    result.failed++;
  }

  return result;
}

function shouldDeleteSession(
  entry: SessionFileEntry,
  index: number,
  cutoffDate: Date | null,
  maxDeletableSessions: number | undefined,
): boolean {
  const session = entry.sessionInfo!;

  if (cutoffDate && new Date(session.lastUpdated) < cutoffDate) {
    return true;
  }

  return maxDeletableSessions !== undefined && index >= maxDeletableSessions;
}

/**
 * Identifies sessions that should be deleted (corrupted or expired based on retention policy)
 */
export async function identifySessionsToDelete(
  allFiles: SessionFileEntry[],
  retentionConfig: SessionRetentionSettings,
): Promise<SessionFileEntry[]> {
  const sessionsToDelete: SessionFileEntry[] = [];

  // All corrupted files should be deleted
  sessionsToDelete.push(...allFiles.filter((entry) => entry.sessionInfo === null));

  // Now handle valid sessions based on retention policy
  const validSessions = allFiles.filter((entry) => entry.sessionInfo !== null);
  if (validSessions.length === 0) {
    return sessionsToDelete;
  }

  const now = new Date();

  // Calculate cutoff date for age-based retention
  let cutoffDate: Date | null = null;
  if (retentionConfig.maxAge) {
    try {
      const maxAgeMs = parseRetentionPeriod(retentionConfig.maxAge);
      cutoffDate = new Date(now.getTime() - maxAgeMs);
    } catch {
      // This should not happen as validation should have caught it,
      // but handle gracefully just in case
      cutoffDate = null;
    }
  }

  // Sort valid sessions by lastUpdated (newest first) for count-based retention
  const sortedValidSessions = [...validSessions].sort(
    (a, b) =>
      new Date(b.sessionInfo!.lastUpdated).getTime() -
      new Date(a.sessionInfo!.lastUpdated).getTime(),
  );

  // Separate deletable sessions from the active session
  const deletableSessions = sortedValidSessions.filter(
    (entry) => !entry.sessionInfo!.isCurrentSession,
  );

  // Calculate how many deletable sessions to keep (accounting for the active session)
  const hasActiveSession = sortedValidSessions.some((e) => e.sessionInfo!.isCurrentSession);
  const maxDeletableSessions =
    retentionConfig.maxCount && hasActiveSession
      ? Math.max(0, retentionConfig.maxCount - 1)
      : retentionConfig.maxCount;

  deletableSessions.forEach((entry, i) => {
    if (shouldDeleteSession(entry, i, cutoffDate, maxDeletableSessions)) {
      sessionsToDelete.push(entry);
    }
  });

  return sessionsToDelete;
}

/**
 * Parses retention period strings like "30d", "7d", "24h" into milliseconds
 * @throws {Error} If the format is invalid
 */
function parseRetentionPeriod(period: string): number {
  const match = period.match(/^(\d+)([dhwm])$/);
  if (!match) {
    throw new Error(
      `Invalid retention period format: ${period}. Expected format: <number><unit> where unit is h, d, w, or m`,
    );
  }

  const value = parseInt(match[1], 10);
  const unit = match[2] as 'h' | 'd' | 'w' | 'm';
  const multiplierMap = new Map<string, number>(Object.entries(MULTIPLIERS));

  // Reject zero values as they're semantically invalid
  if (value === 0) {
    throw new Error(`Invalid retention period: ${period}. Value must be greater than 0`);
  }

  return value * (multiplierMap.get(unit) ?? 0);
}

function validateMaxAge(
  config: HiveConfig,
  retentionConfig: SessionRetentionSettings,
): string | null {
  if (!retentionConfig.maxAge) {
    return null;
  }
  let maxAgeMs: number;
  try {
    maxAgeMs = parseRetentionPeriod(retentionConfig.maxAge);
  } catch (error) {
    return (error as Error | string).toString();
  }

  // Enforce minimum retention period
  const minRetention = retentionConfig.minRetention || DEFAULT_MIN_RETENTION;
  let minRetentionMs: number;
  try {
    minRetentionMs = parseRetentionPeriod(minRetention);
  } catch (error) {
    // If minRetention format is invalid, fall back to default
    if (config.getDebugMode()) {
      debugLogger.warn(`Failed to parse minRetention: ${error}`);
    }
    minRetentionMs = parseRetentionPeriod(DEFAULT_MIN_RETENTION);
  }

  if (maxAgeMs < minRetentionMs) {
    return `maxAge cannot be less than minRetention (${minRetention})`;
  }
  return null;
}

/**
 * Validates retention configuration
 */
function validateRetentionConfig(
  config: HiveConfig,
  retentionConfig: SessionRetentionSettings,
): string | null {
  if (!retentionConfig.enabled) {
    return 'Retention not enabled';
  }

  // Validate maxAge if provided
  const maxAgeError = validateMaxAge(config, retentionConfig);
  if (maxAgeError) {
    return maxAgeError;
  }

  // Validate maxCount if provided
  if (retentionConfig.maxCount !== undefined) {
    if (retentionConfig.maxCount < MIN_MAX_COUNT) {
      return `maxCount must be at least ${MIN_MAX_COUNT}`;
    }
  }

  // At least one retention method must be specified
  if (!retentionConfig.maxAge && retentionConfig.maxCount === undefined) {
    return 'Either maxAge or maxCount must be specified';
  }

  return null;
}

/**
 * Result of tool output cleanup operation
 */
export interface ToolOutputCleanupResult {
  disabled: boolean;
  scanned: number;
  deleted: number;
  failed: number;
}

async function collectFileStats(
  toolOutputDir: string,
  files: { name: string }[],
): Promise<Array<{ name: string; mtime: Date }>> {
  const fileStatsResults = await Promise.all(
    files.map(async (file) => {
      try {
        const filePath = path.join(toolOutputDir, file.name);
        const stat = await safeStat(filePath);
        return { name: file.name, mtime: stat.mtime };
      } catch (error) {
        debugLogger.debug(
          `Failed to stat file ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        );
        return null;
      }
    }),
  );
  return fileStatsResults.filter((f): f is { name: string; mtime: Date } => f !== null);
}

function computeFilesToDelete(
  fileStats: Array<{ name: string; mtime: Date }>,
  retentionConfig: SessionRetentionSettings,
): string[] {
  const filesToDelete: string[] = [];

  // Age-based cleanup: delete files older than maxAge
  if (retentionConfig.maxAge) {
    try {
      const maxAgeMs = parseRetentionPeriod(retentionConfig.maxAge);
      const cutoffDate = new Date(Date.now() - maxAgeMs);

      for (const file of fileStats) {
        if (file.mtime < cutoffDate) {
          filesToDelete.push(file.name);
        }
      }
    } catch (error) {
      debugLogger.debug(
        `Invalid maxAge format, skipping age-based cleanup: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  // Count-based cleanup: after age-based cleanup, if we still have more files
  // than maxCount, delete the oldest ones to bring the count down.
  // This ensures we keep at most maxCount files, preferring newer ones.
  if (retentionConfig.maxCount !== undefined) {
    // Filter out files already marked for deletion by age-based cleanup
    const remainingFiles = fileStats.filter((f) => !filesToDelete.includes(f.name));
    if (remainingFiles.length > retentionConfig.maxCount) {
      // Calculate how many excess files need to be deleted
      const excessCount = remainingFiles.length - retentionConfig.maxCount;
      // remainingFiles is already sorted oldest first, so delete from the start
      const excessNames = remainingFiles.slice(0, excessCount).map((f) => f.name);
      filesToDelete.push(...excessNames);
    }
  }

  return filesToDelete;
}

async function cleanupExpiredSubdirs(
  toolOutputDir: string,
  entries: { name: string; isDirectory(): boolean }[],
  retentionConfig: SessionRetentionSettings,
  result: ToolOutputCleanupResult,
): Promise<void> {
  const subdirs = entries.filter((e) => e.isDirectory() && e.name.startsWith('session-'));
  for (const subdir of subdirs) {
    try {
      // Security: Validate that the subdirectory name is a safe filename part
      // and doesn't attempt path traversal.
      if (subdir.name !== sanitizeFilenamePart(subdir.name)) {
        debugLogger.debug(`Skipping unsafe tool-output subdirectory: ${subdir.name}`);
        continue;
      }

      const subdirPath = path.join(toolOutputDir, subdir.name);
      const stat = await safeStat(subdirPath);

      let shouldDelete = false;
      if (retentionConfig.maxAge) {
        const maxAgeMs = parseRetentionPeriod(retentionConfig.maxAge);
        const cutoffDate = new Date(Date.now() - maxAgeMs);
        if (stat.mtime < cutoffDate) {
          shouldDelete = true;
        }
      }

      if (shouldDelete) {
        await fs.rm(subdirPath, { recursive: true, force: true });
        result.deleted++; // Count as one "unit" of deletion for stats
      }
    } catch (error) {
      debugLogger.debug(`Failed to cleanup subdir ${subdir.name}: ${error}`);
    }
  }
}

async function deleteMarkedFiles(
  toolOutputDir: string,
  filesToDelete: string[],
  result: ToolOutputCleanupResult,
): Promise<void> {
  for (const fileName of filesToDelete) {
    try {
      const filePath = path.join(toolOutputDir, fileName);
      await safeUnlink(filePath);
      result.deleted++;
    } catch (error) {
      debugLogger.debug(
        `Failed to delete file ${fileName}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      result.failed++;
    }
  }
}

/**
 * Cleans up tool output files based on age and count limits.
 * Uses the same retention settings as session cleanup.
 */
export async function cleanupToolOutputFiles(
  settings: Settings,
  debugMode: boolean = false,
  projectTempDir?: string,
): Promise<ToolOutputCleanupResult> {
  const result: ToolOutputCleanupResult = {
    disabled: false,
    scanned: 0,
    deleted: 0,
    failed: 0,
  };

  try {
    // Early exit if cleanup is disabled
    if (!settings.general?.sessionRetention?.enabled) {
      return { ...result, disabled: true };
    }

    const retentionConfig = settings.general.sessionRetention;
    let tempDir = projectTempDir;
    if (!tempDir) {
      const storage = new Storage(process.cwd());
      await storage.initialize();
      tempDir = storage.getProjectTempDir();
    }
    const toolOutputDir = path.join(tempDir, TOOL_OUTPUTS_DIR);

    // Check if directory exists
    try {
      await fs.access(toolOutputDir);
    } catch {
      // Directory doesn't exist, nothing to clean up
      return result;
    }

    // Get all entries in the tool-outputs directory
    const entries = (await safeReaddir(toolOutputDir, {
      withFileTypes: true,
    })) as fsTypes.Dirent[];
    result.scanned = entries.length;

    if (entries.length === 0) {
      return result;
    }

    const files = entries.filter((e) => e.isFile());

    // Get file stats for age-based cleanup (parallel for better performance)
    const fileStats = await collectFileStats(toolOutputDir, files);

    // Sort by mtime (oldest first)
    fileStats.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

    const filesToDelete = computeFilesToDelete(fileStats, retentionConfig);

    // For now, continue to cleanup individual files in the root tool-outputs dir
    // but also scan and cleanup expired session subdirectories.
    await cleanupExpiredSubdirs(toolOutputDir, entries, retentionConfig, result);

    // Delete the files
    await deleteMarkedFiles(toolOutputDir, filesToDelete, result);

    if (debugMode && result.deleted > 0) {
      debugLogger.debug(`Tool output cleanup: deleted ${result.deleted}, failed ${result.failed}`);
    }
  } catch (error) {
    // Global error handler - don't let cleanup failures break startup
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    debugLogger.warn(`Tool output cleanup failed: ${errorMessage}`);
    result.failed++;
  }

  return result;
}
