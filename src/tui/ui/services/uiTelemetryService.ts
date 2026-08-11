export interface ToolCallStats {
  count: number;
  success: number;
  fail: number;
  durationMs: number;
  decisions: Partial<Record<string, number>>;
  totalCalls: number;
  totalSuccess: number;
  totalFail: number;
  totalDurationMs: number;
}

export interface ModelMetrics {
  api: {
    totalRequests: number;
    totalErrors: number;
    totalLatencyMs: number;
  };
  tokens: {
    input: number;
    prompt: number;
    candidates: number;
    total: number;
    cached: number;
    thoughts: number;
    tool: number;
  };
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheReadTokens: number;
  roles?: Record<string, RoleMetrics>;
  cacheWriteTokens: number;
}

export interface RoleMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalRequests: number;
  model: string;
  tokens?: {
    input: number;
    output: number;
    candidates?: number;
    cached?: number;
    prompt?: number;
  };
}

export interface SessionMetrics {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  models: RoleMetrics[];
  toolCalls: ToolCallStats;
  duration: number;
  api: ModelMetrics['api'];
  tokens: ModelMetrics['tokens'];
  tools?: {
    byName: Record<
      string,
      ToolCallStats & { decisions: { accept: number; reject: number; modify: number } }
    >;
    totalDecisions?: { accept: number; reject: number; modify: number };
    totalCalls?: number;
    totalSuccess?: number;
    totalFail?: number;
    totalDurationMs?: number;
  };
  files?: {
    totalLinesAdded: number;
    totalLinesRemoved: number;
  };
}

type TelemetryListener = () => void;

export const uiTelemetryService = {
  track: (_event: string, _data?: Record<string, unknown>): void => {},
  getMetrics: (): SessionMetrics => ({
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    models: [],
    toolCalls: {
      count: 0,
      success: 0,
      fail: 0,
      durationMs: 0,
      decisions: {},
      totalCalls: 0,
      totalSuccess: 0,
      totalFail: 0,
      totalDurationMs: 0,
    },
    duration: 0,
    api: { totalRequests: 0, totalErrors: 0, totalLatencyMs: 0 },
    tokens: { input: 0, prompt: 0, candidates: 0, total: 0, cached: 0, thoughts: 0, tool: 0 },
  }),
  getLastPromptTokenCount: (): number => 0,
  _listeners: new Map<string, Set<TelemetryListener>>(),
  on: (event: string, listener: TelemetryListener): void => {
    let set = uiTelemetryService._listeners.get(event);
    if (!set) {
      set = new Set();
      uiTelemetryService._listeners.set(event, set);
    }
    set.add(listener);
  },
  off: (event: string, listener: TelemetryListener): void => {
    uiTelemetryService._listeners.get(event)?.delete(listener);
  },
  reset: (): void => {},
  clear(_newSessionId?: string): void {
    const listeners = uiTelemetryService._listeners.get('clear');
    if (listeners) {
      for (const listener of listeners) {
        listener();
      }
    }
  },
  hydrate(_conversation: unknown): void {
    const listeners = uiTelemetryService._listeners.get('update');
    if (listeners) {
      for (const listener of listeners) {
        listener();
      }
    }
  },
};
