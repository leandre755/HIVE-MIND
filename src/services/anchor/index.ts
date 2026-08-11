// services/anchor/index.ts
// ============================================================================
// ANCHOR SERVICE — Barrel export for the Dirac-inspired hash-anchored edit system
// ============================================================================

export { AnchorStateManager } from './AnchorStateManager.js';
export {
  ANCHOR_DELIMITER,
  getDelimiter,
  contentHash,
  formatLineWithHash,
  stripHashes,
  extractId,
  splitAnchor,
} from './lineHashing.js';
export { ANCHOR_WORDS } from './hashDictionary.js';

import { AnchorStateManager } from './AnchorStateManager.js';
import { formatLineWithHash } from './lineHashing.js';

/**
 * Convenience function: hashes all lines of a file content string.
 * Returns content with each line prefixed by its stateful anchor.
 *
 * @param absolutePath - Absolute path of the file being hashed
 * @param content      - Full text content
 * @param taskId       - Optional task scoping for anchor isolation
 * @returns Content with each line as "AnchorWord§original_line"
 */
export function hashLines(absolutePath: string, content: string, taskId?: string): string {
  if (!content) return '';

  const lines = content.split(/\r?\n/);
  const anchors = AnchorStateManager.reconcile(absolutePath, lines, taskId);

  return lines.map((line, index) => formatLineWithHash(line, anchors.at(index) ?? '')).join('\n');
}
