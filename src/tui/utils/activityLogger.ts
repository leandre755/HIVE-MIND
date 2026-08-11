import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { debugLogger } from './errors.js';
import { safePath, safeExistsSync, safeMkdirSync, safeAppendFile } from '../../utils/safeFs.js';
import { HiveConfig } from '../config/hiveConfig.js';
import { CoreEvent, coreEvents } from './coreEvents.js';
import { ConsoleLogPayload } from '../ui/contexts/UIStateContext.js';
import WebSocketClient from 'ws';
import { createWebSocketUrl } from '../ui/utils/urlSecurityUtils.js';

function newActivityId(): string {
  return crypto.randomUUID();
}

const ACTIVITY_ID_HEADER = 'x-activity-request-id';
const MAX_BUFFER_SIZE = 100;

function isHeaderRecord(
  h: http.OutgoingHttpHeaders | readonly string[],
): h is http.OutgoingHttpHeaders {
  return !Array.isArray(h);
}

function isRequestOptions(value: unknown): value is http.RequestOptions {
  return (
    typeof value === 'object' && value !== null && !(value instanceof URL) && !Array.isArray(value)
  );
}

function isIncomingMessageCallback(value: unknown): value is (res: http.IncomingMessage) => void {
  return typeof value === 'function';
}

type HttpRequestArgs =
  | []
  | [
      url: string | URL | http.RequestOptions,
      options?: http.RequestOptions | ((res: http.IncomingMessage) => void),
      callback?: (res: http.IncomingMessage) => void,
    ];

function isUrlLike(value: unknown): value is string | URL {
  return typeof value === 'string' || value instanceof URL;
}

type HttpRequestFirstArg = string | URL | http.RequestOptions;

function callHttpRequestOne(
  originalFn: typeof http.request,
  first: HttpRequestFirstArg,
): http.ClientRequest {
  if (isUrlLike(first)) {
    return originalFn(first);
  }
  return originalFn({});
}

function callHttpRequestTwo(
  originalFn: typeof http.request,
  first: HttpRequestFirstArg,
  second: http.RequestOptions | ((res: http.IncomingMessage) => void) | undefined,
): http.ClientRequest {
  if (!second) {
    return callHttpRequestOne(originalFn, first);
  }
  if (isUrlLike(first)) {
    if (isIncomingMessageCallback(second)) {
      return originalFn(first, second);
    }
    if (isRequestOptions(second)) {
      return originalFn(first, second);
    }
  }
  if (isRequestOptions(first) && isIncomingMessageCallback(second)) {
    return originalFn(first, second);
  }
  return originalFn({});
}

function callHttpRequest(
  originalFn: typeof http.request,
  args: HttpRequestArgs,
): http.ClientRequest {
  if (args.length === 0) {
    return originalFn({});
  }
  if (args.length === 1) {
    return callHttpRequestOne(originalFn, args[0]);
  }
  if (args.length === 2) {
    return callHttpRequestTwo(originalFn, args[0], args[1]);
  }
  if (args.length === 3) {
    const first = args[0];
    const second = args[1];
    const third = args[2];
    if (isUrlLike(first) && isRequestOptions(second) && isIncomingMessageCallback(third)) {
      return originalFn(first, second, third);
    }
  }
  return originalFn({});
}

export interface NetworkLog {
  id: string;
  timestamp: number;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
  pending?: boolean;
  chunk?: {
    index: number;
    data: string;
    timestamp: number;
  };
  response?: {
    status: number;
    headers: Record<string, string>;
    body?: string;
    durationMs: number;
  };
  error?: string;
}

/** Partial update to an existing network log. */
export type PartialNetworkLog = { id: string } & Partial<NetworkLog>;

type HttpOptions = http.RequestOptions | string | URL;

function chunkToBuffer(chunk: unknown, encoding: BufferEncoding | undefined): Buffer {
  if (Buffer.isBuffer(chunk)) {
    return chunk;
  }
  if (typeof chunk === 'string') {
    return Buffer.from(chunk, encoding);
  }
  return Buffer.from(chunk instanceof Uint8Array ? chunk : String(chunk));
}

function resolveRequestOptions(
  firstArg: string | URL | http.RequestOptions | undefined,
): HttpOptions {
  if (typeof firstArg === 'string') {
    return firstArg;
  }
  if (firstArg instanceof URL) {
    return firstArg;
  }
  if (firstArg && typeof firstArg === 'object') {
    return isRequestOptions(firstArg) ? firstArg : {};
  }
  return {};
}

function resolveRequestUrl(options: HttpOptions, protocol: string): string {
  if (typeof options === 'string') {
    return options;
  }
  if (options instanceof URL) {
    return options.href;
  }
  const href = 'href' in options && typeof options.href === 'string' ? options.href : '';
  return (
    href || `${protocol}//${options.hostname || options.host || 'localhost'}${options.path || '/'}`
  );
}

function patchRequestWrite(
  req: http.ClientRequest,
  requestChunks: Buffer[],
  oldWrite: typeof req.write,
): void {
  (req as unknown as { write: unknown }).write = function (
    this: unknown,
    chunk: unknown,
    ...etc: unknown[]
  ) {
    if (chunk) {
      const arg0 = etc[0];
      const encoding = typeof arg0 === 'string' && Buffer.isEncoding(arg0) ? arg0 : undefined;
      requestChunks.push(chunkToBuffer(chunk, encoding));
    }
    return (oldWrite as unknown as (...a: unknown[]) => unknown).apply(this, [chunk, ...etc]);
  };
}

function patchRequestEnd(
  req: http.ClientRequest,
  requestChunks: Buffer[],
  oldEnd: typeof req.end,
  logger: ActivityLogger,
  id: string,
  url: string,
): void {
  (req as unknown as { end: unknown }).end = function (
    this: unknown,
    chunkOrCb?: unknown,
    ...etc: unknown[]
  ) {
    const chunk = typeof chunkOrCb === 'function' ? undefined : chunkOrCb;
    if (chunk) {
      const arg0 = etc[0];
      const encoding = typeof arg0 === 'string' && Buffer.isEncoding(arg0) ? arg0 : undefined;
      requestChunks.push(chunkToBuffer(chunk, encoding));
    }
    const body = Buffer.concat(requestChunks).toString('utf8');

    logger.safeEmitNetwork({
      id,
      timestamp: Date.now(),
      method: req.method || 'GET',
      url,
      headers: logger.stringifyHeaders(req.getHeaders()),
      body,
      pending: true,
    });
    return (oldEnd as unknown as (...a: unknown[]) => unknown).apply(this, [chunkOrCb, ...etc]);
  };
}

function wrapHttpRequest(
  logger: ActivityLogger,
  originalFn: typeof http.request,
  args: HttpRequestArgs,
  protocol: string,
): http.ClientRequest {
  const firstArg = args[0];
  const options = resolveRequestOptions(firstArg);

  const url = resolveRequestUrl(options, protocol);

  if (url.includes('127.0.0.1') || url.includes('localhost')) {
    return callHttpRequest(originalFn, args);
  }

  const rawHeaders =
    typeof options === 'object' && options !== null && !(options instanceof URL)
      ? options.headers
      : undefined;
  let headers: http.OutgoingHttpHeaders = {};
  if (rawHeaders && isHeaderRecord(rawHeaders)) {
    headers = rawHeaders;
  }

  const headerMap = new Map<string, http.OutgoingHttpHeader | undefined>(Object.entries(headers));
  const activityIdHeader = headerMap.get(ACTIVITY_ID_HEADER);
  if (activityIdHeader) {
    return callHttpRequest(originalFn, args);
  }

  const id = newActivityId();
  logger.requestStartTimes.set(id, Date.now());
  const req = callHttpRequest(originalFn, args);
  const requestChunks: Buffer[] = [];

  const oldWrite = req.write;
  const oldEnd = req.end;

  patchRequestWrite(req, requestChunks, oldWrite);
  patchRequestEnd(req, requestChunks, oldEnd, logger, id, url);

  req.on('response', (res: http.IncomingMessage) => {
    const responseChunks: Buffer[] = [];
    let chunkIndex = 0;

    res.on('data', (chunk: Buffer) => {
      const chunkBuffer = Buffer.from(chunk);
      responseChunks.push(chunkBuffer);

      logger.safeEmitNetwork({
        id,
        pending: true,
        chunk: {
          index: chunkIndex++,
          data: chunkBuffer.toString('utf8'),
          timestamp: Date.now(),
        },
      });
    });

    res.on('end', () => {
      const buffer = Buffer.concat(responseChunks);
      const encoding = res.headers['content-encoding'];

      const processBuffer = (finalBuffer: Buffer) => {
        const resBody = finalBuffer.toString('utf8');
        const startTime = logger.requestStartTimes.get(id);
        const durationMs = startTime ? Date.now() - startTime : 0;
        logger.requestStartTimes.delete(id);

        logger.safeEmitNetwork({
          id,
          pending: false,
          response: {
            status: res.statusCode || 0,
            headers: logger.stringifyHeaders(res.headers),
            body: resBody,
            durationMs,
          },
        });
      };

      if (encoding === 'gzip') {
        zlib.gunzip(buffer, (err, decompressed) => {
          processBuffer(err ? buffer : decompressed);
        });
      } else if (encoding === 'deflate') {
        zlib.inflate(buffer, (err, decompressed) => {
          processBuffer(err ? buffer : decompressed);
        });
      } else {
        processBuffer(buffer);
      }
    });
  });

  req.on('error', (err: Error) => {
    logger.requestStartTimes.delete(id);
    const message = err.message;
    logger.safeEmitNetwork({
      id,
      pending: false,
      error: message,
    });
  });

  return req;
}

/**
 * Capture utility for session activities (network and console).
 * Provides a stream of events that can be persisted for analysis or inspection.
 */
export class ActivityLogger extends EventEmitter {
  private static instance: ActivityLogger;
  private isInterceptionEnabled = false;
  public requestStartTimes = new Map<string, number>();
  private networkLoggingEnabled = false;

  private networkBufferMap = new Map<string, Array<NetworkLog | PartialNetworkLog>>();
  private networkBufferIds: string[] = [];
  private consoleBuffer: Array<ConsoleLogPayload & { timestamp: number }> = [];
  private readonly bufferLimit = 10;

  static getInstance(): ActivityLogger {
    if (!ActivityLogger.instance) {
      ActivityLogger.instance = new ActivityLogger();
    }
    return ActivityLogger.instance;
  }

  enableNetworkLogging() {
    this.networkLoggingEnabled = true;
    this.emit('network-logging-enabled');
  }

  disableNetworkLogging() {
    this.networkLoggingEnabled = false;
  }

  isNetworkLoggingEnabled(): boolean {
    return this.networkLoggingEnabled;
  }

  /**
   * Atomically returns and clears all buffered logs.
   * Prevents data loss from events emitted between get and clear.
   */
  drainBufferedLogs(): {
    network: Array<NetworkLog | PartialNetworkLog>;
    console: Array<ConsoleLogPayload & { timestamp: number }>;
  } {
    const network: Array<NetworkLog | PartialNetworkLog> = [];
    for (const id of this.networkBufferIds) {
      const events = this.networkBufferMap.get(id);
      if (events) network.push(...events);
    }
    const console = [...this.consoleBuffer];
    this.networkBufferMap.clear();
    this.networkBufferIds = [];
    this.consoleBuffer = [];
    return { network, console };
  }

  getBufferedLogs(): {
    network: Array<NetworkLog | PartialNetworkLog>;
    console: Array<ConsoleLogPayload & { timestamp: number }>;
  } {
    const network: Array<NetworkLog | PartialNetworkLog> = [];
    for (const id of this.networkBufferIds) {
      const events = this.networkBufferMap.get(id);
      if (events) network.push(...events);
    }
    return {
      network,
      console: [...this.consoleBuffer],
    };
  }

  clearBufferedLogs(): void {
    this.networkBufferMap.clear();
    this.networkBufferIds = [];
    this.consoleBuffer = [];
  }

  public stringifyHeaders(headers: unknown): Record<string, string> {
    const result: Record<string, string> = {};
    if (!headers) return result;

    if (headers instanceof Headers) {
      headers.forEach((v, k) => {
        result[k.toLowerCase()] = v;
      });
    } else if (typeof headers === 'object' && headers !== null) {
      for (const [key, val] of Object.entries(headers)) {
        result[key.toLowerCase()] = Array.isArray(val) ? val.join(', ') : String(val);
      }
    }
    return result;
  }

  private static sanitizeHeaderMap(
    headers: Record<string, string>,
    sensitiveKeys: string[],
  ): Record<string, string> {
    const headerMap = new Map<string, string>(Object.entries(headers));
    for (const [key, value] of headerMap) {
      if (sensitiveKeys.includes(key.toLowerCase())) {
        headerMap.set(key, '[REDACTED]');
      } else {
        headerMap.set(key, value);
      }
    }
    return Object.fromEntries(headerMap);
  }

  private sanitizeNetworkLog(log: NetworkLog | PartialNetworkLog): NetworkLog | PartialNetworkLog {
    if (!log || typeof log !== 'object') return log;

    const sanitized = { ...log };

    // Sanitize request headers
    if ('headers' in sanitized && sanitized.headers) {
      sanitized.headers = ActivityLogger.sanitizeHeaderMap(sanitized.headers, [
        'authorization',
        'cookie',
        'x-goog-api-key',
      ]);
    }

    // Sanitize response headers
    if ('response' in sanitized && sanitized.response?.headers) {
      const resHeaders = ActivityLogger.sanitizeHeaderMap(sanitized.response.headers, [
        'set-cookie',
      ]);
      sanitized.response = { ...sanitized.response, headers: resHeaders };
    }

    return sanitized;
  }

  /** @internal Emit a network event — public for testing only. */
  emitNetworkEvent(payload: NetworkLog | PartialNetworkLog) {
    this.safeEmitNetwork(payload);
  }

  public safeEmitNetwork(payload: NetworkLog | PartialNetworkLog) {
    const sanitized = this.sanitizeNetworkLog(payload);
    const id = sanitized.id;

    if (!this.networkBufferMap.has(id)) {
      this.networkBufferIds.push(id);
      this.networkBufferMap.set(id, []);
      // Evict oldest request group if over limit
      if (this.networkBufferIds.length > this.bufferLimit) {
        const evictId = this.networkBufferIds.shift()!;
        this.networkBufferMap.delete(evictId);
      }
    }
    this.networkBufferMap.get(id)!.push(sanitized);

    this.emit('network', sanitized);
  }

  enable() {
    if (this.isInterceptionEnabled) return;
    this.isInterceptionEnabled = true;

    this.patchGlobalFetch();
    this.patchNodeHttp();
  }

  private async readFetchStream(
    id: string,
    reader: ReadableStreamDefaultReader<Uint8Array>,
    response: Response,
  ): Promise<void> {
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let chunkIndex = 0;
    let done = false;
    try {
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (done) break;

        const chunkData = decoder.decode(result.value, { stream: true });
        chunks.push(chunkData);

        this.safeEmitNetwork({
          id,
          pending: true,
          chunk: {
            index: chunkIndex++,
            data: chunkData,
            timestamp: Date.now(),
          },
        });
      }

      const startTime = this.requestStartTimes.get(id);
      const durationMs = startTime ? Date.now() - startTime : 0;
      this.requestStartTimes.delete(id);

      this.safeEmitNetwork({
        id,
        pending: false,
        response: {
          status: response.status,
          headers: this.stringifyHeaders(response.headers),
          body: chunks.join(''),
          durationMs,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.safeEmitNetwork({
        id,
        pending: false,
        error: `Failed to read response body: ${message}`,
      });
    }
  }

  private async readFetchTextFallback(id: string, clonedRes: Response): Promise<void> {
    try {
      const text = await clonedRes.text();
      const startTime = this.requestStartTimes.get(id);
      const durationMs = startTime ? Date.now() - startTime : 0;
      this.requestStartTimes.delete(id);

      this.safeEmitNetwork({
        id,
        pending: false,
        response: {
          status: clonedRes.status,
          headers: this.stringifyHeaders(clonedRes.headers),
          body: text,
          durationMs,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.safeEmitNetwork({
        id,
        pending: false,
        error: `Failed to read response body: ${message}`,
      });
    }
  }

  private prepareFetchLog(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
  ): { url: string; id: string; newInit: RequestInit; body: string } | null {
    let url: string;
    if (typeof input === 'string') {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else {
      url = input.url;
    }
    if (url.includes('127.0.0.1') || url.includes('localhost')) {
      return null;
    }

    const id = newActivityId();

    const inputMethod = typeof input === 'object' && 'method' in input ? input.method : undefined;
    const inputHeaders =
      typeof input === 'object' && 'headers' in input ? input.headers : undefined;

    const method = (init?.method ?? inputMethod ?? 'GET').toUpperCase();
    const headers = new Headers(init?.headers ?? inputHeaders ?? {});
    headers.set(ACTIVITY_ID_HEADER, id);

    const newInit = {
      ...init,
      method,
      headers,
    };

    let reqBody = '';
    const body = newInit.body;
    if (body) {
      if (typeof body === 'string') reqBody = body;
      else if (body instanceof URLSearchParams) reqBody = body.toString();
    }

    return { url, id, newInit, body: reqBody };
  }

  private patchGlobalFetch() {
    if (!global.fetch) return;
    const originalFetch = global.fetch;

    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const prepared = this.prepareFetchLog(input, init);
      if (!prepared) {
        return originalFetch(input, init);
      }
      const { url, id, newInit, body: reqBody } = prepared;

      this.requestStartTimes.set(id, Date.now());
      this.safeEmitNetwork({
        id,
        timestamp: Date.now(),
        method: newInit.method as string,
        url,
        headers: this.stringifyHeaders(newInit.headers),
        body: reqBody,
        pending: true,
      });

      try {
        const response = await originalFetch(input, newInit);
        const clonedRes = response.clone();

        // Stream chunks if body is available
        if (clonedRes.body) {
          const reader = clonedRes.body.getReader();
          void this.readFetchStream(id, reader, response);
        } else {
          // Fallback for responses without body stream
          void this.readFetchTextFallback(id, clonedRes);
        }

        return response;
      } catch (err: unknown) {
        this.requestStartTimes.delete(id);
        const message = err instanceof Error ? err.message : String(err);
        this.safeEmitNetwork({ id, pending: false, error: message });
        throw err;
      }
    };
  }

  private patchNodeHttp() {
    const originalRequest = http.request;
    const originalHttpsRequest = https.request;

    const httpRequestWrapper = (
      url: HttpRequestFirstArg,
      options?: HttpSecondArg,
      callback?: (res: http.IncomingMessage) => void,
    ): http.ClientRequest => {
      const args = buildHttpRequestArgs(url, options, callback);
      return wrapHttpRequest(this, originalRequest, args, 'http:');
    };
    const httpsRequestWrapper = (
      url: HttpRequestFirstArg,
      options?: HttpSecondArg,
      callback?: (res: http.IncomingMessage) => void,
    ): http.ClientRequest => {
      const args = buildHttpRequestArgs(url, options, callback);
      return wrapHttpRequest(this, originalHttpsRequest as typeof http.request, args, 'https:');
    };

    Object.defineProperty(http, 'request', {
      value: httpRequestWrapper,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(https, 'request', {
      value: httpsRequestWrapper,
      writable: true,
      configurable: true,
    });
  }

  logConsole(payload: ConsoleLogPayload) {
    const enriched = { ...payload, timestamp: Date.now() };
    this.consoleBuffer.push(enriched);
    if (this.consoleBuffer.length > this.bufferLimit) {
      this.consoleBuffer.shift();
    }
    this.emit('console', enriched);
  }
}

type HttpSecondArg = http.RequestOptions | ((res: http.IncomingMessage) => void);

function buildHttpRequestArgs(
  url: string | URL | http.RequestOptions,
  options: HttpSecondArg | undefined,
  callback: ((res: http.IncomingMessage) => void) | undefined,
): HttpRequestArgs {
  if (callback !== undefined) {
    return [url, options, callback];
  }
  if (options !== undefined) {
    return [url, options];
  }
  return [url];
}

/**
 * Setup file-based logging to JSONL
 */
function setupFileLogging(capture: ActivityLogger, config: HiveConfig, customPath?: string) {
  const logFile =
    customPath ||
    (config.storage
      ? path.join(config.storage.getProjectTempLogsDir(), `session-${config.getSessionId()}.jsonl`)
      : null);

  if (!logFile) return;

  const logsDir = path.dirname(safePath(logFile));
  if (!safeExistsSync(logsDir)) {
    safeMkdirSync(logsDir);
  }

  const writeToLog = (type: 'console' | 'network', payload: unknown) => {
    try {
      const entry =
        JSON.stringify({
          type,
          payload,
          sessionId: config.getSessionId(),
          timestamp: Date.now(),
        }) + '\n';

      safeAppendFile(logFile, entry).catch((err) => {
        debugLogger.error('Failed to write to activity log:', err);
      });
    } catch (err) {
      debugLogger.error('Failed to prepare activity log entry:', err);
    }
  };

  capture.on('console', (payload) => writeToLog('console', payload));
  capture.on('network', (payload) => writeToLog('network', payload));
}

function flushTransportBuffer(
  ws: WebSocketClient | null,
  capture: ActivityLogger,
  transportBuffer: object[],
  sessionId: string | null,
  config: HiveConfig,
  sendMessage: (message: object) => void,
) {
  if (!ws || ws.readyState !== WebSocketClient.OPEN || !capture.isNetworkLoggingEnabled()) {
    return;
  }

  const { network, console: consoleLogs } = capture.drainBufferedLogs();
  const allInitialLogs: Array<{
    type: 'network' | 'console';
    payload: object;
    timestamp: number;
  }> = [
    ...network.map((l) => ({
      type: 'network' as const,
      payload: l,
      timestamp: 'timestamp' in l && l.timestamp ? l.timestamp : Date.now(),
    })),
    ...consoleLogs.map((l) => ({
      type: 'console' as const,
      payload: l,
      timestamp: l.timestamp,
    })),
  ].sort((a, b) => a.timestamp - b.timestamp);

  debugLogger.debug(
    `Flushing ${allInitialLogs.length} initial buffered logs and ${transportBuffer.length} transport buffered logs...`,
  );

  for (const log of allInitialLogs) {
    sendMessage({
      type: log.type,
      payload: log.payload,
      sessionId: sessionId || config.getSessionId(),
      timestamp: Date.now(),
    });
  }

  while (transportBuffer.length > 0) {
    const message = transportBuffer.shift()!;
    sendMessage(message);
  }
}

/**
 * Setup network-based logging via WebSocketClient
 */
function setupNetworkLogging(
  capture: ActivityLogger,
  host: string,
  port: number,
  config: HiveConfig,
  onReconnectFailed?: () => void,
) {
  const transportBuffer: object[] = [];
  let ws: WebSocketClient | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;
  let sessionId: string | null = null;
  let pingInterval: NodeJS.Timeout | null = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 2;

  const sendMessage = (message: object) => {
    if (ws && ws.readyState === WebSocketClient.OPEN) {
      ws.send(JSON.stringify(message));
    }
  };

  const flushBuffer = () => {
    flushTransportBuffer(ws, capture, transportBuffer, sessionId, config, sendMessage);
  };

  const connect = () => {
    try {
      const endpoint = createWebSocketUrl(host, port, '/ws');
      ws = new WebSocketClient(endpoint);

      ws.on('open', () => {
        debugLogger.debug(`WebSocketClient connected to ${host}:${port}`);
        reconnectAttempts = 0;
        // Register with CLI's session ID
        sendMessage({
          type: 'register',
          sessionId: config.getSessionId(),
          timestamp: Date.now(),
        });
      });

      ws.on('message', (data: Buffer) => {
        try {
          const parsed: unknown = JSON.parse(data.toString());
          if (
            typeof parsed === 'object' &&
            parsed !== null &&
            'type' in parsed &&
            typeof parsed.type === 'string'
          ) {
            handleServerMessage({
              type: parsed.type,
              sessionId:
                'sessionId' in parsed && typeof parsed.sessionId === 'string'
                  ? parsed.sessionId
                  : undefined,
            });
          }
        } catch (err) {
          debugLogger.debug('Invalid WebSocketClient message:', err);
        }
      });

      ws.on('close', () => {
        debugLogger.debug(`WebSocketClient disconnected from ${host}:${port}`);
        cleanup();
        scheduleReconnect();
      });

      ws.on('error', (err) => {
        debugLogger.debug('WebSocketClient error:', err);
      });
    } catch (err) {
      debugLogger.debug('Failed to connect WebSocketClient:', err);
      scheduleReconnect();
    }
  };

  const handleServerMessage = (message: { type: string; sessionId?: string }) => {
    switch (message.type) {
      case 'registered':
        sessionId = message.sessionId || null;
        debugLogger.debug(`WebSocketClient session registered: ${sessionId}`);

        // Start ping interval
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => {
          sendMessage({ type: 'pong', timestamp: Date.now() });
        }, 15000);

        // Flush buffered logs
        flushBuffer();
        break;
      case 'trigger-debugger': {
        import('node:inspector')
          .then((inspector) => {
            inspector.open();
            debugLogger.log(
              'Node debugger attached. Open chrome://inspect in Chrome to start debugging.',
            );
            return import('./events.js');
          })
          .then(({ appEvents, AppEvent, TransientMessageType }) => {
            appEvents.emit(AppEvent.TransientMessage, {
              message: 'Debugger attached from DevTools.',
              type: TransientMessageType.Hint,
            });
          })
          .catch((err) => debugLogger.debug('Failed to trigger debugger:', err));
        break;
      }
      case 'ping':
        sendMessage({ type: 'pong', timestamp: Date.now() });
        break;

      default:
        // Ignore unknown message types
        break;
    }
  };

  const sendToNetwork = (type: 'console' | 'network', payload: object) => {
    const message = {
      type,
      payload,
      sessionId: sessionId || config.getSessionId(),
      timestamp: Date.now(),
    };

    // If not connected or network logging not enabled, buffer
    if (!ws || ws.readyState !== WebSocketClient.OPEN || !capture.isNetworkLoggingEnabled()) {
      transportBuffer.push(message);
      if (transportBuffer.length > MAX_BUFFER_SIZE) transportBuffer.shift();
      return;
    }

    sendMessage(message);
  };

  const cleanup = () => {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    ws = null;
  };

  const scheduleReconnect = () => {
    if (reconnectTimer) return;

    reconnectAttempts++;
    if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS && onReconnectFailed) {
      debugLogger.debug(
        `WebSocketClient reconnect failed after ${MAX_RECONNECT_ATTEMPTS} attempts, promoting to server...`,
      );
      onReconnectFailed();
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      debugLogger.debug('Reconnecting WebSocketClient...');
      connect();
    }, 1000);
  };

  // Initial connection
  connect();

  capture.on('console', (payload) => sendToNetwork('console', payload));
  capture.on('network', (payload) => sendToNetwork('network', payload));

  capture.on('network-logging-enabled', () => {
    debugLogger.debug('Network logging enabled, flushing buffer...');
    flushBuffer();
  });

  // Cleanup on process exit
  process.on('exit', () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) ws.close();
    cleanup();
  });
}

let bridgeAttached = false;

/**
 * Bridge coreEvents to the ActivityLogger singleton (guarded — only once).
 */
function bridgeCoreEvents(capture: ActivityLogger) {
  if (bridgeAttached) return;
  bridgeAttached = true;
  coreEvents.on(CoreEvent.ConsoleLog, (payload) => {
    capture.logConsole(payload);
  });
}

/**
 * Initialize the activity logger with a specific transport mode.
 *
 * @param config  CLI configuration
 * @param options Transport configuration: network (WebSocketClient) or file (JSONL)
 */
export function initActivityLogger(
  config: HiveConfig,
  options:
    | {
        mode: 'network';
        host: string;
        port: number;
        onReconnectFailed?: () => void;
      }
    | { mode: 'file'; filePath?: string }
    | { mode: 'buffer' },
): void {
  const capture = ActivityLogger.getInstance();
  capture.enable();

  if (options.mode === 'network') {
    setupNetworkLogging(capture, options.host, options.port, config, options.onReconnectFailed);
    capture.enableNetworkLogging();
  } else if (options.mode === 'file') {
    setupFileLogging(capture, config, options.filePath);
  }
  // buffer mode: no transport, just intercept + bridge

  bridgeCoreEvents(capture);
}

/**
 * Add a network (WebSocketClient) transport to the existing ActivityLogger singleton.
 * Used for promotion re-entry without re-bridging coreEvents.
 */
export function addNetworkTransport(
  config: HiveConfig,
  host: string,
  port: number,
  onReconnectFailed?: () => void,
): void {
  const capture = ActivityLogger.getInstance();
  setupNetworkLogging(capture, host, port, config, onReconnectFailed);
}
