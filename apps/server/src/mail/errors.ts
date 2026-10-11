/** Stable, machine-readable codes of service errors. */
export type ServiceErrorCode =
  | 'INVALID_ARGUMENT'
  | 'EMAIL_NOT_FOUND'
  | 'ATTACHMENT_NOT_FOUND'
  | 'INVALID_CURSOR'
  | 'STORAGE_FULL'
  | 'MESSAGE_TOO_LARGE'
  | 'LIMIT_EXCEEDED'
  | 'COUNT_CHANGED'
  | 'SHUTTING_DOWN';

/**
 * An expected failure of a mail service operation. The message is safe to
 * show to API clients; unexpected errors never use this class.
 */
export class ServiceError extends Error {
  constructor(
    readonly code: ServiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

export class InvalidArgumentError extends ServiceError {
  constructor(message: string) {
    super('INVALID_ARGUMENT', message);
    this.name = 'InvalidArgumentError';
  }
}

/** The store reached `--max-messages` or `--max-storage-bytes`. */
export class StorageFullError extends ServiceError {
  constructor(message: string) {
    super('STORAGE_FULL', message);
    this.name = 'StorageFullError';
  }
}

export class MessageTooLargeError extends ServiceError {
  constructor(maxBytes: number) {
    super(
      'MESSAGE_TOO_LARGE',
      `The message exceeds the maximum size of ${maxBytes} bytes`,
    );
    this.name = 'MessageTooLargeError';
  }
}

export class ShuttingDownError extends ServiceError {
  constructor() {
    super('SHUTTING_DOWN', 'The server is shutting down');
    this.name = 'ShuttingDownError';
  }
}
