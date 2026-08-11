import * as path from 'node:path';
import { safeExistsSync, safeReadFileSync } from '../../utils/safeFs.js';

export interface HiveMdFile {
  path: string;
  relativePath: string;
  content: string;
  depth: number; // 0 = root workspace, 1 = sous-dossier, etc.
}

/**
 * Scans directories from the current directory up to the workspace root looking for hive.md files.
 * @param workspaceRoot Absolute path to the workspace root directory.
 * @param currentDir Absolute path to the directory currently being inspected (defaults to process.cwd()).
 */
export function findHiveMdFilesSync(
  workspaceRoot: string,
  currentDir: string = process.cwd(),
): HiveMdFile[] {
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
    throw new Error('workspaceRoot must be a non-empty absolute path');
  }
  if (!currentDir || !path.isAbsolute(currentDir)) {
    throw new Error('currentDir must be a non-empty absolute path');
  }

  const files: HiveMdFile[] = [];
  const dir = path.resolve(currentDir);
  const root = path.resolve(workspaceRoot);

  // Si currentDir n'est pas dans le workspaceRoot, on se limite à currentDir
  const isUnderRoot = dir.startsWith(root);

  const pathsToSearch: string[] = [];
  let current = dir;

  let reachedRoot = false;
  while (!reachedRoot) {
    pathsToSearch.push(current);
    if (current === root || !isUnderRoot || current === path.dirname(current)) {
      reachedRoot = true;
    } else {
      current = path.dirname(current);
    }
  }

  // On inverse pour aller du plus général (root) au plus spécifique (currentDir)
  pathsToSearch.reverse();

  pathsToSearch.forEach((searchPath, i) => {
    const filePath = path.join(searchPath, 'hive.md');
    if (safeExistsSync(filePath)) {
      try {
        const content = safeReadFileSync(filePath);
        const relativePath = path.relative(root, filePath);
        files.push({
          path: filePath,
          relativePath,
          content,
          depth: i,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn('[hive.md] Failed to read %s:', filePath, message);
      }
    }
  });

  return files;
}

/**
 * Counts the active hive.md files.
 */
export function countHiveMdFilesSync(
  workspaceRoot: string,
  currentDir: string = process.cwd(),
): number {
  if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
    throw new Error('workspaceRoot must be a non-empty absolute path');
  }
  const files = findHiveMdFilesSync(workspaceRoot, currentDir);
  return files.length;
}

/**
 * Merges the contents of multiple hive.md files from general to specific.
 */
export function buildHiveMdContext(files: HiveMdFile[]): string {
  if (!Array.isArray(files)) {
    throw new Error('files must be an array');
  }
  if (files.length === 0) {
    return '';
  }

  return files
    .map(
      (file) => `--- File: ${file.relativePath} (Depth: ${file.depth}) ---\n${file.content.trim()}`,
    )
    .join('\n\n');
}
export default findHiveMdFilesSync;
