import {
  safeExistsSync,
  safeReaddirSync,
  safeStatSync,
  safeReadFileSync,
  resolveWithinRoot,
} from '../../../utils/safeFs.js';
import * as path from 'path';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { permissionManager } from '../../../core/security/PermissionManager.js';
import { fileState } from './FileState.js';
import { hashLines } from '../../../services/anchor/index.js';
import { readFileInRange } from '../../../utils/readFileInRange.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const MAX_FILES_TO_LIST = 1000;
const MAX_READ_LINES = 800;
const BANNED_DIRS = ['node_modules', '.git', '.next', 'dist', 'build'];

// ── Types ──────────────────────────────────────────────────────────────────

interface SearchToolArgs {
  dir_path?: string;
  query?: string;
  search_path?: string;
  file_path?: string;
  start_line?: number;
  end_line?: number;
  offset?: number;
  limit?: number;
}

interface SearchToolContext {
  chatId: string;
  sourceChannel: string;
  message?: {
    sender?: string;
  };
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

// ── Helper functions ──────────────────────────────────────────────────────

function handleListDirectory(
  args: SearchToolArgs,
  checkReadAccess: (p: string) => Promise<{ granted: boolean }>,
): Promise<{ success: boolean; message: string }> {
  return (async () => {
    const dirPath = args.dir_path || '.';
    if (!(await checkReadAccess(dirPath)).granted) {
      return { success: false, message: 'Permission denied for listing outside sandbox.' };
    }

    const absolutePath = resolveWithinRoot(
      permissionManager.sandboxDir,
      dirPath,
      permissionManager.sandboxDir,
    );
    if (!safeExistsSync(absolutePath))
      return { success: false, message: `Directory ${dirPath} does not exist.` };

    const isSandboxRoot = absolutePath === permissionManager.sandboxDir;

    const items = safeReaddirSync(absolutePath);
    let result = '';
    let count = 0;

    for (const itemName of items) {
      if (BANNED_DIRS.includes(itemName) || itemName.startsWith('.git')) continue;
      if (isSandboxRoot && itemName === 'storage_hm') continue;

      const itemPath = resolveWithinRoot(absolutePath, itemName);
      const isDir = safeStatSync(itemPath).isDirectory();
      const type = isDir ? '[DIR] ' : '[FILE]';
      result += `${type} ${itemName}\n`;
      count++;
      if (count >= MAX_FILES_TO_LIST) {
        result += `\n... (More than ${MAX_FILES_TO_LIST} files, use grep or target a sub-folder) ...`;
        break;
      }
    }
    return { success: true, message: result || 'Empty directory.' };
  })();
}

async function handleGrepSearch(
  args: SearchToolArgs,
  checkReadAccess: (p: string) => Promise<{ granted: boolean }>,
): Promise<{ success: boolean; message: string }> {
  const { query, search_path } = args;
  if (!query || typeof query !== 'string') {
    return {
      success: false,
      message: `TOOL_ERROR: grep_search requires a valid "query" parameter (got ${typeof query}).`,
    };
  }
  if (!search_path || typeof search_path !== 'string') {
    return {
      success: false,
      message: `TOOL_ERROR: grep_search requires a valid "search_path" parameter (got ${typeof search_path}).`,
    };
  }
  if (!(await checkReadAccess(search_path)).granted) {
    return { success: false, message: 'Permission denied for searching outside sandbox.' };
  }

  const absolutePath = resolveWithinRoot(
    permissionManager.sandboxDir,
    search_path,
    permissionManager.sandboxDir,
  );

  let stdout = '';
  let rgFound = false;
  try {
    await execAsync('which rg');
    rgFound = true;
  } catch {
    // rg not found, default to grep
  }

  try {
    if (rgFound) {
      console.log('[SearchTools] 🚀 Using Ripgrep (rg)');
      const result = await execFileAsync('rg', [
        '--no-heading',
        '--line-number',
        '-F',
        '-e',
        query,
        '--',
        absolutePath,
      ]);
      stdout = result.stdout;
    } else {
      console.log('[SearchTools] 🐌 Falling back to standard grep');
      const excludeArgs = BANNED_DIRS.map((d) => `--exclude-dir=${d}`);
      const result = await execFileAsync('grep', [
        '-rn',
        '-F',
        ...excludeArgs,
        '-e',
        query,
        '--',
        absolutePath,
      ]);
      stdout = result.stdout;
    }
  } catch (e: unknown) {
    const errCode = (e as { code?: number }).code;
    const errMsg = extractErrorMessage(e);
    if (errCode === 1) return { success: true, message: 'No results found.' };
    return { success: false, message: `Grep error: ${errMsg}` };
  }

  const lines = stdout.split('\n');
  if (lines.length > 100) {
    return {
      success: true,
      message: lines.slice(0, 100).join('\n') + '\n\n... [TRUNCATED at 100 results] ...',
    };
  }
  return { success: true, message: stdout || 'No results.' };
}

function computeOffsetAndLimit(args: SearchToolArgs): { offset: number; limit: number } {
  const { start_line, end_line, offset: argOffset, limit: argLimit } = args;

  let offset = 0;
  if (argOffset !== undefined) {
    offset = Math.max(0, argOffset);
  } else if (start_line !== undefined) {
    offset = Math.max(0, start_line - 1);
  }

  let limit = MAX_READ_LINES;
  if (argLimit !== undefined) {
    limit = Math.max(1, argLimit);
  } else if (end_line !== undefined) {
    const startRef = start_line !== undefined ? start_line : offset + 1;
    limit = Math.max(1, end_line - startRef + 1);
  }

  return { offset, limit };
}

function readSmallFileContent(absolutePath: string, offset: number, limit: number): string {
  const content = safeReadFileSync(absolutePath, 'utf8');
  const hashedContent = hashLines(absolutePath, content);
  const hashedLines = hashedContent.split('\n');

  const startIdx = offset;
  const endIdx = Math.min(hashedLines.length, startIdx + limit);
  let result = hashedLines.slice(startIdx, endIdx).join('\n') + '\n';

  if (hashedLines.length > endIdx) {
    result +=
      '\n... (File truncated. Use offset and limit parameters to read specific portions) ...';
  }
  return result;
}

async function readLargeFileContent(
  absolutePath: string,
  offset: number,
  limit: number,
): Promise<string> {
  const readResult = await readFileInRange(absolutePath, offset, limit);
  let result = hashLines(absolutePath, readResult.content);

  if (readResult.totalLines > offset + readResult.lineCount) {
    result +=
      '\n... (File truncated. Use offset and limit parameters to read specific portions) ...';
  }
  return result;
}

async function handleReadFile(
  args: SearchToolArgs,
  checkReadAccess: (p: string) => Promise<{ granted: boolean }>,
): Promise<{ success: boolean; message: string }> {
  const { file_path } = args;
  if (!file_path || typeof file_path !== 'string') {
    return {
      success: false,
      message: `TOOL_ERROR: read_file requires a valid "file_path" parameter (got ${typeof file_path}). Please provide the file path as a string.`,
    };
  }
  if (!(await checkReadAccess(file_path)).granted) {
    return { success: false, message: 'Permission denied for reading outside sandbox.' };
  }

  const absolutePath = resolveWithinRoot(
    permissionManager.sandboxDir,
    file_path,
    permissionManager.sandboxDir,
  );
  if (!safeExistsSync(absolutePath))
    return { success: false, message: `File ${file_path} does not exist.` };

  fileState.recordRead(absolutePath);

  const { offset, limit } = computeOffsetAndLimit(args);
  const stats = safeStatSync(absolutePath);

  const result =
    stats.size < 10 * 1024 * 1024
      ? readSmallFileContent(absolutePath, offset, limit)
      : await readLargeFileContent(absolutePath, offset, limit);

  return { success: true, message: result };
}

export default {
  name: 'dev_tools_search',
  description: 'Read-only search tools (LS, Grep, File Reading)',
  version: '1.0.0',
  enabled: true,

  toolDefinitions: [
    {
      type: 'function',
      function: {
        name: 'list_directory',
        description: 'Lists files and folders in a specified directory (limited to 1000 items).',
        parameters: {
          type: 'object',
          properties: {
            dir_path: {
              type: 'string',
              description: 'The directory path to list (e.g., ".", "src/")',
            },
          },
          required: ['dir_path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'grep_search',
        description: 'Search for a string or regular expression in files using ripgrep or grep.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The term to search for' },
            search_path: {
              type: 'string',
              description: 'The directory or file to search in (e.g., "src/")',
            },
          },
          required: ['query', 'search_path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description:
          'Reads file content with line numbers and anchors (limited to 800 lines at a time). Supports line range offset and limit.',
        parameters: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'The path of the file to read' },
            start_line: { type: 'number', description: 'Start line (1-indexed)' },
            end_line: { type: 'number', description: 'End line (optional)' },
            offset: {
              type: 'number',
              description: 'Offset in lines (alternative to start_line, 0-indexed)',
            },
            limit: { type: 'number', description: 'Limit of lines to read' },
          },
          required: ['file_path'],
        },
      },
    },
  ],

  async execute(args: SearchToolArgs, _context: SearchToolContext, toolName: string) {
    const checkReadAccess = async (targetPath: string): Promise<{ granted: boolean }> => {
      const absolutePath = resolveWithinRoot(
        permissionManager.sandboxDir,
        targetPath,
        permissionManager.sandboxDir,
      );
      const sandboxDir = permissionManager.sandboxDir;
      const isGranted =
        absolutePath === sandboxDir || absolutePath.startsWith(sandboxDir + path.sep);
      return { granted: isGranted };
    };

    try {
      switch (toolName) {
        case 'list_directory':
          return await handleListDirectory(args, checkReadAccess);
        case 'grep_search':
          return await handleGrepSearch(args, checkReadAccess);
        case 'read_file':
          return await handleReadFile(args, checkReadAccess);
        default:
          return null;
      }
    } catch (error: unknown) {
      return { success: false, message: `Error in ${toolName}: ${extractErrorMessage(error)}` };
    }
  },
};
