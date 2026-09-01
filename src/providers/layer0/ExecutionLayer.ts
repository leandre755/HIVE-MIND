/**
 * Layer 0 Execution Layer
 *
 * Stateless, deterministic execution engine operating under strict AbortController timeouts.
 * Handles header signing, request serialization, network execution, and error classification.
 */

import { config } from '../../config/index.js';
import { envResolver } from '../../services/envResolver.js';
import { getHeaderFamily, getProtocolFamily } from '../families/registry.js';
import type { ProtocolContext, ProtocolOptions } from '../families/types.js';
import {
  adaptParamsForTargetModel,
  applyPromptCaching,
  GenerationParams,
  toWireParams,
} from '../GenerationParams.js';
import type { AdapterChatResult, ChatMessage, ToolDefinition } from '../types.js';
import { classifyError } from './classifyError.js';
import { Layer0Error } from './errors.js';
import { getModelConfig, ResolvedModelConfig } from './ModelRegistry.js';

export interface ExecutionRequest {
  messages: ChatMessage[];
  params?: GenerationParams;
  tools?: ToolDefinition[];
  tool_choice?: string;
  wireParams?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface ExecutionOpts {
  apiKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  effectiveMaxTokens?: number;
}

export interface StreamChunk {
  content?: string;
  thought?: string;
  toolCalls?: unknown[];
  done?: boolean;
  raw?: unknown;
}

function ensureProtocolSupported(protocolFamily: string): void {
  if (protocolFamily === 'gemini-native') {
    throw new Error('Layer 0: gemini-native non supporté, utiliser adapter gemini.ts Layer 1');
  }
}

function resolveApiKey(provider: string, optsApiKey?: string): string {
  const resolved =
    optsApiKey ||
    envResolver.resolveProviderKey(provider) ||
    (Reflect.get(config.apiKeys, provider) as string | undefined);

  if (!resolved || typeof resolved !== 'string' || resolved.length === 0) {
    throw classifyError({
      status: 401,
      message: `No API key available for provider "${provider}"`,
    });
  }
  return resolved;
}

function createProtocolContext(
  modelConfig: ResolvedModelConfig,
  request: ExecutionRequest,
  apiKey: string,
  effectiveMaxTokens?: number,
): ProtocolContext {
  const processedMessages = applyPromptCaching(request.messages, modelConfig.capabilities);
  const adaptedParams = adaptParamsForTargetModel(request.params ?? {}, modelConfig.capabilities);
  const wireParams = toWireParams(
    modelConfig.protocol_family,
    adaptedParams,
    modelConfig.capabilities,
    effectiveMaxTokens,
  );

  return {
    model: modelConfig.modelId,
    apiKey,
    messages: processedMessages,
    options: {
      model: modelConfig.modelId,
      apiKey,
      tools: request.tools,
      tool_choice: request.tool_choice,
      temperature: adaptedParams.temperature,
      max_tokens: adaptedParams.maxTokens,
      ...request.options,
    },
    familyConfig: modelConfig.familyConfig,
    wireParams: {
      ...wireParams,
      ...request.wireParams,
    },
    protocolOptions: Reflect.get(modelConfig.familyConfig ?? {}, 'protocol_options') as
      ProtocolOptions | undefined,
  };
}

async function handleResponseError(response: Response): Promise<never> {
  const status = response.status;
  const retryAfterHeader = response.headers?.get('retry-after');
  let errorBody: unknown;
  try {
    errorBody = await response.json();
  } catch {
    errorBody = await response.text().catch(() => null);
  }

  let extractedMsg: string | undefined;
  if (typeof errorBody === 'object' && errorBody !== null) {
    const errObj = errorBody as Record<string, unknown>;
    const errField = Reflect.get(errObj, 'error');
    if (typeof errField === 'object' && errField !== null) {
      const msg = Reflect.get(errField as Record<string, unknown>, 'message');
      if (typeof msg === 'string') extractedMsg = msg;
    } else {
      const msg = Reflect.get(errObj, 'message');
      if (typeof msg === 'string') extractedMsg = msg;
    }
  } else if (typeof errorBody === 'string' && errorBody.length > 0) {
    extractedMsg = errorBody;
  }

  throw classifyError({
    status,
    body: errorBody,
    message: extractedMsg || `Provider returned HTTP ${status}`,
    retryAfterHeader,
  });
}

function setupAbortController(
  optsTimeout?: number,
  optsSignal?: AbortSignal,
  defaultTimeout = 60_000,
): {
  controller: AbortController;
  cleanup: () => void;
  timeoutMs: number;
} {
  const timeoutMs = optsTimeout ?? defaultTimeout;
  const controller = new AbortController();

  let timeoutTimer: NodeJS.Timeout | undefined;
  if (timeoutMs > 0) {
    timeoutTimer = setTimeout(() => {
      controller.abort(new Error(`Timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  }

  let externalAbortHandler: (() => void) | undefined;
  if (optsSignal) {
    if (optsSignal.aborted) {
      controller.abort(optsSignal.reason);
    } else {
      externalAbortHandler = () => controller.abort(optsSignal.reason);
      optsSignal.addEventListener('abort', externalAbortHandler);
    }
  }

  const cleanup = () => {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    if (optsSignal && externalAbortHandler) {
      optsSignal.removeEventListener('abort', externalAbortHandler);
    }
  };

  return { controller, cleanup, timeoutMs };
}

/**
 * Executes a deterministic model request.
 */
export async function execute(
  modelId: string,
  request: ExecutionRequest,
  opts?: ExecutionOpts,
): Promise<AdapterChatResult> {
  const modelConfig = getModelConfig(modelId);
  const apiKey = resolveApiKey(modelConfig.provider, opts?.apiKey);
  const protocolContext = createProtocolContext(
    modelConfig,
    request,
    apiKey,
    opts?.effectiveMaxTokens,
  );

  ensureProtocolSupported(modelConfig.protocol_family);

  const protocol = getProtocolFamily(modelConfig.protocol_family);
  const headerFamily = getHeaderFamily(modelConfig.header_family);

  const url = protocol.buildUrl(protocolContext);
  const body = protocol.buildBody(protocolContext);

  const headersExtra = (Reflect.get(modelConfig.familyConfig ?? {}, 'headers_extra') ??
    {}) as Record<string, string>;
  const protocolOptions = protocolContext.protocolOptions;

  const headers: Record<string, string> = {
    ...headerFamily.buildHeaders(apiKey, {
      model: modelConfig.modelId,
      protocol: protocol.name,
      familyConfig: modelConfig.familyConfig,
      options: protocolContext.options,
    }),
    ...headersExtra,
    ...protocolOptions?.extra_headers,
    ...protocol.extraHeaders,
  };

  const { controller, cleanup, timeoutMs } = setupAbortController(
    opts?.timeoutMs ?? protocolOptions?.timeout_ms,
    opts?.signal,
    protocol.timeoutMs ?? 60_000,
  );

  if (opts?.signal?.aborted) {
    cleanup();
    throw classifyError({
      status: 0,
      message: `ExecutionLayer: request was aborted before execution`,
      cause: opts.signal.reason,
    });
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error: unknown) {
    cleanup();
    if (error instanceof Layer0Error) throw error;
    if (error instanceof Error && (error.name === 'AbortError' || controller.signal.aborted)) {
      throw classifyError({
        status: 0,
        message: `ExecutionLayer: request timed out or was aborted after ${timeoutMs}ms`,
        cause: error,
      });
    }
    throw classifyError({
      status: 0,
      message: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  }

  if (!response || !response.ok) {
    cleanup();
    if (!response) {
      throw classifyError({
        status: 0,
        message: 'ExecutionLayer: no response received from fetch',
      });
    }
    await handleResponseError(response);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (parseError: unknown) {
    cleanup();
    throw classifyError({
      status: response.status,
      message: `Failed to parse response JSON: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      cause: parseError,
    });
  } finally {
    cleanup();
  }

  return protocol.parseResponse(data, protocolContext);
}

function extractDeltaFields(parsed: Record<string, unknown>): {
  content?: string;
  thought?: string;
  toolCalls?: unknown[];
} {
  const choices = Reflect.get(parsed, 'choices');
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0] as Record<string, unknown>;
    const delta = (Reflect.get(choice, 'delta') ?? {}) as Record<string, unknown>;
    const content = Reflect.get(delta, 'content');
    const reasoning = Reflect.get(delta, 'reasoning_content') ?? Reflect.get(delta, 'thought');
    const calls = Reflect.get(delta, 'tool_calls');
    return {
      content: typeof content === 'string' ? content : undefined,
      thought: typeof reasoning === 'string' ? reasoning : undefined,
      toolCalls: Array.isArray(calls) ? calls : undefined,
    };
  }
  const delta = Reflect.get(parsed, 'delta');
  if (typeof delta === 'object' && delta !== null) {
    const text = Reflect.get(delta as Record<string, unknown>, 'text');
    const thinking = Reflect.get(delta as Record<string, unknown>, 'thinking');
    return {
      content: typeof text === 'string' ? text : undefined,
      thought: typeof thinking === 'string' ? thinking : undefined,
    };
  }
  const content = Reflect.get(parsed, 'content');
  return { content: typeof content === 'string' ? content : undefined };
}

function parseStreamSseLine(trimmed: string): StreamChunk | null {
  if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) return null;
  const dataStr = trimmed.slice(5).trim();
  if (dataStr === '[DONE]') return { done: true };

  try {
    const parsed = JSON.parse(dataStr) as Record<string, unknown>;
    const fields = extractDeltaFields(parsed);
    return { ...fields, raw: parsed, done: false };
  } catch {
    return null;
  }
}

async function* readSseStream(body: ReadableStream<Uint8Array>): AsyncIterable<StreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const chunk = parseStreamSseLine(line.trim());
        if (chunk) {
          yield chunk;
          if (chunk.done) return;
        }
      }
    }
    if (buffer.trim()) {
      const chunk = parseStreamSseLine(buffer.trim());
      if (chunk) yield chunk;
    }
    yield { done: true };
  } finally {
    reader.releaseLock();
  }
}

function buildStreamHeaders(
  modelConfig: ResolvedModelConfig,
  protocolContext: ProtocolContext,
  apiKey: string,
  protocol: ReturnType<typeof getProtocolFamily>,
  headerFamily: ReturnType<typeof getHeaderFamily>,
): Record<string, string> {
  const headersExtra = (Reflect.get(modelConfig.familyConfig ?? {}, 'headers_extra') ??
    {}) as Record<string, string>;
  const protocolOptions = protocolContext.protocolOptions;

  return {
    ...headerFamily.buildHeaders(apiKey, {
      model: modelConfig.modelId,
      protocol: protocol.name,
      familyConfig: modelConfig.familyConfig,
      options: protocolContext.options,
    }),
    ...headersExtra,
    ...protocolOptions?.extra_headers,
    ...protocol.extraHeaders,
    Accept: 'text/event-stream',
  };
}

/**
 * Executes a streaming model request and yields StreamChunks.
 */
export async function* executeStream(
  modelId: string,
  request: ExecutionRequest,
  opts?: ExecutionOpts,
): AsyncIterable<StreamChunk> {
  const modelConfig = getModelConfig(modelId);
  const apiKey = resolveApiKey(modelConfig.provider, opts?.apiKey);
  const protocolContext = createProtocolContext(
    modelConfig,
    request,
    apiKey,
    opts?.effectiveMaxTokens,
  );

  ensureProtocolSupported(modelConfig.protocol_family);

  const protocol = getProtocolFamily(modelConfig.protocol_family);
  const headerFamily = getHeaderFamily(modelConfig.header_family);

  const url = protocol.buildUrl(protocolContext);
  const body = protocol.buildBody(protocolContext);
  Reflect.set(body, 'stream', true);

  const headers = buildStreamHeaders(modelConfig, protocolContext, apiKey, protocol, headerFamily);

  const { controller, cleanup, timeoutMs } = setupAbortController(
    opts?.timeoutMs ?? protocolContext.protocolOptions?.timeout_ms,
    opts?.signal,
    protocol.timeoutMs ?? 60_000,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error: unknown) {
    cleanup();
    if (error instanceof Layer0Error) throw error;
    if (error instanceof Error && (error.name === 'AbortError' || controller.signal.aborted)) {
      throw classifyError({
        status: 0,
        message: `ExecutionLayer: streaming request timed out or was aborted after ${timeoutMs}ms`,
        cause: error,
      });
    }
    throw classifyError({
      status: 0,
      message: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  }

  if (!response || !response.ok) {
    cleanup();
    if (!response)
      throw classifyError({
        status: 0,
        message: 'ExecutionLayer: no response received from fetch',
      });
    await handleResponseError(response);
  }

  if (!response.body) {
    cleanup();
    yield { done: true };
    return;
  }

  try {
    yield* readSseStream(response.body);
  } finally {
    cleanup();
  }
}

export class ExecutionLayer {
  public async execute(
    modelId: string,
    request: ExecutionRequest,
    opts?: ExecutionOpts,
  ): Promise<AdapterChatResult> {
    return execute(modelId, request, opts);
  }

  public async *executeStream(
    modelId: string,
    request: ExecutionRequest,
    opts?: ExecutionOpts,
  ): AsyncIterable<StreamChunk> {
    yield* executeStream(modelId, request, opts);
  }
}

export const executionLayer = new ExecutionLayer();
