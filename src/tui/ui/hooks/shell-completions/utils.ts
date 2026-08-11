const UNIX_SHELL_SPECIAL_CHARS = /[ \t\n\r'"()&|;<>!#$`{}[\]*?\\]/g;

/**
 * Escapes special shell characters in a path segment.
 */
export function escapeShellPath(segment: string): string {
  if (process.platform === 'win32') {
    return segment;
  }
  return segment.replace(UNIX_SHELL_SPECIAL_CHARS, '\\$&');
}
