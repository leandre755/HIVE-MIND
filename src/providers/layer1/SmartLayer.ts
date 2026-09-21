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

    const { getModelConfig } = await import('../layer0/ModelRegistry.js');
    const modelConfig = getModelConfig(modelId);

    if (modelConfig.protocol_family === 'gemini-native') {
      const { default: geminiAdapter } = await import('../adapters/gemini.js');
      const { adaptParamsForTargetModel, toWireParams } = await import('../GenerationParams.js');
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
      const { setupAbortController } = await import('../layer0/ExecutionLayer.js');
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

      try {
        const creds = await this.credentialProvider.getKey(family, modelId);
        if (!creds?.apiKey) {
          continue;
        }

        attemptsCount++;
        try {
          return await this.executeAttempt(
            modelId,
            request,
            options,
            recipe,
            creds,
            family,
            attemptsCount,
          );
        } catch (error: unknown) {
          lastError = error;
          this.healthRegistry.recordFailure(modelId, error, family);
          if (error instanceof RateLimitError) {
            await this.credentialProvider.recordQuotaExceeded(modelId, creds.keyIndex);
          }
        }
      } finally {
        this.healthRegistry.releaseHalfOpenProbe(modelId);
      }
    }

    throw (
      lastError ||
      new Error(
        `SmartLayer: Request for "${targetName}" failed after ${attemptsCount} attempts or deadline exceeded`,
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
    const { default: geminiAdapter } = await import('../adapters/gemini.js');
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
      const { getModelConfig } = await import('../layer0/ModelRegistry.js');
      const modelConfig = getModelConfig(modelId);

      const targetStream =
        modelConfig.protocol_family === 'gemini-native'
          ? this.streamGeminiFallback(
              modelId,
              request,
              options,
              recipe,
              creds,
              family,
              modelConfig.familyConfig,
            )
          : this.streamExecutionLayerFallback(modelId, request, options, recipe, creds, family);

      for await (const chunk of targetStream) {
        if (!streamStarted && chunk._started) {
          streamStarted = true;
        }
        delete chunk._started;
        yield chunk;
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

      try {
        const creds = await this.credentialProvider.getKey(family, modelId);
        if (!creds?.apiKey) {
          continue;
        }

        attemptsCount++;
        try {
          yield* this.streamAttempt(modelId, request, options, recipe, creds, family);
          return;
        } catch (error: unknown) {
          if (
            typeof error === 'object' &&
            error !== null &&
            Reflect.get(error, '__streamStarted')
          ) {
            throw error;
          }
          lastError = error;
        }
      } finally {
        this.healthRegistry.releaseHalfOpenProbe(modelId);
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
