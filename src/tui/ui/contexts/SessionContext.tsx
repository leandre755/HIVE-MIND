import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { randomUUID } from 'node:crypto';
import {
  uiTelemetryService,
  type ModelMetrics,
  type RoleMetrics,
  type SessionMetrics,
} from '../services/uiTelemetryService.js';

export enum ToolCallDecision {
  ACCEPT = 'accept',
  REJECT = 'reject',
  MODIFY = 'modify',
  AUTO_ACCEPT = 'auto_accept',
}

interface FilesMetrics {
  totalLinesAdded?: number;
  totalLinesRemoved?: number;
}

interface ToolCallsMetrics {
  totalCalls?: number;
  count?: number;
  totalSuccess?: number;
  success?: number;
  totalFail?: number;
  fail?: number;
}

function areFileMetricsEqual(filesA?: FilesMetrics, filesB?: FilesMetrics): boolean {
  if (filesA && filesB) {
    return (
      filesA.totalLinesAdded === filesB.totalLinesAdded &&
      filesA.totalLinesRemoved === filesB.totalLinesRemoved
    );
  }
  return Boolean(filesA) === Boolean(filesB);
}

function areToolMetricsEqual(toolsA?: ToolCallsMetrics, toolsB?: ToolCallsMetrics): boolean {
  if (toolsA && toolsB) {
    const callsA = toolsA.totalCalls ?? toolsA.count ?? 0;
    const callsB = toolsB.totalCalls ?? toolsB.count ?? 0;
    const successA = toolsA.totalSuccess ?? toolsA.success ?? 0;
    const successB = toolsB.totalSuccess ?? toolsB.success ?? 0;
    const failA = toolsA.totalFail ?? toolsA.fail ?? 0;
    const failB = toolsB.totalFail ?? toolsB.fail ?? 0;

    return callsA === callsB && successA === successB && failA === failB;
  }
  return Boolean(toolsA) === Boolean(toolsB);
}

function areMetricsEqual(a: SessionMetrics, b: SessionMetrics): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  try {
    const recA = a as unknown as Record<string, unknown>;
    const recB = b as unknown as Record<string, unknown>;

    if (
      recA.totalTokens !== recB.totalTokens ||
      recA.inputTokens !== recB.inputTokens ||
      recA.outputTokens !== recB.outputTokens
    ) {
      return false;
    }

    if (
      !areFileMetricsEqual(
        recA.files as FilesMetrics | undefined,
        recB.files as FilesMetrics | undefined,
      )
    ) {
      return false;
    }

    const toolsA = (recA.tools || recA.toolCalls) as ToolCallsMetrics | undefined;
    const toolsB = (recB.tools || recB.toolCalls) as ToolCallsMetrics | undefined;
    if (!areToolMetricsEqual(toolsA, toolsB)) {
      return false;
    }

    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

export type { SessionMetrics, ModelMetrics, RoleMetrics };

export interface SessionStatsState {
  sessionId: string;
  sessionStartTime: Date;
  metrics: SessionMetrics;
  lastPromptTokenCount: number;
  promptCount: number;
}

export interface ComputedSessionStats {
  totalApiTime: number;
  totalToolTime: number;
  agentActiveTime: number;
  apiTimePercent: number;
  toolTimePercent: number;
  cacheEfficiency: number;
  totalDecisions: number;
  successRate: number;
  agreementRate: number;
}

export interface SessionStatsContextValue {
  stats: SessionStatsState;
  startNewPrompt: () => void;
  getPromptCount: () => number;
}

// --- Context Definition ---

const SessionStatsContext = createContext<SessionStatsContextValue | undefined>(undefined);

// --- Provider Component ---

export const SessionStatsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [stats, setStats] = useState<SessionStatsState>(() => ({
    sessionId: `session_${randomUUID()}`,
    sessionStartTime: new Date(),
    metrics: uiTelemetryService.getMetrics(),
    lastPromptTokenCount: uiTelemetryService.getLastPromptTokenCount(),
    promptCount: 0,
  }));

  useEffect(() => {
    const handleUpdate = ({
      metrics,
      lastPromptTokenCount,
    }: {
      metrics: SessionMetrics;
      lastPromptTokenCount: number;
    }) => {
      setStats((prevState) => {
        if (
          areMetricsEqual(prevState.metrics, metrics) &&
          prevState.lastPromptTokenCount === lastPromptTokenCount
        ) {
          return prevState;
        }
        return {
          ...prevState,
          metrics,
          lastPromptTokenCount,
        };
      });
    };

    const handleClear = (newSessionId?: string) => {
      setStats((prevState) => ({
        ...prevState,
        sessionId: newSessionId || prevState.sessionId,
        sessionStartTime: new Date(),
        promptCount: 0,
      }));
    };

    const telemetryEmitter = uiTelemetryService as unknown as {
      on: (event: string, listener: (...args: unknown[]) => void) => void;
      off: (event: string, listener: (...args: unknown[]) => void) => void;
    };

    telemetryEmitter.on('update', handleUpdate as (...args: unknown[]) => void);
    uiTelemetryService.on('clear', handleClear);
    // Set initial state
    handleUpdate({
      metrics: uiTelemetryService.getMetrics(),
      lastPromptTokenCount: uiTelemetryService.getLastPromptTokenCount(),
    });

    return () => {
      telemetryEmitter.off('update', handleUpdate as (...args: unknown[]) => void);
      uiTelemetryService.off('clear', handleClear);
    };
  }, []);

  const startNewPrompt = useCallback(() => {
    setStats((prevState) => ({
      ...prevState,
      promptCount: prevState.promptCount + 1,
    }));
  }, []);

  const getPromptCount = useCallback(() => stats.promptCount, [stats.promptCount]);

  const value = useMemo(
    () => ({
      stats,
      startNewPrompt,
      getPromptCount,
    }),
    [stats, startNewPrompt, getPromptCount],
  );

  return <SessionStatsContext.Provider value={value}>{children}</SessionStatsContext.Provider>;
};

// --- Consumer Hook ---

export const useSessionStats = () => {
  const context = useContext(SessionStatsContext);
  if (context === undefined) {
    throw new Error('useSessionStats must be used within a SessionStatsProvider');
  }
  return context;
};
