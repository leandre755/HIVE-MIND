/**
 * Layer 0 Domain Errors
 *
 * Typed error hierarchy representing exact failure classes from wire transport.
 * Completely eliminates fragile text regex matching for error classification.
 */

export abstract class Layer0Error extends Error {
  public abstract readonly code: string;
  public abstract readonly retriable: boolean;
  public abstract readonly malusWeight: number;
  public readonly status?: number;
  public readonly providerCode?: string;

  constructor(
    message: string,
    options?: { status?: number; providerCode?: string; cause?: unknown },
  ) {
    super(message, { cause: options?.cause });
    this.name = this.constructor.name;
    this.status = options?.status;
    this.providerCode = options?.providerCode;
  }
}

export class InvalidRequestError extends Layer0Error {
  public readonly code = 'INVALID_REQUEST';
  public readonly retriable = false;
  public readonly malusWeight = 0;
}

export class AuthError extends Layer0Error {
  public readonly code = 'AUTH_ERROR';
  public readonly retriable = false;
  public readonly malusWeight = 10;
}

export class RateLimitError extends Layer0Error {
  public readonly code = 'RATE_LIMIT';
  public readonly retriable = true;
  public readonly malusWeight = 2;
  public readonly retryAfterMs?: number;

  constructor(
    message: string,
    options?: { status?: number; providerCode?: string; retryAfterMs?: number; cause?: unknown },
  ) {
    super(message, options);
    this.retryAfterMs = options?.retryAfterMs;
  }
}

export class ServerError extends Layer0Error {
  public readonly code = 'SERVER_ERROR';
  public readonly retriable = true;
  public readonly malusWeight = 8;
}

export class NetworkError extends Layer0Error {
  public readonly code = 'NETWORK_ERROR';
  public readonly retriable = true;
  public readonly malusWeight = 8;
}

export class ContentFilterError extends Layer0Error {
  public readonly code = 'CONTENT_FILTER';
  public readonly retriable = false;
  public readonly malusWeight = 0;
}
