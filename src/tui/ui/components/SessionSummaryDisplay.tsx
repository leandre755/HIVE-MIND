/**
 * @license
 * Copyright 2025 HIVE-MIND
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { StatsDisplay } from './StatsDisplay.js';
import { useSessionStats } from '../contexts/SessionContext.js';
import { useConfig } from '../contexts/ConfigContext.js';
import { escapeShellArg } from '../utils/formatters.js';
import { isWindows } from '../contexts/UIStateContext.js';

interface SessionSummaryDisplayProps {
  duration: string;
}

export const SessionSummaryDisplay: React.FC<SessionSummaryDisplayProps> = ({ duration }) => {
  const { stats } = useSessionStats();
  const config = useConfig();
  const shell: string = isWindows ? 'powershell' : 'bash';

  const worktreeSettings = config.getWorktreeSettings() as Record<string, unknown>;

  const escapedSessionId = escapeShellArg(stats.sessionId, shell);
  const footerSessionId =
    isWindows && !escapedSessionId.startsWith('"') && !escapedSessionId.startsWith("'")
      ? `"${escapedSessionId}"`
      : escapedSessionId;
  let footer = `To resume this session: npm run tui -- --resume ${footerSessionId}`;

  if (worktreeSettings) {
    const worktreePath = String(Reflect.get(worktreeSettings, 'path') ?? '');
    footer =
      `To resume work in this worktree: cd ${escapeShellArg(worktreePath, shell)} && npm run tui -- --resume ${footerSessionId}\n` +
      `To remove manually: git worktree remove ${escapeShellArg(worktreePath, shell)}`;
  }

  return <StatsDisplay title="Agent powering down. Goodbye!" duration={duration} footer={footer} />;
};
