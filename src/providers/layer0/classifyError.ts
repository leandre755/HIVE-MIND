/**
 * Layer 0 Error Classification Engine
 *
 * Maps HTTP status codes and provider response objects to typed domain errors.
 * Replaces fragile text regex substring matching.
 */

import {
  Layer0Error,
  InvalidRequestError,
  AuthError,
  RateLimitError,
  ServerError,
  NetworkError,
  ContentFilterError,
} from './errors.js';

export interface RawErrorInfo {
  status?: number;
  body?: unknown;
  message?: string;
  cause?: unknown;
  retryAfterHeader?: string | number | null;
}

function parseRetryAfter(retryAfterHeader?: string | number | null): number | undefined {
  if (retryAfterHeader === undefined || retryAfterHeader === null || retryAfterHeader === '')
    return undefined;
  const parsed = Number(retryAfterHeader);
  if (Number.isNaN(parsed) || parsed < 0) return undefined;
  return parsed > 1000 ? parsed : parsed * 1000;
}

function extractProviderCode(body?: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const obj = body as Record<string, unknown>;
  const code = Reflect.get(obj, 'code') ?? Reflect.get(obj, 'type');
  return typeof code === 'string' ? code : String(code ?? '');
}

function isContentFilterCode(providerCode: string): boolean {
  return (
    providerCode.includes('content_filter') ||
    providerCode.includes('safety') ||
    providerCode.includes('moderation')
  );
}

export function classifyError(info: RawErrorInfo): Layer0Error {
  const { status, body, message = '', cause, retryAfterHeader } = info;

  if (status === undefined || status === 0) {
    return new NetworkError(message || 'Network connection failed or timed out', { cause });
  }

  if (status === 401 || status === 403) {
    return new AuthError(message || `Authentication error (${status})`, { status, cause });
  }

  if (status === 429) {
    const retryAfterMs = parseRetryAfter(retryAfterHeader);
    return new RateLimitError(message || 'Rate limit exceeded (429)', {
      status,
      retryAfterMs,
      cause,
    });
  }

  const providerCode = extractProviderCode(body);
  if (isContentFilterCode(providerCode)) {
    return new ContentFilterError(message || 'Content filter or moderation triggered', {
      status,
      providerCode,
      cause,
    });
  }

  if (status === 400 || status === 422) {
    return new InvalidRequestError(message || `Invalid request payload (${status})`, {
      status,
      providerCode,
      cause,
    });
  }

  if (status >= 500 && status < 600) {
    return new ServerError(message || `Provider server error (${status})`, {
      status,
      providerCode,
      cause,
    });
  }

  return new ServerError(message || `Unhandled HTTP status ${status}`, {
    status,
    providerCode,
    cause,
  });
}
