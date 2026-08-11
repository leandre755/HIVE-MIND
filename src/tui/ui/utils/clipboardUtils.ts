import { execSync, spawn } from 'node:child_process';
import * as path from 'node:path';
import { debugLogger } from '../../utils/errors.js';
import { spawnAsync, escapePath, Storage } from '../contexts/UIStateContext.js';
import {
  safeCreateWriteStream,
  safeStat,
  safeUnlink,
  safeMkdir,
  safeReaddir,
  safeExistsSync,
  safeStatSync,
} from '../../../utils/safeFs.js';

/**
 * Supported image file extensions based on Gemini API.
 * See: https://ai.google.dev/gemini-api/docs/image-understanding
 */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif'];

/** Matches strings that start with a path prefix (/, ~, ., Windows drive letter, or UNC path) */
const PATH_PREFIX_PATTERN = /^([/~.]|[a-zA-Z]:|\\\\)/;

// Track which tool works on Linux to avoid redundant checks/failures
let linuxClipboardTool: 'wl-paste' | 'xclip' | null = null;

// Helper to check the user's display server and whether they have a compatible clipboard tool installed
function getUserLinuxClipboardTool(): typeof linuxClipboardTool {
  if (linuxClipboardTool !== null) {
    return linuxClipboardTool;
  }

  let toolName: 'wl-paste' | 'xclip' | null = null;
  const displayServer = process.env['XDG_SESSION_TYPE'];

  if (displayServer === 'wayland') toolName = 'wl-paste';
  else if (displayServer === 'x11') toolName = 'xclip';
  else return null;

  try {
    // output is piped to stdio: 'ignore' to suppress the path printing to console
    execSync(`command -v ${toolName}`, { stdio: 'ignore' });
    linuxClipboardTool = toolName;
    return toolName;
  } catch (e) {
    debugLogger.warn(`${toolName} not found. Please install it: ${e}`);
    return null;
  }
}

/**
 * Helper to save command stdout to a file while preventing shell injections and race conditions
 */
async function saveFromCommand(
  command: string,
  args: string[],
  destination: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args);
    const fileStream = safeCreateWriteStream(destination);
    let resolved = false;

    const safeResolve = (value: boolean) => {
      if (!resolved) {
        resolved = true;
        resolve(value);
      }
    };

    child.stdout.pipe(fileStream);

    child.on('error', (err) => {
      debugLogger.debug(`Failed to spawn ${command}:`, err);
      safeResolve(false);
    });

    fileStream.on('error', (err) => {
      debugLogger.debug(`File stream error for ${destination}:`, err);
      safeResolve(false);
    });

    child.on('close', async (code) => {
      if (resolved) return;

      if (code !== 0) {
        debugLogger.debug(`${command} exited with code ${code}. Args: ${args.join(' ')}`);
        safeResolve(false);
        return;
      }

      // Helper to check file size
      const checkFile = async () => {
        try {
          const stats = await safeStat(destination);
          safeResolve(stats.size > 0);
        } catch (e) {
          debugLogger.debug(`Failed to stat output file ${destination}:`, e);
          safeResolve(false);
        }
      };

      if (fileStream.writableFinished) {
        await checkFile();
      } else {
        fileStream.on('finish', checkFile);
        // In case finish never fires due to error (though error handler should catch it)
        fileStream.on('close', async () => {
          if (!resolved) await checkFile();
        });
      }
    });
  });
}

/**
 * Checks if the Wayland clipboard contains an image using wl-paste.
 */
async function checkWlPasteForImage() {
  try {
    const { stdout } = await spawnAsync('wl-paste', ['--list-types']);
    return stdout.includes('image/');
  } catch (e) {
    debugLogger.warn('Error checking wl-clipboard for image:', e);
  }
  return false;
}

/**
 * Checks if the X11 clipboard contains an image using xclip.
 */
async function checkXclipForImage() {
  try {
    const { stdout } = await spawnAsync('xclip', [
      '-selection',
      'clipboard',
      '-t',
      'TARGETS',
      '-o',
    ]);
    return stdout.includes('image/');
  } catch (e) {
    debugLogger.warn('Error checking xclip for image:', e);
  }
  return false;
}

/**
 * Checks if the system clipboard contains an image (macOS, Windows, and Linux)
 * @returns true if clipboard contains an image
 */
export async function clipboardHasImage(): Promise<boolean> {
  if (process.platform === 'linux') {
    const tool = getUserLinuxClipboardTool();
    if (tool === 'wl-paste') {
      if (await checkWlPasteForImage()) return true;
    } else if (tool === 'xclip') {
      if (await checkXclipForImage()) return true;
    }
    return false;
  }

  if (process.platform === 'win32') {
    try {
      const { stdout } = await spawnAsync('powershell', [
        '-NoProfile',
        '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::ContainsImage()',
      ]);
      return stdout.trim() === 'True';
    } catch (error) {
      debugLogger.warn('Error checking clipboard for image:', error);
      return false;
    }
  }

  if (process.platform !== 'darwin') {
    return false;
  }

  try {
    // Use osascript to check clipboard type
    const { stdout } = await spawnAsync('osascript', ['-e', 'clipboard info']);
    const imageRegex =
      /«class PNGf»|TIFF picture|JPEG picture|GIF picture|«class JPEG»|«class TIFF»/;
    return imageRegex.test(stdout);
  } catch (error) {
    debugLogger.warn('Error checking clipboard for image:', error);
    return false;
  }
}

/**
 * Saves clipboard content to a file using wl-paste (Wayland).
 */
async function saveFileWithWlPaste(tempFilePath: string) {
  const success = await saveFromCommand(
    'wl-paste',
    ['--no-newline', '--type', 'image/png'],
    tempFilePath,
  );
  if (success) {
    return true;
  }
  // Cleanup on failure
  try {
    await safeUnlink(tempFilePath);
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Saves clipboard content to a file using xclip (X11).
 */
const saveFileWithXclip = async (tempFilePath: string) => {
  const success = await saveFromCommand(
    'xclip',
    ['-selection', 'clipboard', '-t', 'image/png', '-o'],
    tempFilePath,
  );
  if (success) {
    return true;
  }
  // Cleanup on failure
  try {
    await safeUnlink(tempFilePath);
  } catch {
    /* ignore */
  }
  return false;
};

/**
 * Gets the directory where clipboard images should be stored for a specific project.
 *
 * This uses the global temporary directory but creates a project-specific subdirectory
 * based on the hash of the project path (via `Storage.getProjectTempDir()`).
 * This prevents path conflicts between different projects while keeping the images
 * outside of the user's project directory.
 *
 * @param targetDir The root directory of the current project.
 * @returns The absolute path to the images directory.
 */
async function getProjectClipboardImagesDir(targetDir: string): Promise<string> {
  const storage = new Storage(targetDir);
  await storage.initialize();
  const baseDir = storage.getProjectTempDir();
  return path.join(baseDir, 'images');
}

async function saveClipboardImageLinux(tempDir: string, timestamp: number): Promise<string | null> {
  const tempFilePath = path.join(tempDir, `clipboard-${timestamp}.png`);
  const tool = getUserLinuxClipboardTool();

  if (tool === 'wl-paste') {
    if (await saveFileWithWlPaste(tempFilePath)) return tempFilePath;
    return null;
  }
  if (tool === 'xclip') {
    if (await saveFileWithXclip(tempFilePath)) return tempFilePath;
    return null;
  }
  return null;
}

async function saveClipboardImageWindows(
  tempDir: string,
  timestamp: number,
): Promise<string | null> {
  const tempFilePath = path.join(tempDir, `clipboard-${timestamp}.png`);
  const psPath = tempFilePath.replace(/'/g, "''");

  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
      $image = [System.Windows.Forms.Clipboard]::GetImage()
      $image.Save('${psPath}', [System.Drawing.Imaging.ImageFormat]::Png)
      Write-Output "success"
    }
  `;

  const { stdout } = await spawnAsync('powershell', ['-NoProfile', '-Command', script]);

  if (stdout.trim() === 'success') {
    try {
      const stats = await safeStat(tempFilePath);
      if (stats.size > 0) {
        return tempFilePath;
      }
    } catch {
      // File doesn't exist
    }
  }
  return null;
}

async function saveClipboardImageMacFormat(
  tempFilePath: string,
  formatClass: string,
): Promise<boolean> {
  const script = `
    try
      set imageData to the clipboard as «class ${formatClass}»
      set fileRef to open for access POSIX file "${tempFilePath}" with write permission
      write imageData to fileRef
      close access fileRef
      return "success"
    on error errMsg
      try
        close access POSIX file "${tempFilePath}"
      end try
      return "error"
    end try
  `;

  const { stdout } = await spawnAsync('osascript', ['-e', script]);
  if (stdout.trim() === 'success') {
    try {
      const stats = await safeStat(tempFilePath);
      if (stats.size > 0) {
        return true;
      }
    } catch (e) {
      debugLogger.debug('Clipboard image file not found:', tempFilePath, e);
    }
  }
  try {
    await safeUnlink(tempFilePath);
  } catch (e) {
    debugLogger.debug('Failed to clean up temp file:', tempFilePath, e);
  }
  return false;
}

async function saveClipboardImageMac(tempDir: string, timestamp: number): Promise<string | null> {
  const formats = [
    { class: 'PNGf', extension: 'png' },
    { class: 'JPEG', extension: 'jpg' },
  ];

  for (const format of formats) {
    const tempFilePath = path.join(tempDir, `clipboard-${timestamp}.${format.extension}`);
    const ok = await saveClipboardImageMacFormat(tempFilePath, format.class);
    if (ok) return tempFilePath;
  }
  return null;
}

/**
 * Saves the image from clipboard to a temporary file (macOS, Windows, and Linux)
 * @param targetDir The target directory to create temp files within
 * @returns The path to the saved image file, or null if no image or error
 */
export async function saveClipboardImage(targetDir: string): Promise<string | null> {
  try {
    const tempDir = await getProjectClipboardImagesDir(targetDir);
    await safeMkdir(tempDir, { recursive: true });

    const timestamp = new Date().getTime();

    if (process.platform === 'linux') {
      return saveClipboardImageLinux(tempDir, timestamp);
    }
    if (process.platform === 'win32') {
      return saveClipboardImageWindows(tempDir, timestamp);
    }
    return saveClipboardImageMac(tempDir, timestamp);
  } catch (error) {
    debugLogger.warn('Error saving clipboard image:', error);
    return null;
  }
}

/**
 * Cleans up old temporary clipboard image files
 * Removes files older than 1 hour
 * @param targetDir The target directory where temp files are stored
 */
export async function cleanupOldClipboardImages(targetDir: string): Promise<void> {
  try {
    const tempDir = await getProjectClipboardImagesDir(targetDir);
    const files = await safeReaddir(tempDir);
    const oneHourAgo = Date.now() - 60 * 60 * 1000;

    for (const file of files as string[]) {
      const ext = path.extname(file).toLowerCase();
      if (file.startsWith('clipboard-') && IMAGE_EXTENSIONS.includes(ext)) {
        const filePath = path.join(tempDir, file);
        const stats = await safeStat(filePath);
        if (stats.mtimeMs < oneHourAgo) {
          await safeUnlink(filePath);
        }
      }
    }
  } catch (e) {
    // Ignore errors in cleanup
    debugLogger.debug('Failed to clean up old clipboard images:', e);
  }
}

type ParseMode = 'NORMAL' | 'DOUBLE' | 'SINGLE';

function processQuotedChar(
  char: string,
  mode: 'DOUBLE' | 'SINGLE',
  current: string,
): { nextCurrent: string; nextMode: ParseMode } {
  const quoteChar = mode === 'DOUBLE' ? '"' : "'";
  if (char === quoteChar) {
    return { nextCurrent: current, nextMode: 'NORMAL' };
  }
  return { nextCurrent: current + char, nextMode: mode };
}

function processNormalChar(
  char: string,
  i: number,
  text: string,
  isWindows: boolean,
  current: string,
): { nextCurrent: string; nextIndex: number; nextMode: ParseMode; yieldItem?: string } {
  if (char === ' ') {
    if (current.length > 0) {
      return { nextCurrent: '', nextIndex: i, nextMode: 'NORMAL', yieldItem: current };
    }
    return { nextCurrent: '', nextIndex: i, nextMode: 'NORMAL' };
  }
  if (char === '"') {
    return { nextCurrent: current, nextIndex: i, nextMode: 'DOUBLE' };
  }
  if (char === "'") {
    return { nextCurrent: current, nextIndex: i, nextMode: 'SINGLE' };
  }
  if (char === '\\' && !isWindows) {
    if (i + 1 < text.length) {
      const nextChar = text.charAt(i + 1);
      return { nextCurrent: current + nextChar, nextIndex: i + 1, nextMode: 'NORMAL' };
    }
  }
  return { nextCurrent: current + char, nextIndex: i, nextMode: 'NORMAL' };
}

/**
 * Splits a pasted text block up into escaped path segements if it's a legal
 * drag-and-drop string.
 *
 * @param text
 * @returns An iterable of escaped paths
 */
export function* splitDragAndDropPaths(text: string): Generator<string> {
  let current = '';
  let mode: ParseMode = 'NORMAL';
  const isWindows = process.platform === 'win32';

  let i = 0;
  while (i < text.length) {
    const char = text.charAt(i);

    if (mode === 'NORMAL') {
      const res = processNormalChar(char, i, text, isWindows, current);
      current = res.nextCurrent;
      i = res.nextIndex;
      mode = res.nextMode;
      if (res.yieldItem !== undefined) {
        yield res.yieldItem;
      }
    } else {
      const res = processQuotedChar(char, mode, current);
      current = res.nextCurrent;
      mode = res.nextMode;
    }

    i++;
  }

  if (current.length > 0) {
    yield current;
  }
}

/**
 * Helper to validate if a path exists and is a file.
 */
function isValidFilePath(p: string): boolean {
  try {
    return PATH_PREFIX_PATTERN.test(p) && safeExistsSync(p) && safeStatSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Processes pasted text containing file paths (like those from drag and drop),
 * adding @ prefix to valid paths and escaping them in a standard way.
 *
 * @param text The pasted text
 * @returns Processed string with @ prefixes or null if any paths are invalid
 */
export function parsePastedPaths(text: string): string | null {
  // First, check if the entire text is a single valid path
  if (isValidFilePath(text)) {
    return `@${escapePath(text)} `;
  }

  const validPaths = [];
  for (const segment of splitDragAndDropPaths(text)) {
    if (isValidFilePath(segment)) {
      validPaths.push(`@${escapePath(segment)}`);
    } else {
      return null; // If any segment is invalid, return null for the whole string
    }
  }
  if (validPaths.length === 0) {
    return null;
  }
  return validPaths.join(' ') + ' ';
}
