/** Longest server message or body excerpt kept in an error. */
const MAX_EXCERPT = 500;

export interface RequestTarget {
  /** HTTP method of the failed request. */
  method: string;
  /** Request URL without credentials. */
  url: string;
}

/**
 * The server answered with an error status or a response the client cannot
 * use. `code` is the server's stable error code (e.g. `EMAIL_NOT_FOUND`),
 * `HTTP_<status>` for error pages without one, or `INVALID_RESPONSE`.
 */
export class MailDebuggerApiError extends Error {
  override readonly name = 'MailDebuggerApiError';
  readonly status: number;
  readonly code: string;
  readonly method: string;
  readonly url: string;
  /** Start of the response body, when it was not a JSON error object. */
  readonly body?: string;

  constructor(
    message: string,
    details: RequestTarget & { status: number; code: string; body?: string },
  ) {
    super(excerpt(message));
    this.status = details.status;
    this.code = details.code;
    this.method = details.method;
    this.url = details.url;
    if (details.body !== undefined) this.body = excerpt(details.body);
  }
}

/** The request did not reach the server or the connection failed. */
export class MailDebuggerNetworkError extends Error {
  override readonly name = 'MailDebuggerNetworkError';
  readonly method: string;
  readonly url: string;

  constructor(target: RequestTarget, cause: unknown) {
    super(`${target.method} ${target.url} failed: ${describe(cause)}`, {
      cause,
    });
    this.method = target.method;
    this.url = target.url;
  }
}

/** The request did not complete within the client's timeout. */
export class MailDebuggerTimeoutError extends Error {
  override readonly name = 'MailDebuggerTimeoutError';
  readonly method: string;
  readonly url: string;
  readonly timeoutMs: number;

  constructor(target: RequestTarget, timeoutMs: number) {
    super(`${target.method} ${target.url} timed out after ${timeoutMs} ms`);
    this.method = target.method;
    this.url = target.url;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Extracts a user-facing message from an unknown thrown value, falling back
 * to `fallback` (or the value itself) for non-Error values.
 */
export function getErrorMessage(err: unknown, fallback?: string): string {
  return err instanceof Error ? err.message : (fallback ?? String(err));
}

function excerpt(text: string): string {
  return text.length > MAX_EXCERPT ? `${text.slice(0, MAX_EXCERPT)}…` : text;
}

function describe(cause: unknown): string {
  if (cause instanceof Error) {
    const inner = (cause as Error & { cause?: unknown }).cause;
    return inner instanceof Error
      ? `${cause.message} (${inner.message})`
      : cause.message;
  }
  return String(cause);
}
