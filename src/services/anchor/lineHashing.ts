// services/anchor/lineHashing.ts
// ============================================================================
// LINE-HASH PROTOCOL — Shared utilities for the Dirac-inspired anchor system
// WHY: Hash-anchored edits replace fragile line numbers with stable word-based
// anchors, enabling 100% precision on code edits even after file mutations.
// ============================================================================

/**
 * The single character used to separate anchor words from line content.
 * WHY: § is a visually distinct, rarely-used-in-code character that won't
 * collide with any programming language syntax.
 */
export const ANCHOR_DELIMITER = '§';

/**
 * Returns the centralized delimiter for anchor↔content separation.
 */
export function getDelimiter(): string {
  return ANCHOR_DELIMITER;
}

/**
 * Generates a 32-bit FNV-1a hash for the given content string.
 * WHY: FNV-1a is extremely fast (no crypto overhead) and provides
 * excellent distribution for change-detection purposes.
 *
 * @param content - The text content to hash
 * @returns An 8-character hex string representing the hash
 */
export function contentHash(content: string): string {
  let h = 2166136261; // FNV-1a offset basis
  for (let i = 0; i < content.length; i++) {
    h = Math.imul(h ^ content.charCodeAt(i), 16777619); // FNV-1a prime
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Formats a single line with its anchor prefix.
 * Output format: `AnchorWord§line_content`
 *
 * @param content - The raw text content of the line
 * @param anchor  - The assigned anchor word for this line
 * @returns The formatted anchor+delimiter+content string
 */
export function formatLineWithHash(content: string, anchor: string): string {
  return `${anchor}${ANCHOR_DELIMITER}${content}`;
}

/**
 * Strips all hash-anchor prefixes from a content string.
 * WHY: When applying edits, we need the clean content without anchors.
 * Anchors are guaranteed to start with a capital letter (word boundary).
 *
 * @param content - Content with hashed lines
 * @returns Clean content without any anchor prefixes
 */
export function stripHashes(content: string): string {
  if (!content) return '';
  // Matches: word starting with capital letter, immediately followed by §
  const delimiterRegex = /\b[A-Z][a-zA-Z]*?§/g;
  return content.replace(delimiterRegex, '');
}

/**
 * Extracts the anchor ID from a line reference.
 * Handles both "AnchorWord" and "AnchorWord§content" formats.
 *
 * @param ref - The line reference string (from LLM tool call)
 * @returns The extracted anchor ID (word only, no delimiter)
 */
export function extractId(ref: string): string {
  if (!ref) return '';
  const delimiterIndex = ref.indexOf(ANCHOR_DELIMITER);
  return delimiterIndex === -1 ? ref.trim() : ref.substring(0, delimiterIndex).trim();
}

/**
 * Splits a raw anchor reference into its constituent parts.
 *
 * @param rawAnchor - Full anchor string (e.g., "AppleBanana§    def process(data):")
 * @returns Object with separated `anchor` word and `content` parts
 */
export function splitAnchor(rawAnchor: string): { anchor: string; content: string } {
  const delimiterIndex = rawAnchor.indexOf(ANCHOR_DELIMITER);
  if (delimiterIndex === -1) {
    return { anchor: rawAnchor.trim(), content: '' };
  }
  return {
    anchor: rawAnchor.substring(0, delimiterIndex).trim(),
    content: rawAnchor.substring(delimiterIndex + ANCHOR_DELIMITER.length),
  };
}
