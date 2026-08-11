import { useState, useEffect, useRef, useCallback } from 'react';
import * as path from 'node:path';
import { debugLogger } from '../../utils/errors.js';
import { safeReadFile, safeWriteFile, safeMkdir } from '../../../utils/safeFs.js';
import { isNodeError, Storage } from '../contexts/UIStateContext.js';

const MAX_HISTORY_LENGTH = 100;

export interface UseShellHistoryReturn {
  history: string[];
  addCommandToHistory: (command: string) => void;
  getPreviousCommand: () => string | null;
  getNextCommand: () => string | null;
  resetHistoryPosition: () => void;
}

async function getHistoryFilePath(projectRoot: string, configStorage?: Storage): Promise<string> {
  const storage = configStorage ?? new Storage(projectRoot);
  await storage.initialize();
  return storage.getHistoryFilePath();
}

function countTrailingBackslashes(str: string): number {
  let count = 0;
  for (let i = str.length - 1; i >= 0; i--) {
    if (str.charAt(i) === '\\') {
      count++;
    } else {
      break;
    }
  }
  return count;
}

function processHistoryLines(text: string): string[] {
  const result: string[] = [];
  let cur = '';

  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;

    if (countTrailingBackslashes(cur) % 2 === 1) {
      cur = cur.slice(0, -1) + ' ' + raw;
    } else {
      if (cur) result.push(cur);
      cur = raw;
    }
  }

  if (cur) result.push(cur);
  return result;
}

// Handle multiline commands
async function readHistoryFile(filePath: string): Promise<string[]> {
  try {
    const text = await safeReadFile(filePath, 'utf-8');
    return processHistoryLines(text);
  } catch (err) {
    if (isNodeError(err) && err.code === 'ENOENT') return [];
    debugLogger.error('Error reading history:', err);
    return [];
  }
}

async function writeHistoryFile(filePath: string, history: string[]): Promise<void> {
  try {
    await safeMkdir(path.dirname(filePath), { recursive: true });
    await safeWriteFile(filePath, history.join('\n'));
  } catch (error) {
    debugLogger.error('Error writing shell history:', error);
  }
}

export function useShellHistory(projectRoot: string, storage?: Storage): UseShellHistoryReturn {
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [historyFilePath, setHistoryFilePath] = useState<string | null>(null);

  const storageRef = useRef(storage);
  storageRef.current = storage;

  useEffect(() => {
    async function loadHistory() {
      const filePath = await getHistoryFilePath(projectRoot, storageRef.current);
      setHistoryFilePath(filePath);
      const loadedHistory = await readHistoryFile(filePath);
      setHistory(loadedHistory.reverse()); // Newest first
    }

    loadHistory();
  }, [projectRoot]);

  const addCommandToHistory = useCallback(
    (command: string) => {
      if (!command.trim() || !historyFilePath) {
        return;
      }
      const newHistory = [command, ...history.filter((c) => c !== command)]
        .slice(0, MAX_HISTORY_LENGTH)
        .filter(Boolean);
      setHistory(newHistory);
      // Write to file in reverse order (oldest first)

      writeHistoryFile(historyFilePath, [...newHistory].reverse());
      setHistoryIndex(-1);
    },
    [history, historyFilePath],
  );

  const getPreviousCommand = useCallback(() => {
    if (history.length === 0) {
      return null;
    }
    const newIndex = Math.min(historyIndex + 1, history.length - 1);
    setHistoryIndex(newIndex);
    return history.at(newIndex) ?? null;
  }, [history, historyIndex]);

  const getNextCommand = useCallback(() => {
    if (historyIndex < 0) {
      return null;
    }
    const newIndex = historyIndex - 1;
    setHistoryIndex(newIndex);
    if (newIndex < 0) {
      return '';
    }
    return history.at(newIndex) ?? null;
  }, [history, historyIndex]);

  const resetHistoryPosition = useCallback(() => {
    setHistoryIndex(-1);
  }, []);

  return {
    history,
    addCommandToHistory,
    getPreviousCommand,
    getNextCommand,
    resetHistoryPosition,
  };
}
