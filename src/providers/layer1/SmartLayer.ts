/**
 * Layer 1 Smart Layer
 *
 * Implements a flat, sequential, deterministic fallback loop (zero recursion),
 * dual bounds (MAX_ATTEMPTS = 4, deadlineMs = 120000ms),
 * and an SSE stream lock (streamStarted) that prevents fallback once chunk output has begun.
 */

import {
  ExecutionLayer,
  ExecutionRequest,
  StreamChunk,
  setupAbortController,
} from '../layer0/ExecutionLayer.js';
import { getModelConfig } from '../layer0/ModelRegistry.js';
import { adaptParamsForTargetModel, toWireParams } from '../GenerationParams.js';
import geminiAdapter from '../adapters/gemini.js';
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

  private async executeAttempt(
    modelId: string,
    request: SmartExecutionRequest,
    options: SmartExecutionOptions | undefined,
    recipe: ReturnType<ServiceRegistry['getRecipe']>,
    creds: CredentialResolution,
    family: string,
    attemptsCount: number,
  ): Promise<SmartExecuteResult> {
    const reqStartTime = Date.now();
    let result: AdapterChatResult;

    const modelConfig = getModelConfig(modelId);

    if (modelConfig.protocol_family === 'gemini-native') {
      const adaptedParams = adaptParamsForTargetModel(
        request.params ?? {},
        modelConfig.capabilities,
      );
      const wireParams = toWireParams(
        modelConfig.protocol_family,
        adaptedParams,
        modelConfig.capabilities,
        options?.effectiveMaxTokens,
      );
      const { controller, cleanup } = setupAbortController(recipe.timeoutMs, options?.signal);

      try {
        result = await geminiAdapter.chat(request.messages, {
          model: modelId,
          apiKey: creds.apiKey,
          familyConfig: modelConfig.familyConfig,
          tools: request.tools,
          tool_choice: request.tool_choice,
          temperature: adaptedParams.temperature,
          wireParams: {
            ...wireParams,
            ...request.wireParams,
          },
          signal: controller.signal,
          ...request.options,
        });
      } finally {
        cleanup();
      }
    } else {
      result = await this.executionLayer.execute(modelId, request, {
        apiKey: creds.apiKey,
        timeoutMs: recipe.timeoutMs,
        signal: options?.signal,
        effectiveMaxTokens: options?.effectiveMaxTokens,
      });
    }

    this.healthRegistry.recordSuccess(modelId, Date.now() - reqStartTime, family);
    return { result, usedModel: modelId, usedProvider: family, attemptsCount };
  }

  private isAttemptEligible(modelId: string): boolean {
    if (this.healthRegistry.isCircuitOpen(modelId)) return false;
    return this.healthRegistry.tryAcquireHalfOpenProbe(modelId);
  }

  private async handleCandidateFailure(
    modelId: string,
    error: unknown,
    family: string,
    creds: CredentialResolution,
    options?: SmartExecutionOptions,
  ): Promise<void> {
    if (options?.signal?.aborted) {
      throw error;
    }
    this.healthRegistry.recordFailure(modelId, error, family);
    if (error instanceof RateLimitError) {
      await this.credentialProvider.recordQuotaExceeded(modelId, creds.keyIndex);
    }
  }

  private prepareExecutionBudget(request: SmartExecutionRequest, options?: SmartExecutionOptions) {
    const startTime = Date.now();
    const deadlineMs = Math.min(options?.deadlineMs ?? DEFAULT_DEADLINE_MS, DEFAULT_DEADLINE_MS);
    const maxAttempts = Math.min(options?.maxAttempts ?? MAX_ATTEMPTS, MAX_ATTEMPTS);
    const candidateInfo = this.resolveCandidateModels(request);
    return {
      startTime,
      deadlineMs,
      maxAttempts,
      ...candidateInfo,
    };
  }

  private async *iterateEligibleCandidates(budget: {
    startTime: number;
    deadlineMs: number;
    maxAttempts: number;
    sortedModels: string[];
    recipe: ReturnType<ServiceRegistry['getRecipe']>;
  }): AsyncIterable<{
    modelId: string;
    family: string;
    creds: CredentialResolution;
    releaseProbe: () => void;
  }> {
    let attemptsCount = 0;
    for (const modelId of budget.sortedModels) {
      if (
        attemptsCount >= budget.maxAttempts ||
        Date.now() - budget.startTime >= budget.deadlineMs
      ) {
        break;
      }
      if (!this.isAttemptEligible(modelId)) continue;

      const family =
        this.healthRegistry.getFamilyForModel(modelId) || budget.recipe.family || 'openai';

      try {
        const creds = await this.credentialProvider.getKey(family, modelId);
        if (!creds?.apiKey) {
          this.healthRegistry.releaseHalfOpenProbe(modelId);
          continue;
        }

        attemptsCount++;
        yield {
          modelId,
          family,
          creds,
          releaseProbe: () => this.healthRegistry.releaseHalfOpenProbe(modelId),
        };
      } catch (error: unknown) {
        this.healthRegistry.releaseHalfOpenProbe(modelId);
        throw error;
      }
    }
  }

  public async execute(
    request: SmartExecutionRequest,
    options?: SmartExecutionOptions,
  ): Promise<SmartExecuteResult> {
    const budget = this.prepareExecutionBudget(request, options);
    let attemptsCount = 0;
    let lastError: unknown = null;

    for await (const candidate of this.iterateEligibleCandidates(budget)) {
      attemptsCount++;
      try {
        return await this.executeAttempt(
          candidate.modelId,
          request,
          options,
          budget.recipe,
          candidate.creds,
          candidate.family,
          attemptsCount,
        );
      } catch (error: unknown) {
        lastError = error;
        await this.handleCandidateFailure(
          candidate.modelId,
          error,
          candidate.family,
          candidate.creds,
          options,
        );
      } finally {
        candidate.releaseProbe();
      }
    }

    throw (
      lastError ||
      new Error(
        `SmartLayer: Request for "${budget.targetName}" failed after ${attemptsCount} attempts or deadline exceeded`,
      )
    );
  }

  private async *streamGeminiFallback(
    modelId: string,
    request: SmartExecutionRequest,
    options: SmartExecutionOptions | undefined,
    recipe: ReturnType<ServiceRegistry['getRecipe']>,
    creds: CredentialResolution,
    family: string,
    familyConfig: Record<string, unknown> | undefined,
  ): AsyncIterable<
    StreamChunk & { usedModel?: string; usedProvider?: string; _started?: boolean }
  > {
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | undefined;

    if (recipe?.timeoutMs && recipe.timeoutMs > 0) {
      timeoutId = setTimeout(() => controller.abort(), recipe.timeoutMs);
      if (typeof timeoutId.unref === 'function') timeoutId.unref();
    }

    const onAbort = () => controller.abort();
    if (options?.signal) {
      if (options.signal.aborted) {
        controller.abort();
      } else {
        options.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    try {
      const result = await geminiAdapter.chat(request.messages, {
        model: modelId,
        apiKey: creds.apiKey,
        familyConfig,
        wireParams: request.wireParams,
        signal: controller.signal,
      });

      yield {
        content: result.content ?? undefined,
        thought: result.thought ?? undefined,
        toolCalls: result.toolCalls ?? undefined,
        done: true,
        usedModel: modelId,
        usedProvider: family,
        _started: true,
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (options?.signal) {
        options.signal.removeEventListener('abort', onAbort);
      }
    }
  }

  private async *streamExecutionLayerFallback(
    modelId: string,
    request: SmartExecutionRequest,
    options: SmartExecutionOptions | undefined,
    recipe: ReturnType<ServiceRegistry['getRecipe']>,
    creds: CredentialResolution,
    family: string,
  ): AsyncIterable<
    StreamChunk & { usedModel?: string; usedProvider?: string; _started?: boolean }
  > {
    const stream = this.executionLayer.executeStream(modelId, request, {
      apiKey: creds.apiKey,
      timeoutMs: recipe.timeoutMs,
      signal: options?.signal,
      effectiveMaxTokens: options?.effectiveMaxTokens,
    });

    for await (const chunk of stream) {
      const _started = !!(chunk.content || chunk.thought || chunk.toolCalls);
      yield { ...chunk, usedModel: modelId, usedProvider: family, _started };
    }
  }

  private resolveTargetStream(
    modelId: string,
    request: SmartExecutionRequest,
    options: SmartExecutionOptions | undefined,
    recipe: ReturnType<ServiceRegistry['getRecipe']>,
    creds: CredentialResolution,
    family: string,
  ): AsyncIterable<
    StreamChunk & { usedModel?: string; usedProvider?: string; _started?: boolean }
  > {
    const modelConfig = getModelConfig(modelId);
    if (modelConfig.protocol_family === 'gemini-native') {
      return this.streamGeminiFallback(
        modelId,
        request,
        options,
        recipe,
        creds,
        family,
        modelConfig.familyConfig,
      );
    }
    return this.streamExecutionLayerFallback(modelId, request, options, recipe, creds, family);
  }

  private async handleStreamAttemptFailure(
    error: unknown,
    streamStarted: boolean,
    modelId: string,
    family: string,
    creds: CredentialResolution,
    options?: SmartExecutionOptions,
  ): Promise<never> {
    if (streamStarted) {
      if (typeof error === 'object' && error !== null) {
        Reflect.set(error, '__streamStarted', true);
      }
      throw error;
    }
    if (!options?.signal?.aborted) {
      this.healthRegistry.recordFailure(modelId, error, family);
      if (error instanceof RateLimitError) {
        await this.credentialProvider.recordQuotaExceeded(modelId, creds.keyIndex);
      }
    }
    throw error;
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
      const targetStream = this.resolveTargetStream(
        modelId,
        request,
        options,
        recipe,
        creds,
        family,
      );

      for await (const chunk of targetStream) {
        if (!streamStarted && chunk._started) {
          streamStarted = true;
        }
        delete chunk._started;
        yield chunk;
      }

      this.healthRegistry.recordSuccess(modelId, Date.now() - reqStartTime, family);
    } catch (error: unknown) {
      await this.handleStreamAttemptFailure(error, streamStarted, modelId, family, creds, options);
    }
  }

  private handleStreamAttemptError(error: unknown, options?: SmartExecutionOptions): void {
    if (typeof error === 'object' && error !== null && Reflect.get(error, '__streamStarted')) {
      throw error;
    }
    if (options?.signal?.aborted) {
      throw error;
    }
  }

  public async *executeStream(
    request: SmartExecutionRequest,
    options?: SmartExecutionOptions,
  ): AsyncIterable<StreamChunk & { usedModel?: string; usedProvider?: string }> {
    const budget = this.prepareExecutionBudget(request, options);
    let attemptsCount = 0;
    let lastError: unknown = null;

    for await (const candidate of this.iterateEligibleCandidates(budget)) {
      attemptsCount++;
      try {
        yield* this.streamAttempt(
          candidate.modelId,
          request,
          options,
          budget.recipe,
          candidate.creds,
          candidate.family,
        );
        return;
      } catch (error: unknown) {
        this.handleStreamAttemptError(error, options);
        lastError = error;
      } finally {
        candidate.releaseProbe();
      }
    }

    throw (
      lastError ||
      new Error(
        `SmartLayer: Streaming request for "${budget.targetName}" failed after ${attemptsCount} attempts or deadline exceeded`,
      )
    );
  }
}

export const smartLayer = SmartLayer.getInstance();
