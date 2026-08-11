import { useState, useEffect, useCallback, useRef } from 'react';
import { spawnAsync, getAbsoluteGitDir } from '../contexts/UIStateContext.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';

import { safePath } from '../../../utils/safeFs.js';

type SpawnAsyncFn = (
  cmd: string,
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: Buffer | string }>;

const safeWatch = (pathStr: string, listener: fs.WatchListener<string>) => {
  const watchFn = (fs as Record<string, unknown>)['watch'] as typeof fs.watch;
  return watchFn(safePath(pathStr), listener);
};

export function useGitBranchName(cwd: string): string | undefined {
  const [branchName, setBranchName] = useState<string | undefined>(undefined);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchBranchName = useCallback(async () => {
    try {
      const spawn = spawnAsync as unknown as SpawnAsyncFn;
      const { stdout } = await spawn('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd });
      const branch = stdout.toString().trim();
      if (branch && branch !== 'HEAD') {
        setBranchName(branch);
      } else {
        const { stdout: hashStdout } = await spawn('git', ['rev-parse', '--short', 'HEAD'], {
          cwd,
        });
        setBranchName(hashStdout.toString().trim());
      }
    } catch {
      setBranchName(undefined);
    }
  }, [cwd, setBranchName]);

  useEffect(() => {
    void fetchBranchName(); // Initial fetch

    let watcher: fs.FSWatcher | undefined;
    let cancelled = false;

    const handleWatchEvent = (_eventType: string, filename: string | null) => {
      // Changes to HEAD indicate branch checkout or detached commit.
      // On some platforms filename may be null, so we refresh in that case too.
      if (!filename || filename === 'HEAD') {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        timeoutRef.current = setTimeout(() => {
          void fetchBranchName();
        }, 100);
      }
    };

    const setupWatcher = async () => {
      try {
        const gitDir = await getAbsoluteGitDir(cwd);
        if (!gitDir) return;

        // Ensure we can access the git dir
        await fsPromises.access(gitDir, fs.constants.F_OK);
        if (cancelled) return;

        const w = safeWatch(gitDir, handleWatchEvent);

        if (cancelled) {
          w.close();
        } else {
          watcher = w;
        }
      } catch {
        // Silently ignore watcher errors (e.g. permissions or file not existing),
        // similar to how exec errors are handled.
        // The branch name will simply not update automatically.
      }
    };

    void setupWatcher();

    return () => {
      cancelled = true;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      watcher?.close();
    };
  }, [cwd, fetchBranchName]);

  return branchName;
}
