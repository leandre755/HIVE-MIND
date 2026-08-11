import type {
  SessionMetrics,
  ComputedSessionStats,
  ModelMetrics,
} from '../contexts/SessionContext.js';

export function calculateErrorRate(metrics: ModelMetrics): number {
  if (metrics.api.totalRequests === 0) {
    return 0;
  }
  return (metrics.api.totalErrors / metrics.api.totalRequests) * 100;
}

export function calculateAverageLatency(metrics: ModelMetrics): number {
  if (metrics.api.totalRequests === 0) {
    return 0;
  }
  return metrics.api.totalLatencyMs / metrics.api.totalRequests;
}

export function calculateCacheHitRate(metrics: ModelMetrics): number {
  if (metrics.tokens.prompt === 0) {
    return 0;
  }
  return (metrics.tokens.cached / metrics.tokens.prompt) * 100;
}

export const computeSessionStats = (metrics: SessionMetrics): ComputedSessionStats => {
  const { models, tools } = metrics;
  const totalApiTime = models.reduce((acc, model) => acc + (model.tokens?.input ?? 0), 0);
  const totalToolTime = tools?.totalDurationMs ?? 0;
  const agentActiveTime = totalApiTime + totalToolTime;
  const apiTimePercent = agentActiveTime > 0 ? (totalApiTime / agentActiveTime) * 100 : 0;
  const toolTimePercent = agentActiveTime > 0 ? (totalToolTime / agentActiveTime) * 100 : 0;

  const totalCachedTokens = 0;
  const totalPromptTokens = models.reduce((acc, model) => acc + (model.tokens?.prompt ?? 0), 0);
  const cacheEfficiency = totalPromptTokens > 0 ? (totalCachedTokens / totalPromptTokens) * 100 : 0;

  const decisions = tools?.totalDecisions;
  const accept = decisions?.accept ?? 0;
  const reject = decisions?.reject ?? 0;
  const modify = decisions?.modify ?? 0;
  const totalDecisions = accept + reject + modify;
  const totalCalls = tools?.totalCalls ?? 0;
  const totalSuccess = tools?.totalSuccess ?? 0;
  const successRate = totalCalls > 0 ? (totalSuccess / totalCalls) * 100 : 0;
  const agreementRate = totalDecisions > 0 ? (accept / totalDecisions) * 100 : 0;

  return {
    totalApiTime,
    totalToolTime,
    agentActiveTime,
    apiTimePercent,
    toolTimePercent,
    cacheEfficiency,
    totalDecisions,
    successRate,
    agreementRate,
  };
};
