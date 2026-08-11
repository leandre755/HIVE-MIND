import {
  safeExistsSync,
  safeStatSync,
  safeReadFileSync,
  safeWriteFileSync,
  resolveWithinRoot,
} from '../../../utils/safeFs.js';
import { permissionManager } from '../../../core/security/PermissionManager.js';
import { fileState } from './FileState.js';
import { AnchorStateManager, extractId, hashLines } from '../../../services/anchor/index.js';
import { fileStateCache } from '../../../utils/fileStateCache.js';

// --- Type helpers ---

interface ToolContext {
  chatId?: string;
  sourceChannel?: string;
  message?: { sender?: string };
}

interface EditItem {
  edit_type: string;
  anchor: string;
  end_anchor?: string;
  text: string;
}

interface FileEntry {
  path: string;
  edits: EditItem[];
}

interface AnchorModeArgs {
  files?: FileEntry[];
}

interface LegacyModeArgs {
  file_path?: string;
  old_string?: string;
  new_string?: string;
}

type EditFileArgs = AnchorModeArgs & LegacyModeArgs;

interface LegacyEditResult {
  success: boolean;
  message?: string;
  llmOutput?: string;
  userOutput?: string;
}

interface EditResult {
  success: boolean;
  editsApplied: number;
  message: string;
}

interface ResolvedEdit {
  type: string;
  startIdx: number;
  endIdx: number;
  text: string;
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return String(error);
}

function isFileStale(absolutePath: string): boolean {
  const { changed, lastRead } = fileState.hasChanged(absolutePath);
  if (lastRead === undefined) {
    const cachedState = fileStateCache.get(absolutePath);
    if (cachedState) {
      const currentStats = safeStatSync(absolutePath);
      return currentStats.mtimeMs > cachedState.mtimeMs;
    }
    return false;
  }
  return changed;
}

async function checkPermission(
  absolutePath: string,
  chatId: string,
  sourceChannel: string,
  context: ToolContext,
): Promise<{ granted: boolean; message: string }> {
  const validation = permissionManager.validateFileWrite(absolutePath);
  if (!validation.requiresPermission) {
    return { granted: true, message: '' };
  }

  const permResult = await permissionManager.askPermission(
    chatId,
    `Edit: ${absolutePath}`,
    sourceChannel,
    context.message?.sender || 'system',
  );

  if (!permResult.granted) {
    const message = permResult.feedback
      ? `[ACTION REJECTED] ${permResult.feedback}`
      : '[ACTION REJECTED] Permission denied.';
    return { granted: false, message };
  }

  return { granted: true, message: '' };
}

export default {
  name: 'dev_tools_file_edit',
  description: 'File editing tool via exact replacement or hash-stable anchors.',
  version: '2.0.0',
  enabled: true,

  toolDefinitions: [
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: `Modifies one or more files via hash-stable anchors (recommended) or by exact replacement (fallback).

PRIMARY MODE (Hash Anchors) — Use anchors returned by read_file:
- edit_type: "replace" (replaces from anchor to end_anchor inclusive), "insert_after", "insert_before"
- anchor: The full line with its anchor (e.g., "AppleBanana§    def process(data):")
- end_anchor: Required for "replace" only
- text: The new content (without anchors, with indentation)

LEGACY MODE (Exact Replacement) — Fallback if anchors are not available:
- old_string + new_string (the old behavior)

BATCHING: You CAN group multiple files and edits in a single call via the "files" parameter.`,
        parameters: {
          type: 'object',
          properties: {
            // ── Legacy mode (single file) ──
            file_path: {
              type: 'string',
              description: 'File path (legacy mode only).',
            },
            old_string: {
              type: 'string',
              description: 'The EXACT text to replace (legacy mode).',
            },
            new_string: {
              type: 'string',
              description: 'The new text (legacy mode).',
            },
            // ── Anchor mode (multi-file batched) ──
            files: {
              type: 'array',
              description: 'Array of files with anchored edits (primary mode).',
              items: {
                type: 'object',
                properties: {
                  path: {
                    type: 'string',
                    description: 'Relative or absolute file path.',
                  },
                  edits: {
                    type: 'array',
                    description: 'Array of edits to apply.',
                    items: {
                      type: 'object',
                      properties: {
                        edit_type: {
                          type: 'string',
                          enum: ['replace', 'insert_after', 'insert_before'],
                          description: 'Edit type.',
                        },
                        anchor: {
                          type: 'string',
                          description: 'Start anchor (full line with prefix).',
                        },
                        end_anchor: {
                          type: 'string',
                          description: 'End anchor (required for replace).',
                        },
                        text: {
                          type: 'string',
                          description: 'New content. Use \\n for new lines.',
                        },
                      },
                      required: ['edit_type', 'anchor', 'text'],
                    },
                  },
                },
                required: ['path', 'edits'],
              },
            },
          },
        },
      },
    },
  ],

  async execute(args: EditFileArgs, context: ToolContext, toolName: string) {
    if (toolName !== 'edit_file') return null;

    const { chatId, sourceChannel } = context;

    if (args.files && Array.isArray(args.files)) {
      return executeAnchorMode(args.files, chatId!, sourceChannel!, context);
    }

    return executeLegacyMode(args, chatId!, sourceChannel!, context);
  },
};

// ============================================================================
// ANCHOR MODE — Dirac-style hash-anchored edits (multi-file batched)
// ============================================================================

async function processSingleFileAnchorEdit(
  fileEntry: FileEntry,
  chatId: string,
  sourceChannel: string,
  context: ToolContext,
): Promise<{ file: string; success: boolean; editsApplied: number; message: string }> {
  const absolutePath = resolveWithinRoot(
    permissionManager.sandboxDir,
    fileEntry.path,
    permissionManager.sandboxDir,
  );

  const permResult = await checkPermission(absolutePath, chatId, sourceChannel, context);
  if (!permResult.granted) {
    return {
      file: fileEntry.path,
      success: false,
      editsApplied: 0,
      message: permResult.message,
    };
  }

  if (!safeExistsSync(absolutePath)) {
    return {
      file: fileEntry.path,
      success: false,
      editsApplied: 0,
      message: `File does not exist: ${absolutePath}`,
    };
  }

  if (isFileStale(absolutePath)) {
    return {
      file: fileEntry.path,
      success: false,
      editsApplied: 0,
      message: 'SECURITY_ERROR: File modified since last read. Re-read with read_file.',
    };
  }

  try {
    const result = applyAnchoredEdits(absolutePath, fileEntry.edits);
    fileState.recordRead(absolutePath);
    return {
      file: fileEntry.path,
      success: result.success,
      editsApplied: result.editsApplied,
      message: result.message,
    };
  } catch (error: unknown) {
    return {
      file: fileEntry.path,
      success: false,
      editsApplied: 0,
      message: `Error: ${extractErrorMessage(error)}`,
    };
  }
}

async function executeAnchorMode(
  files: FileEntry[],
  chatId: string,
  sourceChannel: string,
  context: ToolContext,
): Promise<LegacyEditResult> {
  const results: Array<{ file: string; success: boolean; editsApplied: number; message: string }> =
    [];

  for (const fileEntry of files) {
    results.push(await processSingleFileAnchorEdit(fileEntry, chatId, sourceChannel, context));
  }

  const allSuccess = results.every((r) => r.success);
  const totalEdits = results.reduce((sum, r) => sum + r.editsApplied, 0);

  const summary = results
    .map((r) => `${r.success ? '✅' : '❌'} ${r.file}: ${r.editsApplied} edits — ${r.message}`)
    .join('\n');

  return {
    success: allSuccess,
    llmOutput: `${allSuccess ? 'SUCCESS' : 'PARTIAL'}: ${totalEdits} edits across ${results.length} file(s).\n${summary}`,
    userOutput: `📝 *Multi-file edit*: ${totalEdits} changes in ${results.length} file(s)`,
  };
}

function resolveSingleEdit(
  edit: EditItem,
  anchorToLineIndex: Map<string, number>,
): { edit?: ResolvedEdit; error?: string } {
  const anchorId = extractId(edit.anchor);
  const startIdx = anchorToLineIndex.get(anchorId);

  if (startIdx === undefined) {
    return {
      error: `Anchor not found: "${anchorId}". The file might have changed — re-read with read_file.`,
    };
  }

  let endIdx = startIdx;
  if (edit.edit_type === 'replace' && edit.end_anchor) {
    const endAnchorId = extractId(edit.end_anchor);
    const resolved = anchorToLineIndex.get(endAnchorId);
    if (resolved === undefined) {
      return { error: `End anchor not found: "${endAnchorId}".` };
    }
    if (resolved < startIdx) {
      return { error: `end_anchor ("${endAnchorId}") must be AFTER anchor ("${anchorId}").` };
    }
    endIdx = resolved;
  }

  return {
    edit: {
      type: edit.edit_type || 'replace',
      startIdx,
      endIdx,
      text: edit.text,
    },
  };
}

function checkOverlappingEdits(resolvedEdits: ResolvedEdit[]): string | null {
  for (let i = 0; i < resolvedEdits.length - 1; i++) {
    const current = resolvedEdits.at(i);
    const next = resolvedEdits.at(i + 1);
    if (!current || !next) continue;
    if (next.endIdx >= current.startIdx && next.startIdx <= current.endIdx) {
      return `Overlapping edits detected at lines ${next.startIdx + 1}-${next.endIdx + 1} and ${current.startIdx + 1}-${current.endIdx + 1}.`;
    }
  }
  return null;
}

function applyAnchoredEdits(absolutePath: string, edits: EditItem[]): EditResult {
  const content = safeReadFileSync(absolutePath, 'utf8');
  const lines = content.split('\n');

  let anchors = AnchorStateManager.getAnchors(absolutePath);
  if (!anchors) {
    anchors = AnchorStateManager.reconcile(absolutePath, lines);
  }

  const anchorToLineIndex = new Map<string, number>();
  for (const [i, anchor] of anchors.entries()) {
    anchorToLineIndex.set(anchor, i);
  }

  const resolvedEdits: ResolvedEdit[] = [];
  for (const edit of edits) {
    const res = resolveSingleEdit(edit, anchorToLineIndex);
    if (res.error || !res.edit) {
      return { success: false, editsApplied: 0, message: res.error || 'Failed to resolve edit.' };
    }
    resolvedEdits.push(res.edit);
  }

  resolvedEdits.sort((a, b) => b.startIdx - a.startIdx);

  const overlapError = checkOverlappingEdits(resolvedEdits);
  if (overlapError) {
    return { success: false, editsApplied: 0, message: overlapError };
  }

  const mutableLines = [...lines];
  let editsApplied = 0;

  for (const edit of resolvedEdits) {
    const newLines = edit.text === '' ? [] : edit.text.split('\n');
    if (edit.type === 'replace') {
      mutableLines.splice(edit.startIdx, edit.endIdx - edit.startIdx + 1, ...newLines);
      editsApplied++;
    } else if (edit.type === 'insert_after') {
      mutableLines.splice(edit.startIdx + 1, 0, ...newLines);
      editsApplied++;
    } else if (edit.type === 'insert_before') {
      mutableLines.splice(edit.startIdx, 0, ...newLines);
      editsApplied++;
    } else {
      return {
        success: false,
        editsApplied,
        message: `Unknown edit type: "${edit.type}". Accepted values: replace, insert_after, insert_before.`,
      };
    }
  }

  const newContent = mutableLines.join('\n');
  safeWriteFileSync(absolutePath, newContent, 'utf8');
  AnchorStateManager.reconcile(absolutePath, mutableLines);

  return {
    success: true,
    editsApplied,
    message: `${editsApplied} edition(s) applied.`,
  };
}

// ============================================================================
// LEGACY MODE — Original old_string/new_string replacement
// ============================================================================

async function executeLegacyMode(
  args: EditFileArgs,
  chatId: string,
  sourceChannel: string,
  context: ToolContext,
): Promise<LegacyEditResult> {
  const { file_path, old_string, new_string } = args;

  if (!file_path || old_string === undefined || new_string === undefined) {
    return {
      success: false,
      message:
        'Missing parameters. Anchor mode: provide "files". Legacy mode: provide "file_path", "old_string", "new_string".',
    };
  }

  const absolutePath = resolveWithinRoot(
    permissionManager.sandboxDir,
    file_path,
    permissionManager.sandboxDir,
  );

  const permResult = await checkPermission(absolutePath, chatId, sourceChannel, context);
  if (!permResult.granted) {
    return {
      success: false,
      message: permResult.message || '[ACTION REJECTED] Permission denied.',
    };
  }

  if (!safeExistsSync(absolutePath)) {
    return { success: false, message: `Error: File ${absolutePath} does not exist.` };
  }

  if (isFileStale(absolutePath)) {
    return {
      success: false,
      message: `SECURITY_ERROR: File ${file_path} has been modified on disk since you last read it. Re-read with read_file before applying changes to avoid overwriting user work.`,
    };
  }

  try {
    const content = safeReadFileSync(absolutePath, 'utf8');
    const occurrences = content.split(old_string).length - 1;

    if (occurrences === 0) {
      return {
        success: false,
        message:
          "Error: 'old_string' was not found exactly in the file. Check spaces and indentation.",
      };
    }

    if (occurrences > 1) {
      return {
        success: false,
        message: `Error: Found ${occurrences} matches for 'old_string'. Modify your 'old_string' to include more context lines to make it unique.`,
      };
    }

    const newContent = content.replace(old_string, new_string);
    safeWriteFileSync(absolutePath, newContent, 'utf8');

    fileState.recordRead(absolutePath);
    AnchorStateManager.reconcile(absolutePath, newContent.split('\n'));

    const lines = newContent.split('\n');
    const newStringLinesCount = new_string.split('\n').length;
    const index = newContent.indexOf(new_string);
    const lineNum = newContent.substring(0, index).split('\n').length;

    const startLine = Math.max(0, lineNum - 3);
    const endLine = Math.min(lines.length, lineNum + newStringLinesCount + 2);

    const hashedContent = hashLines(absolutePath, newContent);
    const hashedLines = hashedContent.split('\n');
    const snippet = hashedLines.slice(startLine, endLine).join('\n') + '\n';

    const shortFileName = file_path.split('/').pop();

    return {
      success: true,
      llmOutput: `SUCCESS: File updated. Context around changes (with anchors):\n${snippet}`,
      userOutput: `📝 *File modified*: \`${shortFileName}\`\n~ Replacement successfully performed ~`,
    };
  } catch (error: unknown) {
    return {
      success: false,
      message: `Error during file editing: ${extractErrorMessage(error)}`,
    };
  }
}
