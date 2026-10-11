import type { EmailSummary } from '@mail-debugger/types';

/** The surface that caused a change, so adapters can ignore their own echoes. */
export type MutationOrigin = 'smtp' | 'rest' | 'imap' | 'mcp' | 'internal';

export interface EmailInsertedEvent {
  readonly id: number;
  readonly uid: number;
  readonly summary: Readonly<EmailSummary>;
  readonly origin: MutationOrigin;
}

export interface EmailsDeletedEvent {
  /** The deleted emails, in ascending id order. */
  readonly emails: readonly Readonly<{ id: number; uid: number }>[];
  /** True for a deletion of every stored email. */
  readonly cleared: boolean;
  readonly origin: MutationOrigin;
}

export interface FlagsChangedEvent {
  readonly changes: readonly Readonly<{
    id: number;
    uid: number;
    flags: readonly string[];
  }>[];
  readonly origin: MutationOrigin;
}

export interface MailEventMap {
  inserted: EmailInsertedEvent;
  deleted: EmailsDeletedEvent;
  flags: FlagsChangedEvent;
}

type Listener<T> = (event: T) => void;

/**
 * Post-commit change notifications of the mail service. Listeners run
 * synchronously in registration order; a throwing listener is reported and
 * does not affect the others or the change itself.
 */
export class MailEvents {
  private readonly listeners: {
    [K in keyof MailEventMap]: Set<Listener<MailEventMap[K]>>;
  } = { inserted: new Set(), deleted: new Set(), flags: new Set() };

  constructor(private readonly onListenerError: (error: unknown) => void) {}

  /** Subscribes to an event; returns the function that unsubscribes. */
  on<K extends keyof MailEventMap>(
    event: K,
    listener: Listener<MailEventMap[K]>,
  ): () => void {
    this.listeners[event].add(listener);
    return () => this.listeners[event].delete(listener);
  }

  emit<K extends keyof MailEventMap>(event: K, payload: MailEventMap[K]): void {
    const frozen = deepFreeze(payload);
    const listeners = this.listeners[event];
    for (const listener of listeners) {
      try {
        listener(frozen);
      } catch (error) {
        this.onListenerError(error);
      }
    }
  }

  listenerCount(event: keyof MailEventMap): number {
    return this.listeners[event].size;
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
