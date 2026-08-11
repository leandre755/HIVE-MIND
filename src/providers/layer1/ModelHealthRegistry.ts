/**
 * Layer 1 Model Health Registry
 *
 * Implements a circular bucket algorithm (6 buckets of 10s over a 60s window).
 * Manages model & family health circuit breaker states with single-flight HALF_OPEN probes
 * and family escalation upon multiple failures.
 */

import { NetworkError, ServerError } from '../layer0/errors.js';
import { ModelRegistry } from '../layer0/ModelRegistry.js';

export const WINDOW_MS = 60000;
export const BUCKET_COUNT = 6;
export const BUCKET_SIZE_MS = 10000;
export const FAILURE_RATIO_THRESHOLD = 0.5;
// 3 requests minimum before circuit breaker opens (down from 10 for faster cold-start failover)
export const MINIMUM_THROUGHPUT = 3;
export const COOLDOWN_STEPS_MS = [30000, 120000, 600000] as const;

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface HealthBucket {
  timestamp: number;
  successes: number;
  failures: number;
  latencies: number[];
  serverOrNetworkFailedModels: Set<string>;
}

interface CircuitBreakerInfo {
  state: CircuitState;
  openedAt: number;
  cooldownStepIndex: number;
  probeInFlight: boolean;
}

function createEmptyBucket(timestamp: number): HealthBucket {
  return {
    timestamp,
    successes: 0,
    failures: 0,
    latencies: [],
    serverOrNetworkFailedModels: new Set<string>(),
  };
}

function isServerOrNetworkError(error: unknown): boolean {
  if (error instanceof ServerError || error instanceof NetworkError) return true;
  if (typeof error === 'object' && error !== null) {
    const status = Reflect.get(error, 'status');
    if (typeof status === 'number' && status >= 500) return true;
    const code = Reflect.get(error, 'code');
    if (code === 'SERVER_ERROR' || code === 'NETWORK_ERROR') return true;
  }
  return false;
}

export class ModelHealthRegistry {
  private static instance: ModelHealthRegistry | null = null;

  private bucketsMap: Map<string, HealthBucket[]> = new Map();
  private circuitMap: Map<string, CircuitBreakerInfo> = new Map();
  private modelToFamilyMap: Map<string, string> = new Map();

  constructor() {
    this.initModelToFamilyMapping();
  }

  public static getInstance(): ModelHealthRegistry {
    if (!ModelHealthRegistry.instance) {
      ModelHealthRegistry.instance = new ModelHealthRegistry();
    }
    return ModelHealthRegistry.instance;
  }

  public static resetInstance(): void {
    ModelHealthRegistry.instance = null;
  }

  public initModelToFamilyMapping(): void {
    try {
      const registry = ModelRegistry.getInstance();
      for (const modelId of registry.listModels()) {
        const config = registry.getModelConfig(modelId);
        if (config?.provider) {
          this.modelToFamilyMap.set(modelId, config.provider);
        }
      }
    } catch {
      // Ignore if ModelRegistry is not pre-populated
    }
  }

  public setModelFamilyMapping(modelId: string, family: string): void {
    this.modelToFamilyMap.set(modelId, family);
  }

  public getFamilyForModel(modelId: string): string | undefined {
    if (this.modelToFamilyMap.has(modelId)) {
      return this.modelToFamilyMap.get(modelId);
    }
    try {
      const config = ModelRegistry.getInstance().getModelConfig(modelId);
      if (config?.provider) {
        this.modelToFamilyMap.set(modelId, config.provider);
        return config.provider;
      }
    } catch {
      // Ignore
    }
    return undefined;
  }

  private getValidBuckets(key: string, now: number = Date.now()): HealthBucket[] {
    let buckets = this.bucketsMap.get(key);
    if (!buckets) {
      buckets = Array.from({ length: BUCKET_COUNT }, () => createEmptyBucket(0));
      this.bucketsMap.set(key, buckets);
    }

    const cutoff = now - WINDOW_MS;
    for (let i = 0; i < BUCKET_COUNT; i++) {
      const current = buckets.at(i);
      if (current && current.timestamp <= cutoff) {
        buckets.splice(i, 1, createEmptyBucket(0));
      }
    }
    return buckets;
  }

  private getCurrentBucket(key: string, now: number = Date.now()): HealthBucket {
    const buckets = this.getValidBuckets(key, now);
    const bucketStartTime = Math.floor(now / BUCKET_SIZE_MS) * BUCKET_SIZE_MS;
    const bucketIndex = Math.floor(now / BUCKET_SIZE_MS) % BUCKET_COUNT;

    const current = buckets.at(bucketIndex);
    if (!current || current.timestamp !== bucketStartTime) {
      const fresh = createEmptyBucket(bucketStartTime);
      buckets.splice(bucketIndex, 1, fresh);
      return fresh;
    }
    return current;
  }

  private getCircuitInfo(key: string): CircuitBreakerInfo {
    let info = this.circuitMap.get(key);
    if (!info) {
      info = { state: 'CLOSED', openedAt: 0, cooldownStepIndex: 0, probeInFlight: false };
      this.circuitMap.set(key, info);
    }
    return info;
  }

  public recordSuccess(modelId: string, latencyMs: number, providerOrFamily?: string): void {
    const now = Date.now();
    if (providerOrFamily) {
      this.setModelFamilyMapping(modelId, providerOrFamily);
    }
    const family = providerOrFamily || this.getFamilyForModel(modelId);

    const modelBucket = this.getCurrentBucket(modelId, now);
    modelBucket.successes++;
    modelBucket.latencies.push(latencyMs);

    this.resetHalfOpenCircuit(modelId);

    if (family) {
      const familyBucket = this.getCurrentBucket(family, now);
      familyBucket.successes++;
      familyBucket.latencies.push(latencyMs);
      this.resetHalfOpenCircuit(family);
    }
  }

  private resetHalfOpenCircuit(key: string): void {
    const cb = this.getCircuitInfo(key);
    if (cb.state === 'HALF_OPEN') {
      cb.state = 'CLOSED';
      cb.cooldownStepIndex = 0;
      cb.probeInFlight = false;
    }
  }

  public recordFailure(modelId: string, error: unknown, providerOrFamily?: string): void {
    const now = Date.now();
    if (providerOrFamily) {
      this.setModelFamilyMapping(modelId, providerOrFamily);
    }
    const family = providerOrFamily || this.getFamilyForModel(modelId);

    this.handleModelFailure(modelId, now);

    if (family) {
      this.handleFamilyFailure(family, modelId, isServerOrNetworkError(error), now);
    }
  }

  private handleModelFailure(modelId: string, now: number): void {
    const modelBucket = this.getCurrentBucket(modelId, now);
    modelBucket.failures++;

    const cb = this.getCircuitInfo(modelId);
    if (cb.state === 'HALF_OPEN') {
      cb.cooldownStepIndex = Math.min(cb.cooldownStepIndex + 1, COOLDOWN_STEPS_MS.length - 1);
      cb.state = 'OPEN';
      cb.openedAt = now;
      cb.probeInFlight = false;
    } else if (cb.state === 'CLOSED') {
      this.evaluateModelCircuitOpening(modelId, cb, now);
    }
  }

  private evaluateModelCircuitOpening(modelId: string, cb: CircuitBreakerInfo, now: number): void {
    const validBuckets = this.getValidBuckets(modelId, now);
    let totalSuccesses = 0;
    let totalFailures = 0;
    for (const b of validBuckets) {
      totalSuccesses += b.successes;
      totalFailures += b.failures;
    }
    const throughput = totalSuccesses + totalFailures;
    const failRatio = throughput > 0 ? totalFailures / throughput : 0;

    if (throughput >= MINIMUM_THROUGHPUT && failRatio >= FAILURE_RATIO_THRESHOLD) {
      cb.state = 'OPEN';
      cb.openedAt = now;
      cb.cooldownStepIndex = 0;
    }
  }

  private handleFamilyFailure(
    family: string,
    modelId: string,
    isServerOrNetwork: boolean,
    now: number,
  ): void {
    const familyBucket = this.getCurrentBucket(family, now);
    familyBucket.failures++;

    if (isServerOrNetwork) {
      familyBucket.serverOrNetworkFailedModels.add(modelId);
    }

    const familyCb = this.getCircuitInfo(family);
    if (familyCb.state === 'HALF_OPEN') {
      familyCb.cooldownStepIndex = Math.min(
        familyCb.cooldownStepIndex + 1,
        COOLDOWN_STEPS_MS.length - 1,
      );
      familyCb.state = 'OPEN';
      familyCb.openedAt = now;
      familyCb.probeInFlight = false;
    } else if (familyCb.state === 'CLOSED' && isServerOrNetwork) {
      this.evaluateFamilyEscalation(family, familyCb, now);
    }
  }

  private evaluateFamilyEscalation(
    family: string,
    familyCb: CircuitBreakerInfo,
    now: number,
  ): void {
    const familyValidBuckets = this.getValidBuckets(family, now);
    const distinctFailedModels = new Set<string>();
    for (const b of familyValidBuckets) {
      for (const mId of b.serverOrNetworkFailedModels) {
        distinctFailedModels.add(mId);
      }
    }

    if (distinctFailedModels.size >= 2) {
      familyCb.state = 'OPEN';
      familyCb.openedAt = now;
      familyCb.cooldownStepIndex = 0;
    }
  }

  private isCircuitOpenSelf(key: string, now: number = Date.now()): boolean {
    const cb = this.getCircuitInfo(key);

    if (cb.state === 'CLOSED') return false;

    if (cb.state === 'OPEN') {
      const cooldownMs = COOLDOWN_STEPS_MS.at(cb.cooldownStepIndex) ?? 30000;
      return now - cb.openedAt < cooldownMs;
    }

    if (cb.state === 'HALF_OPEN') {
      return cb.probeInFlight;
    }

    return false;
  }

  public isCircuitOpen(modelIdOrFamily: string): boolean {
    const now = Date.now();
    const family = this.getFamilyForModel(modelIdOrFamily);

    if (family && family !== modelIdOrFamily && this.isCircuitOpenSelf(family, now)) {
      return true;
    }

    return this.isCircuitOpenSelf(modelIdOrFamily, now);
  }

  public tryAcquireHalfOpenProbe(modelIdOrFamily: string): boolean {
    const now = Date.now();
    const family = this.getFamilyForModel(modelIdOrFamily);
    const keys =
      family && family !== modelIdOrFamily ? [family, modelIdOrFamily] : [modelIdOrFamily];

    for (const key of keys) {
      const cb = this.getCircuitInfo(key);
      if (cb.state === 'OPEN') {
        const cooldownMs = COOLDOWN_STEPS_MS.at(cb.cooldownStepIndex) ?? 30000;
        if (now - cb.openedAt >= cooldownMs) {
          cb.state = 'HALF_OPEN';
          cb.probeInFlight = false;
        } else {
          return false;
        }
      }
      if (cb.state === 'HALF_OPEN' && cb.probeInFlight) {
        return false;
      }
    }

    for (const key of keys) {
      const cb = this.getCircuitInfo(key);
      if (cb.state === 'HALF_OPEN') {
        cb.probeInFlight = true;
      }
    }
    return true;
  }

  public releaseHalfOpenProbe(modelIdOrFamily: string): void {
    const family = this.getFamilyForModel(modelIdOrFamily);
    const keys =
      family && family !== modelIdOrFamily ? [family, modelIdOrFamily] : [modelIdOrFamily];

    for (const key of keys) {
      const cb = this.getCircuitInfo(key);
      if (cb.state === 'HALF_OPEN') {
        cb.probeInFlight = false;
      }
    }
  }

  public getModelStats(modelId: string): {
    failRatio: number;
    throughput: number;
    latencyP50Ms: number;
  } {
    const now = Date.now();
    const validBuckets = this.getValidBuckets(modelId, now);

    let successes = 0;
    let failures = 0;
    const latencies: number[] = [];

    for (const b of validBuckets) {
      successes += b.successes;
      failures += b.failures;
      for (const l of b.latencies) {
        latencies.push(l);
      }
    }

    const throughput = successes + failures;
    const failRatio = throughput > 0 ? failures / throughput : 0;

    let latencyP50Ms = 0;
    if (latencies.length > 0) {
      latencies.sort((a, b) => a - b);
      const mid = Math.floor(latencies.length / 2);
      latencyP50Ms = latencies.at(mid) ?? 0;
    }

    return { failRatio, throughput, latencyP50Ms };
  }

  public sortByPreference(models: string[]): string[] {
    return [...models].sort((a, b) => {
      const statsA = this.getModelStats(a);
      const statsB = this.getModelStats(b);

      const scoreA = 0.7 * statsA.failRatio + 0.3 * (statsA.latencyP50Ms / 1000);
      const scoreB = 0.7 * statsB.failRatio + 0.3 * (statsB.latencyP50Ms / 1000);

      return scoreA - scoreB;
    });
  }
}

export const modelHealthRegistry = ModelHealthRegistry.getInstance();
