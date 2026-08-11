export interface HeadlessModeOptions {
  isHeadless?: boolean;
}

export enum TrustLevel {
  TRUST_FOLDER = 'trust_folder',
  TRUST_PARENT = 'trust_parent',
  DO_NOT_TRUST = 'do_not_trust',
}

export function isTrustLevel(value: unknown): value is TrustLevel {
  return typeof value === 'string' && Object.values(TrustLevel).includes(value as TrustLevel);
}

export function resetTrustedFoldersForTesting(): void {
  // mock no-op
}

export async function saveTrustedFolders(_folders: unknown): Promise<void> {
  // mock no-op
}

export interface TrustRule {
  path: string;
  level: TrustLevel;
}

export interface TrustedFoldersError extends Error {
  code: string;
}

export interface TrustedFoldersFile {
  folders: TrustRule[];
}

export interface TrustResult {
  isTrusted: boolean;
  reason?: string;
}

export interface LoadedTrustedFolders {
  folders: TrustRule[];
}

export interface TrustedFolderSettings {
  security?: {
    folderTrust?: {
      enabled?: boolean;
    };
  };
}

/** Is folder trust feature enabled per the current applied settings */
export function isFolderTrustEnabled(settings: TrustedFolderSettings): boolean {
  const folderTrustSetting = settings.security?.folderTrust?.enabled ?? true;
  return folderTrustSetting;
}

export function loadTrustedFolders(): LoadedTrustedFolders {
  return { folders: [] };
}

/**
 * Returns true or false if the workspace is considered "trusted".
 */
export function isWorkspaceTrusted(
  _settings: TrustedFolderSettings,
  _workspaceDir: string = process.cwd(),
  _headlessOptions?: HeadlessModeOptions,
): {
  isTrusted: boolean | undefined;
  source: 'ide' | 'file' | 'env' | undefined;
} {
  return {
    isTrusted: true,
    source: 'env',
  };
}
