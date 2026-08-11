import * as Diff from 'diff';
import { safeReadFile, safeWriteFile, safeUnlink } from '../../../utils/safeFs.js';
import { coreEvents } from '../../utils/coreEvents.js';
import { debugLogger } from '../../utils/errors.js';
import { ConversationRecord, MessageRecord } from '../../utils/sessionUtils.js';

export interface FileChangeDetail {
  fileName: string;
  diff: string;
}

export interface FileChangeStats {
  addedLines: number;
  removedLines: number;
  fileCount: number;
  details?: FileChangeDetail[];
}

function processToolCallsForStats(
  toolCalls: Array<{ resultDisplay?: string }>,
  files: Set<string>,
  details?: FileChangeDetail[],
): { addedLines: number; removedLines: number; hasEdits: boolean } {
  let addedLines = 0;
  let removedLines = 0;
  let hasEdits = false;
  for (const toolCall of toolCalls) {
    const fileDiff = getFileDiffFromResultDisplay(toolCall.resultDisplay);
    if (fileDiff) {
      hasEdits = true;
      const stats = fileDiff.diffStat;
      const calculations = computeModelAddedAndRemovedLines(stats);
      addedLines += calculations.addedLines;
      removedLines += calculations.removedLines;
      files.add(fileDiff.fileName);
      if (details) {
        details.push({
          fileName: fileDiff.fileName,
          diff: fileDiff.fileDiff,
        });
      }
    }
  }
  return { addedLines, removedLines, hasEdits };
}

export function calculateTurnStats(
  conversation: ConversationRecord,
  userMessage: MessageRecord,
): FileChangeStats | null {
  const msgIndex = conversation.messages.indexOf(userMessage);
  if (msgIndex === -1) return null;

  let addedLines = 0;
  let removedLines = 0;
  const files = new Set<string>();
  let hasEdits = false;

  for (let i = msgIndex + 1; i < conversation.messages.length; i++) {
    const msg = conversation.messages.at(i);
    if (!msg) continue;
    if (msg.type === 'user') break;

    if (msg.type === 'gemini' && msg.toolCalls) {
      const res = processToolCallsForStats(msg.toolCalls, files);
      if (res.hasEdits) {
        hasEdits = true;
        addedLines += res.addedLines;
        removedLines += res.removedLines;
      }
    }
  }

  if (!hasEdits) return null;

  return {
    addedLines,
    removedLines,
    fileCount: files.size,
  };
}

export function calculateRewindImpact(
  conversation: ConversationRecord,
  userMessage: MessageRecord,
): FileChangeStats | null {
  const msgIndex = conversation.messages.indexOf(userMessage);
  if (msgIndex === -1) return null;

  let addedLines = 0;
  let removedLines = 0;
  const files = new Set<string>();
  const details: FileChangeDetail[] = [];
  let hasEdits = false;

  for (let i = msgIndex + 1; i < conversation.messages.length; i++) {
    const msg = conversation.messages.at(i);
    if (!msg) continue;

    if (msg.type === 'gemini' && msg.toolCalls) {
      const res = processToolCallsForStats(msg.toolCalls, files, details);
      if (res.hasEdits) {
        hasEdits = true;
        addedLines += res.addedLines;
        removedLines += res.removedLines;
      }
    }
  }

  if (!hasEdits) return null;

  return {
    addedLines,
    removedLines,
    fileCount: files.size,
    details,
  };
}

async function applyPatchRevert(
  currentContent: string,
  newContent: string,
  originalContent: string | undefined,
  isNewFile: boolean,
  filePath: string,
  fileName: string,
): Promise<void> {
  const originalText = originalContent ?? '';
  const undoPatch = Diff.createPatch(fileName, newContent, originalText);
  const patchedContent = Diff.applyPatch(currentContent, undoPatch);
  if (typeof patchedContent === 'string') {
    if (patchedContent === '' && isNewFile) {
      await safeUnlink(filePath);
    } else {
      await safeWriteFile(filePath, patchedContent);
    }
  } else {
    coreEvents.emitFeedback(
      'warning',
      `Smart revert for ${fileName} failed. The file may have been modified in a way that conflicts with the undo operation.`,
    );
  }
}

async function revertSingleToolCall(toolCall: { resultDisplay?: string }): Promise<void> {
  const fileDiff = getFileDiffFromResultDisplay(toolCall.resultDisplay);
  if (!fileDiff) return;

  const { filePath, fileName, newContent, originalContent, isNewFile } = fileDiff;
  try {
    let currentContent: string | null = null;
    try {
      currentContent = await safeReadFile(filePath, 'utf-8');
    } catch (e) {
      const error = e as Error;
      if ('code' in error && error.code === 'ENOENT') {
        debugLogger.debug(
          `File ${fileName} not found during revert, proceeding as it may be a new file deletion.`,
        );
      } else {
        coreEvents.emitFeedback(
          'error',
          `Error reading ${fileName} during revert: ${error.message}`,
          e,
        );
        return;
      }
    }
    if (currentContent === newContent) {
      if (!isNewFile) {
        await safeWriteFile(filePath, originalContent ?? '');
      } else {
        await safeUnlink(filePath);
      }
    } else if (currentContent !== null) {
      await applyPatchRevert(
        currentContent,
        newContent,
        originalContent,
        Boolean(isNewFile),
        filePath,
        fileName,
      );
    } else {
      coreEvents.emitFeedback(
        'warning',
        `Cannot revert changes for ${fileName} because it was not found on disk. This is expected if a file created by the agent was deleted before rewind`,
      );
    }
  } catch (e) {
    coreEvents.emitFeedback(
      'error',
      `An unexpected error occurred while reverting ${fileName}.`,
      e,
    );
  }
}

export async function revertFileChanges(
  conversation: ConversationRecord,
  targetMessageId: string,
): Promise<void> {
  const messageIndex = conversation.messages.findIndex((m) => m.id === targetMessageId);

  if (messageIndex === -1) {
    debugLogger.error('Requested message to rewind to was not found ');
    return;
  }

  for (let i = conversation.messages.length - 1; i > messageIndex; i--) {
    const msg = conversation.messages.at(i);
    if (msg?.type === 'gemini' && msg.toolCalls) {
      for (let j = msg.toolCalls.length - 1; j >= 0; j--) {
        const toolCall = msg.toolCalls.at(j);
        if (toolCall) {
          await revertSingleToolCall(toolCall);
        }
      }
    }
  }
}
