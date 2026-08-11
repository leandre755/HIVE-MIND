/**
 * Layer 1 Smart Layer
 *
 * Implements a flat, sequential, deterministic fallback loop (zero recursion),
 * dual bounds (MAX_ATTEMPTS = 4, deadlineMs = 120000ms),
 * and an SSE stream lock (streamStarted) that prevents fallback once chunk output has begun.
 */

import { ExecutionLayer, ExecutionRequest, StreamChunk } from '../layer0/ExecutionLayer.js';
import { RateLimitError } from '../layer0/errors.js';
import { AdapterChatResult } from '../types.js';
import { CredentialProvider, CredentialResolution } from './CredentialProvider.js';
import { ModelHealthRegistry } from './ModelHealthRegistry.js';
import { ServiceRegistry } from './ServiceRegistry.js';

export const MAX_ATTEMPTS = 4;
export const DEFAULT_DEADLINE_MS = 120000;

export interface SmartExecutionRequest extends ExecutionRequest {
  serviceOrCategory?: string;
  modelId?: string;
}

export interface SmartExecutionOptions {
  deadlineMs?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
  effectiveMaxTokens?: number;
}

export interface SmartExecuteResult {
  result: AdapterChatResult;
  usedModel: string;
  usedProvider: string;
  attemptsCount: number;
}

export class SmartLayer {
  private static instance: SmartLayer | null = null;

  private healthRegistry: ModelHealthRegistry;
  private credentialProvider: CredentialProvider;
  private serviceRegistry: ServiceRegistry;
  private executionLayer: ExecutionLayer;

  constructor(
    healthRegistry?: ModelHealthRegistry,
    credentialProvider?: CredentialProvider,
    serviceRegistry?: ServiceRegistry,
    executionLayer?: ExecutionLayer,
  ) {
    this.healthRegistry = healthRegistry ?? ModelHealthRegistry.getInstance();
    this.credentialProvider = credentialProvider ?? CredentialProvider.getInstance();
    this.serviceRegistry = serviceRegistry ?? ServiceRegistry.getInstance();
    this.executionLayer = executionLayer ?? new ExecutionLayer();
  }

  public static getInstance(): SmartLayer {
    if (!SmartLayer.instance) {
      SmartLayer.instance = new SmartLayer();
    }
    return SmartLayer.instance;
  }

  public static resetInstance(): void {
    SmartLayer.instance = null;
  }

  private resolveCandidateModels(request: SmartExecutionRequest): {
    targetName: string;
    sortedModels: string[];
    recipe: ReturnType<ServiceRegistry['getRecipe']>;
  } {
    const targetName = request.serviceOrCategory || request.modelId || 'EXECUTOR';
    const recipe = this.serviceRegistry.getRecipe(targetName);
    const candidateModels = recipe.models.length > 0 ? recipe.models : [targetName];
    const sortedModels = this.healthRegistry.sortByPreference(candidateModels);
    return { targetName, sortedModels, recipe };
  }

  public async execute(
    request: SmartExecutionRequest,
    options?: SmartExecutionOptions,
  ): Promise<SmartExecuteResult> {
    const startTime = Date.now();
    const deadlineMs = Math.min(options?.deadlineMs ?? DEFAULT_DEADLINE_MS, DEFAULT_DEADLINE_MS);
    const maxAttempts = Math.min(options?.maxAttempts ?? MAX_ATTEMPTS, MAX_ATTEMPTS);

    const { targetName, sortedModels, recipe } = this.resolveCandidateModels(request);

    let attemptsCount = 0;
    let lastError: unknown = null;

    for (const modelId of sortedModels) {
      if (attemptsCount >= maxAttempts || Date.now() - startTime >= deadlineMs) break;
      if (this.healthRegistry.isCircuitOpen(modelId)) continue;
      if (!this.healthRegistry.tryAcquireHalfOpenProbe(modelId)) continue;

      const family = this.healthRegistry.getFamilyForModel(modelId) || recipe.family || 'openai';
      const creds = await this.credentialProvider.getKey(family, modelId);
      if (!creds?.apiKey) {
        this.healthRegistry.releaseHalfOpenProbe(modelId);
        continue;
      }

      attemptsCount++;
      const reqStartTime = Date.now();

      try {
        const result = await this.executionLayer.execute(modelId, request, {
          apiKey: creds.apiKey,
          timeoutMs: recipe.timeoutMs,
          signal: options?.signal,
          effectiveMaxTokens: options?.effectiveMaxTokens,
        });

        this.healthRegistry.recordSuccess(modelId, Date.now() - reqStartTime, family);
        return { result, usedModel: modelId, usedProvider: family, attemptsCount };
      } catch (error: unknown) {
        lastError = error;
        this.healthRegistry.recordFailure(modelId, error, family);
        if (error instanceof RateLimitError) {
          await this.credentialProvider.recordQuotaExceeded(modelId, creds.keyIndex);
        }
      }
    }

    throw (
      lastError ||
      new Error(
        `SmartLayer: Request for "${targetName}" failed after ${attemptsCount} attempts or deadline exceeded`,
      )
    );
  }

  private async *streamAttempt(
    modelId: string,
    request: SmartExecutionRequest,
    options: SmartExecutionOptions | undefined,
    recipe: ReturnType<ServiceRegistry['getRecipe']>,
    creds: CredentialResolution,
    family: string,
  ): AsyncIterable<StreamChunk & { usedModel?: string; usedProvider?: string }> {
    const reqStartTime = Date.now();
    let streamStarted = false;

    try {
      const stream = this.executionLayer.executeStream(modelId, request, {
        apiKey: creds.apiKey,
        timeoutMs: recipe.timeoutMs,
        signal: options?.signal,
        effectiveMaxTokens: options?.effectiveMaxTokens,
      });

      for await (const chunk of stream) {
        if (!streamStarted && (chunk.content || chunk.thought || chunk.toolCalls)) {
          streamStarted = true;
        }
        yield { ...chunk, usedModel: modelId, usedProvider: family };
      }

      this.healthRegistry.recordSuccess(modelId, Date.now() - reqStartTime, family);
    } catch (error: unknown) {
      if (streamStarted) {
        if (typeof error === 'object' && error !== null) {
          Reflect.set(error, '__streamStarted', true);
        }
        throw error;
      }
      this.healthRegistry.recordFailure(modelId, error, family);
      if (error instanceof RateLimitError) {
        await this.credentialProvider.recordQuotaExceeded(modelId, creds.keyIndex);
      }
      throw error;
    }
  }

  public async *executeStream(
    request: SmartExecutionRequest,
    options?: SmartExecutionOptions,
  ): AsyncIterable<StreamChunk & { usedModel?: string; usedProvider?: string }> {
    const startTime = Date.now();
    const deadlineMs = Math.min(options?.deadlineMs ?? DEFAULT_DEADLINE_MS, DEFAULT_DEADLINE_MS);
    const maxAttempts = Math.min(options?.maxAttempts ?? MAX_ATTEMPTS, MAX_ATTEMPTS);

    const { targetName, sortedModels, recipe } = this.resolveCandidateModels(request);

    let attemptsCount = 0;
    let lastError: unknown = null;

    for (const modelId of sortedModels) {
      if (attemptsCount >= maxAttempts || Date.now() - startTime >= deadlineMs) break;
      if (this.healthRegistry.isCircuitOpen(modelId)) continue;
      if (!this.healthRegistry.tryAcquireHalfOpenProbe(modelId)) continue;

      const family = this.healthRegistry.getFamilyForModel(modelId) || recipe.family || 'openai';
      const creds = await this.credentialProvider.getKey(family, modelId);
      if (!creds?.apiKey) {
        this.healthRegistry.releaseHalfOpenProbe(modelId);
        continue;
      }

      attemptsCount++;
      try {
        yield* this.streamAttempt(modelId, request, options, recipe, creds, family);
        return;
      } catch (error: unknown) {
        if (typeof error === 'object' && error !== null && Reflect.get(error, '__streamStarted')) {
          throw error;
        }
        lastError = error;
      }
    }

    throw (
      lastError ||
      new Error(
        `SmartLayer: Streaming request for "${targetName}" failed after ${attemptsCount} attempts or deadline exceeded`,
      )
    );
  }
}

export const smartLayer = SmartLayer.getInstance();
