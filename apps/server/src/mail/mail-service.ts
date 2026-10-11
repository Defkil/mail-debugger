import type {
  Email,
  EmailFilter,
  EmailSummary,
  SmtpEnvelope,
} from '@mail-debugger/client';
import { buildFilterClause, normalizeFilter } from '../db/email-query.js';
import type {
  EmailKey,
  MailboxEntry,
  StoreStats,
} from '../db/email-repository.js';
import { storedSize } from '../db/sizes.js';
import type { MailStore } from '../db/store.js';
import type { Logger } from '../logger.js';
import { parseEmail } from '../parser/email-parser.js';
import {
  InvalidArgumentError,
  MessageTooLargeError,
  ServiceError,
  ShuttingDownError,
  StorageFullError,
} from './errors.js';
import { MailEvents, type MutationOrigin } from './mail-events.js';

export interface StorageLimits {
  /** Largest accepted message source in bytes. */
  maxMessageBytes: number;
  /** Most messages kept at once. */
  maxMessages: number;
  /** Most bytes kept at once (sources plus decoded bodies and attachments). */
  maxStorageBytes: number;
}

export const DEFAULT_LIMITS: StorageLimits = {
  maxMessageBytes: 25 * 1024 * 1024,
  maxMessages: 1000,
  maxStorageBytes: 250 * 1024 * 1024,
};

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const DEFAULT_WAIT_MS = 30_000;
export const MAX_WAIT_MS = 60_000;
/** Most waits pending at once, across REST and MCP. */
export const MAX_ACTIVE_WAITS = 100;

/** Longest keyword flag and most flags per message (IMAP STORE). */
export const MAX_FLAG_LENGTH = 64;
export const MAX_FLAGS_PER_MESSAGE = 32;

/** Highest IMAP UID (RFC 3501 nz-number, 32 bits). */
export const MAX_UID = 0xff_ff_ff_ff;

export interface Page {
  limit: number;
  offset: number;
}

export interface ReceivedEmail extends EmailKey {
  summary: EmailSummary;
}

export interface FlagChange {
  id: number;
  flags: readonly string[];
}

/** Where a client stands: ids up to `highWatermark` were allocated. */
export interface MailboxCursor {
  highWatermark: number;
  mailboxId: string;
}

export interface WaitOptions {
  /** The result has a higher id; ids are allocated in arrival order. */
  afterId: number;
  /** Expected mailbox identity; another one rejects with INVALID_CURSOR. */
  mailboxId?: string;
  filter?: EmailFilter;
  /** 0 to {@link MAX_WAIT_MS}; 0 only checks the stored emails. */
  timeoutMs: number;
  /** Ends the wait early; it then rejects with the signal's reason. */
  signal?: AbortSignal;
}

export interface WaitOutcome extends MailboxCursor {
  data: EmailSummary | null;
  timedOut: boolean;
}

export interface AttachmentContent {
  filename: string | null;
  contentType: string;
  bytes: Uint8Array;
}

/**
 * The canonical mailbox. Every surface (SMTP, REST, IMAP, MCP) reads and
 * changes mail through this service, which commits each change in one
 * transaction and then emits a post-commit event.
 */
export class MailService {
  readonly events: MailEvents;
  private accepting = true;
  /** Rejects a pending wait; used on shutdown. */
  private readonly pendingWaits = new Set<(reason: unknown) => void>();

  constructor(
    private readonly store: MailStore,
    readonly limits: StorageLimits = DEFAULT_LIMITS,
    logger?: Logger,
  ) {
    this.events = new MailEvents((error) =>
      logger?.error({ err: error }, 'A mail event listener failed'),
    );
  }

  get persistent(): boolean {
    return this.store.persistent;
  }

  /** Identity of the data set; cursors and IMAP UIDs belong to it. */
  identity(): { mailboxId: string; uidValidity: number } {
    const { mailboxId, uidValidity } = this.store.repository.metadata();
    return { mailboxId, uidValidity };
  }

  /** Highest id ever allocated; it never decreases, not even after clear. */
  highWatermark(): number {
    return this.store.repository.metadata().lastId;
  }

  cursor(): MailboxCursor {
    const { lastId, mailboxId } = this.store.repository.metadata();
    return { highWatermark: lastId, mailboxId };
  }

  /** IMAP state of the INBOX: UIDVALIDITY, UIDNEXT and its subscription. */
  imapState(): { uidValidity: number; uidNext: number; subscribed: boolean } {
    const meta = this.store.repository.metadata();
    return {
      uidValidity: meta.uidValidity,
      uidNext: meta.uidNext,
      subscribed: meta.inboxSubscribed,
    };
  }

  /** Keys, flags and arrival times of all emails, in ascending UID order. */
  mailboxEntries(): MailboxEntry[] {
    return this.store.repository.mailboxEntries();
  }

  /** Stores whether the INBOX is subscribed over IMAP. */
  setInboxSubscribed(subscribed: boolean): void {
    const repository = this.store.repository;
    repository.transaction(() => repository.setInboxSubscribed(subscribed));
    this.store.changed();
  }

  /** Writes pending changes of a persistent store to disk now. */
  flush(): Promise<void> {
    return this.store.flush();
  }

  stats(): StoreStats {
    return this.store.repository.stats();
  }

  /**
   * Throws a {@link StorageFullError} when no further message can be stored.
   * SMTP calls this before accepting a transaction.
   */
  assertCapacity(): void {
    this.assertRoomFor(0);
  }

  /**
   * Parses and stores a message received over SMTP. `raw` must be the exact
   * octets of the message; they are kept unchanged.
   */
  async receive(
    raw: Uint8Array,
    envelope: SmtpEnvelope | null,
    origin: MutationOrigin = 'smtp',
  ): Promise<ReceivedEmail> {
    this.assertAccepting();
    if (raw.byteLength > this.limits.maxMessageBytes) {
      throw new MessageTooLargeError(this.limits.maxMessageBytes);
    }
    const content = await parseEmail(raw);
    this.assertAccepting();
    const sizeBytes = storedSize({
      raw,
      textBody: content.textBody,
      htmlBody: content.htmlBody,
      attachmentSizes: content.attachments.map((a) => a.size),
    });
    const receivedAt = new Date().toISOString();

    const repository = this.store.repository;
    const key = repository.transaction(() => {
      this.assertRoomFor(sizeBytes);
      return repository.insert({
        ...content,
        raw,
        envelope,
        receivedAt,
        sizeBytes,
      });
    });
    this.store.changed();

    const summary: EmailSummary = {
      id: key.id,
      from: content.from,
      to: content.to,
      subject: content.subject,
      receivedAt,
      hasAttachments: content.attachments.length > 0,
    };
    this.events.emit('inserted', { ...key, summary, origin });
    return { ...key, summary };
  }

  /**
   * Emails matching `filter`, newest first, the number of matches and the
   * cursor to wait for newer emails.
   */
  list(
    filter: EmailFilter | undefined,
    pageOptions?: Page,
  ): { data: EmailSummary[]; total: number } & MailboxCursor {
    const page = pageOptions ?? { limit: DEFAULT_PAGE_SIZE, offset: 0 };
    assertPage(page);
    const clause = buildFilterClause(normalizeFilter(filter));
    const repository = this.store.repository;
    return {
      data: repository.list(clause, page.limit, page.offset),
      total: repository.count(clause),
      ...this.cursor(),
    };
  }

  /**
   * Resolves with the matching email with the lowest id above `afterId`,
   * waiting up to `timeoutMs` for one to arrive; a timeout resolves with
   * `data: null`. Rejects with the signal's reason when aborted and with a
   * {@link ShuttingDownError} when the server stops.
   */
  async waitForEmail(options: WaitOptions): Promise<WaitOutcome> {
    this.assertAccepting();
    const { afterId, timeoutMs, signal } = options;
    signal?.throwIfAborted();
    if (!Number.isSafeInteger(afterId) || afterId < 0) {
      throw new InvalidArgumentError('afterId must be a non-negative integer');
    }
    if (
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 0 ||
      timeoutMs > MAX_WAIT_MS
    ) {
      throw new InvalidArgumentError(
        `timeoutMs must be an integer from 0 to ${MAX_WAIT_MS}`,
      );
    }
    const cursor = this.cursor();
    if (
      options.mailboxId !== undefined &&
      options.mailboxId !== cursor.mailboxId
    ) {
      throw new ServiceError(
        'INVALID_CURSOR',
        'The cursor belongs to another mailbox; list the emails again for a new one',
      );
    }
    if (afterId > cursor.highWatermark) {
      throw new ServiceError(
        'INVALID_CURSOR',
        `afterId ${afterId} is above the highest allocated id ${cursor.highWatermark}`,
      );
    }

    const clause = buildFilterClause(normalizeFilter(options.filter));
    const find = () => this.store.repository.firstAfter(afterId, clause);
    const outcome = (data: EmailSummary | undefined): WaitOutcome => ({
      data: data ?? null,
      timedOut: !data,
      ...this.cursor(),
    });

    const stored = find();
    if (stored || timeoutMs === 0) return outcome(stored);
    if (this.pendingWaits.size >= MAX_ACTIVE_WAITS) {
      throw new ServiceError(
        'LIMIT_EXCEEDED',
        `At most ${MAX_ACTIVE_WAITS} waits can be pending at once`,
      );
    }

    return new Promise<WaitOutcome>((resolve, reject) => {
      const cleanups: (() => void)[] = [];
      const finish = (settle: () => void) => {
        for (const cleanup of cleanups) cleanup();
        settle();
      };
      const check = () => {
        const email = find();
        if (email) finish(() => resolve(outcome(email)));
      };
      const cancel = (reason: unknown) => finish(() => reject(reason));
      const onAbort = () => cancel(signal?.reason);

      // Subscribe first, then check again, so that no arrival is missed.
      cleanups.push(this.events.on('inserted', check));
      const timer = setTimeout(
        () => finish(() => resolve(outcome(undefined))),
        timeoutMs,
      );
      cleanups.push(() => clearTimeout(timer));
      signal?.addEventListener('abort', onAbort, { once: true });
      cleanups.push(() => signal?.removeEventListener('abort', onAbort));
      this.pendingWaits.add(cancel);
      cleanups.push(() => this.pendingWaits.delete(cancel));
      check();
    });
  }

  get(id: number): Email | undefined {
    return this.store.repository.findById(id);
  }

  /** One decoded attachment; `index` counts from 0 in message order. */
  getAttachment(id: number, index: number): AttachmentContent {
    const attachments = this.store.repository.findAttachments(id);
    if (!attachments) {
      throw new ServiceError('EMAIL_NOT_FOUND', 'Email not found');
    }
    const attachment =
      Number.isSafeInteger(index) && index >= 0
        ? attachments[index]
        : undefined;
    if (!attachment) {
      throw new ServiceError(
        'ATTACHMENT_NOT_FOUND',
        `Email ${id} has no attachment ${index}`,
      );
    }
    return {
      filename: attachment.filename,
      contentType: attachment.contentType,
      bytes: Buffer.from(attachment.content, 'base64'),
    };
  }

  /** The exact octets of a message. */
  getRaw(id: number): Uint8Array | undefined {
    return this.store.repository.findRaw(id);
  }

  getFlags(id: number): string[] | undefined {
    return this.store.repository.getFlags(id);
  }

  /** Deletes one email; returns false if it did not exist. */
  delete(id: number, origin: MutationOrigin): boolean {
    return this.deleteMany([id], origin).length > 0;
  }

  /** Deletes the emails that exist among `ids` and returns their keys. */
  deleteMany(ids: readonly number[], origin: MutationOrigin): EmailKey[] {
    const repository = this.store.repository;
    const deleted = repository.transaction(() => repository.deleteByIds(ids));
    if (deleted.length > 0) {
      this.store.changed();
      this.events.emit('deleted', { emails: deleted, cleared: false, origin });
    }
    return deleted;
  }

  /** Deletes every email. Ids and UIDs continue where they were. */
  clear(origin: MutationOrigin): number {
    const repository = this.store.repository;
    const deleted = repository.transaction(() => repository.deleteAll());
    if (deleted.length > 0) {
      this.store.changed();
      this.events.emit('deleted', { emails: deleted, cleared: true, origin });
    }
    return deleted.length;
  }

  /**
   * Replaces the IMAP flags of emails in one transaction. Unknown ids are
   * skipped; the applied changes are returned and announced.
   */
  setFlags(changes: readonly FlagChange[], origin: MutationOrigin) {
    for (const change of changes) assertFlags(change.flags);
    const repository = this.store.repository;
    const applied = repository.transaction(() => {
      const result: { id: number; uid: number; flags: string[] }[] = [];
      for (const change of changes) {
        const key = repository.findKey(change.id);
        if (!key) continue;
        repository.setFlags(change.id, change.flags);
        result.push({ ...key, flags: [...change.flags] });
      }
      return result;
    });
    if (applied.length > 0) {
      this.store.changed();
      this.events.emit('flags', { changes: applied, origin });
    }
    return applied;
  }

  /**
   * Refuses new mail and waits from now on and ends the pending waits;
   * reads and deletions keep working.
   */
  stopAccepting(): void {
    this.accepting = false;
    for (const cancel of this.pendingWaits) cancel(new ShuttingDownError());
  }

  private assertAccepting(): void {
    if (!this.accepting) throw new ShuttingDownError();
  }

  private assertRoomFor(bytes: number): void {
    // IMAP UIDs are 32-bit and never reused: an exhausted data set takes no
    // more mail instead of starting over with a new UIDVALIDITY.
    if (this.store.repository.metadata().uidNext > MAX_UID) {
      throw new StorageFullError(
        'The mailbox has used up its IMAP UIDs; start with a new --data-dir to receive more',
      );
    }
    const { count, bytes: used } = this.store.repository.stats();
    if (count + 1 > this.limits.maxMessages) {
      throw new StorageFullError(
        `The mailbox holds the maximum of ${this.limits.maxMessages} messages; delete some to receive more`,
      );
    }
    if (used + bytes > this.limits.maxStorageBytes) {
      throw new StorageFullError(
        `The mailbox reached its storage limit of ${this.limits.maxStorageBytes} bytes; delete some messages to receive more`,
      );
    }
  }
}

function assertPage(page: Page): void {
  if (
    !Number.isSafeInteger(page.limit) ||
    page.limit < 1 ||
    page.limit > MAX_PAGE_SIZE
  ) {
    throw new InvalidArgumentError(
      `limit must be an integer from 1 to ${MAX_PAGE_SIZE}`,
    );
  }
  if (!Number.isSafeInteger(page.offset) || page.offset < 0) {
    throw new InvalidArgumentError('offset must be a non-negative integer');
  }
}

function assertFlags(flags: readonly string[]): void {
  if (flags.length > MAX_FLAGS_PER_MESSAGE) {
    throw new InvalidArgumentError(
      `A message can have at most ${MAX_FLAGS_PER_MESSAGE} flags`,
    );
  }
  for (const flag of flags) {
    if (
      typeof flag !== 'string' ||
      flag.length === 0 ||
      flag.length > MAX_FLAG_LENGTH ||
      flag.toLowerCase() === String.raw`\recent`
    ) {
      throw new InvalidArgumentError(`Invalid flag "${String(flag)}"`);
    }
  }
}
