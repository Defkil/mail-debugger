import { ServiceError, type ServiceErrorCode } from '../mail/errors.js';

/** The JSON body of every API error response. */
export interface ErrorBody {
  error: { code: string; message: string };
}

/** An error with an HTTP status and a stable code for API clients. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }

  get body(): ErrorBody {
    return { error: { code: this.code, message: this.message } };
  }
}

export const emailNotFound = () =>
  new HttpError(404, 'EMAIL_NOT_FOUND', 'Email not found');

const SERVICE_STATUS: Record<ServiceErrorCode, number> = {
  INVALID_ARGUMENT: 400,
  INVALID_CURSOR: 400,
  EMAIL_NOT_FOUND: 404,
  ATTACHMENT_NOT_FOUND: 404,
  MESSAGE_TOO_LARGE: 413,
  LIMIT_EXCEEDED: 429,
  STORAGE_FULL: 507,
  SHUTTING_DOWN: 503,
};

/**
 * Turns any thrown value into an {@link HttpError}. Unexpected errors become
 * a generic 500 so that no stack or internal message reaches the client.
 */
export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  return error instanceof ServiceError
    ? new HttpError(SERVICE_STATUS[error.code], error.code, error.message)
    : new HttpError(500, 'INTERNAL', 'Internal server error');
}

export function jsonError(error: HttpError): Response {
  return Response.json(error.body, {
    status: error.status,
    headers: error.headers,
  });
}
