import type {
  Email,
  EmailFilter,
  EmailSummary,
  SmtpEnvelope,
} from '@mail-debugger/client';
import { buildFilterClause, normalizeFilter } from '../db/email-query.js';
import type { EmailKey, StoreStats } from '../db/email-repository.js';
import { storedSize } from '../db/sizes.js';
import type { MailStore } from '../db/store.js';
import type { Logger } from '../logger.js';
import { parseEmail } from '../parser/email-parser.js';
import {
  InvalidArgumentError,
  MessageTooLargeError,
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

/** Longest keyword flag and most flags per message (IMAP STORE). */
export const MAX_FLAG_LENGTH = 64;
export const MAX_FLAGS_PER_MESSAGE = 32;

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

/**
 * The canonical mailbox. Every surface (SMTP, REST, IMAP, MCP) reads and
 * changes mail through this service, which commits each change in one
 * transaction and then emits a post-commit event.
 */
export class MailService {
  readonly events: MailEvents;
  private accepting = true;

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

  /** Emails matching `filter`, newest first, and the number of matches. */
  list(
    filter: EmailFilter | undefined,
    pageOptions?: Page,
  ): { data: EmailSummary[]; total: number } {
    const page = pageOptions ?? { limit: DEFAULT_PAGE_SIZE, offset: 0 };
    assertPage(page);
    const clause = buildFilterClause(normalizeFilter(filter));
    const repository = this.store.repository;
    return {
      data: repository.list(clause, page.limit, page.offset),
      total: repository.count(clause),
    };
  }

  get(id: number): Email | undefined {
    return this.store.repository.findById(id);
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

  /** Refuses new mail from now on; reads and deletions keep working. */
  stopAccepting(): void {
    this.accepting = false;
  }

  private assertAccepting(): void {
    if (!this.accepting) throw new ShuttingDownError();
  }

  private assertRoomFor(bytes: number): void {
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
