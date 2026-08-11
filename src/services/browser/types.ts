export interface BrowserResult {
  success: boolean;
  data?: unknown;
  error?: string;
  warning?: string; // Dialog alerts, etc.
}

export interface SnapshotResult extends BrowserResult {
  snapshot: string; // Accessibility tree text
  refs: Record<string, RefInfo>; // @e1 → { role, name }
}

export interface ScreenshotResult extends BrowserResult {
  filePath: string; // Absolute path to the screenshot
  annotatedRefs?: Array<{ ref: string; role: string; name: string }>;
}

export interface RefInfo {
  role: string;
  name: string;
}

export interface BrowserExecOptions {
  session?: string;
  timeout?: number;
  blockedDomains?: string[];
}
