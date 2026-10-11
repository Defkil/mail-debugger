import type {
  CommandHandler,
  IMAPConnection,
  IMAPServer,
  Mailbox,
  Message,
  ParsedCommand,
  StorageNamespace,
} from 'imapkit';
import type { Logger } from '../logger.js';
import { ServiceError } from '../mail/errors.js';
import type { MailService } from '../mail/mail-service.js';

/** The only mailbox: everything SMTP receives. */
export const INBOX = 'INBOX';

/** A message of ImapKit's in-memory mailbox, linked to the stored email. */
export interface MirroredMessage extends Message {
  /** Id of the email in the MailService. */
  emailId: number;
  /** Octets of the source as IMAP serves it (bare LF becomes CRLF). */
  octets: number;
  /** An upper bound of the octets of the header section. */
  headerOctets: number;
}

/**
 * A change could not be written to the mailbox, so the IMAP command must not
 * report success. `limit` marks a refused value (too many flags) rather than
 * a storage failure.
 */
export class PersistenceError extends Error {
  constructor(
    message: string,
    readonly limit = false,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PersistenceError';
  }
}

type SendArguments = Parameters<IMAPConnection['send']>;

/** Output of a command handler that ran with its output held back. */
export interface HeldOutput {
  /** The `connection.send()` calls, in order. */
  responses: SendArguments[];
  /** Messages the handler passed to `connection.notifyFlagChanges()`. */
  flagChanges: Message[];
}

/**
 * Keeps ImapKit's in-memory INBOX in step with the MailService, which owns
 * the mail. Stored mail is loaded at startup; inserts, deletions and flag
 * changes of other surfaces reach IMAP sessions as EXISTS, EXPUNGE and FETCH
 * notifications, and IMAP flag changes and expunges are written to the
 * mailbox before the command reports success. Changes made by one side are
 * marked with their origin, so they are never applied twice.
 */
export class MailboxAdapter {
  private readonly detachers: (() => void)[] = [];

  constructor(
    private readonly imap: IMAPServer,
    private readonly service: MailService,
    private readonly logger: Logger,
  ) {}

  /** The storage tree ImapKit starts from: an empty INBOX with the stored identity. */
  static storage(service: MailService): Record<string, StorageNamespace> {
    const state = service.imapState();
    return {
      INBOX: {
        uidvalidity: state.uidValidity,
        uidnext: state.uidNext,
        // INBOX has no children and can have none (RFC 3501 LIST attributes).
        flags: [String.raw`\Noinferiors`],
        subscribed: state.subscribed,
        messages: [],
      },
      // The personal namespace; without it NAMESPACE would answer NIL.
      '': { type: 'personal', separator: '/', folders: {} },
    };
  }

  /** Loads the stored mail and starts following changes. */
  attach(): void {
    for (const entry of this.service.mailboxEntries()) {
      this.append(entry.id, entry.uid, entry.flags, entry.receivedAt);
    }
    const { events } = this.service;
    this.detachers.push(
      events.on('inserted', (event) => {
        if (event.origin !== 'imap') {
          this.append(event.id, event.uid, [], event.summary.receivedAt);
        }
      }),
      events.on('deleted', (event) => {
        if (event.origin !== 'imap') {
          this.expunge(event.emails.map((email) => email.uid));
        }
      }),
      events.on('flags', (event) => {
        if (event.origin === 'imap') return;
        for (const change of event.changes) {
          if (this.mirrored(change.uid)) {
            this.imap.control.setFlags(INBOX, [change.uid], [...change.flags]);
          }
        }
      }),
    );
    const onExpunge = (
      _mailbox: Mailbox,
      messages: Message[],
      origin: IMAPConnection | null,
    ) => this.persistExpunge(messages, origin);
    this.imap.on('expunge', onExpunge);
    this.detachers.push(() => this.imap.off('expunge', onExpunge));
  }

  /** Stops following changes. */
  detach(): void {
    for (const detach of this.detachers.splice(0)) detach();
  }

  /**
   * Wraps FETCH and STORE so that the flags they change (STORE, and \Seen
   * set by FETCH) are stored before any of their output goes out. On a
   * failed write the flags are restored and the command answers NO, so no
   * session learns about a change that was not kept.
   */
  persistFlags(handler: CommandHandler): CommandHandler {
    return (connection, parsed, data, callback) => {
      const output = this.runWithFlags(handler, connection, parsed, data);
      if (output) replay(connection, output);
      callback();
    };
  }

  /**
   * Runs `handler` with its output held back, stores the flag changes it
   * made and returns the held output; the caller sends it with
   * {@link replay}. On a failed write the flags are restored, a NO is sent
   * and undefined is returned. `messages` limits the messages the handler
   * can change; by default every message the session can address.
   */
  runWithFlags(
    handler: CommandHandler,
    connection: IMAPConnection,
    parsed: ParsedCommand,
    data: string,
    messages?: readonly Message[],
  ): HeldOutput | undefined {
    const mailbox = selectedMailbox(connection);
    const tracked = messages ?? addressable(connection);
    const before = new Map(tracked.map((message) => [message, message.flags]));
    for (const message of tracked) message.flags = [...message.flags];
    const knownFlags = mailbox?.knownFlags && [...mailbox.knownFlags];
    const restore = () => {
      for (const [message, flags] of before) message.flags = flags;
      if (mailbox) mailbox.knownFlags = knownFlags;
    };

    let output: HeldOutput;
    try {
      output = holdOutput(handler, connection, parsed, data);
    } catch (error) {
      restore();
      throw error;
    }
    const changed = [...before].filter(
      ([message, flags]) => !sameFlags(message.flags, flags),
    );
    if (changed.length === 0) return output;
    try {
      this.service.setFlags(
        changed.map(([message]) => ({
          id: (message as MirroredMessage).emailId,
          flags: message.flags,
        })),
        'imap',
      );
    } catch (error) {
      restore();
      const limit = error instanceof ServiceError;
      if (!limit) {
        this.logger.error({ err: error }, 'Could not store IMAP flags');
      }
      connection.sendStatus(
        parsed,
        data,
        'NO',
        limit
          ? (error as Error).message
          : 'The flags could not be stored; nothing was changed',
        limit ? 'LIMIT' : 'SERVERBUG',
      );
      return undefined;
    }
    return output;
  }

  /**
   * Wraps EXPUNGE, UID EXPUNGE and CLOSE: when the mailbox refuses the
   * deletion, the in-memory INBOX is restored before any session is told
   * and the command answers NO.
   */
  guardExpunge(handler: CommandHandler): CommandHandler {
    return (connection, parsed, data, callback) => {
      const mailbox = selectedMailbox(connection);
      const before = mailbox ? [...mailbox.messages] : [];
      try {
        handler(connection, parsed, data, callback);
      } catch (error) {
        if (!mailbox || !(error instanceof PersistenceError)) throw error;
        mailbox.messages.splice(0, mailbox.messages.length, ...before);
        for (const message of before) Reflect.deleteProperty(message, 'ghost');
        connection.sendStatus(
          parsed,
          data,
          'NO',
          'The messages could not be deleted; nothing was expunged',
          'SERVERBUG',
        );
        callback();
      }
    };
  }

  /**
   * SUBSCRIBE and UNSUBSCRIBE: only INBOX can be subscribed, and its
   * subscription is stored with the mailbox.
   */
  subscriptionCommand(subscribe: boolean): CommandHandler {
    const command = subscribe ? 'SUBSCRIBE' : 'UNSUBSCRIBE';
    return (connection, parsed, data, callback) => {
      const name = singleMailboxArgument(parsed);
      if (name === undefined) {
        connection.sendStatus(
          parsed,
          data,
          'BAD',
          `${command} expects 1 mailbox argument`,
        );
        return callback();
      }
      if (name.toUpperCase() !== INBOX) {
        // UNSUBSCRIBE of a name that is not subscribed is not an error
        // (RFC 9051 section 6.3.8).
        if (subscribe) {
          connection.sendStatus(
            parsed,
            data,
            'NO',
            'Mailbox does not exist',
            'NONEXISTENT',
          );
        } else {
          connection.sendStatus(parsed, data, 'OK', `${command} completed`);
        }
        return callback();
      }
      try {
        this.service.setInboxSubscribed(subscribe);
      } catch (error) {
        this.logger.error({ err: error }, 'Could not store the subscription');
        connection.sendStatus(
          parsed,
          data,
          'NO',
          'The subscription could not be stored',
          'SERVERBUG',
        );
        return callback();
      }
      const inbox = this.imap.getMailbox(INBOX);
      if (inbox) inbox.subscribed = subscribe;
      connection.sendStatus(parsed, data, 'OK', `${command} completed`);
      callback();
    };
  }

  /** CHECK: a synchronisation point that writes pending changes to disk. */
  checkCommand(): CommandHandler {
    return (connection, parsed, data, callback) => {
      void (async () => {
        try {
          await this.service.flush();
          connection.sendStatus(parsed, data, 'OK', 'CHECK completed');
        } catch (error) {
          this.logger.error({ err: error }, 'Could not save the mailbox');
          connection.sendStatus(
            parsed,
            data,
            'NO',
            'The mailbox could not be saved',
            'SERVERBUG',
          );
        }
        callback();
      })();
    };
  }

  private append(
    id: number,
    uid: number,
    flags: readonly string[],
    receivedAt: string,
  ): void {
    const raw = this.service.getRaw(id);
    if (!raw) return;
    // ImapKit keeps sources as binary strings, one character per octet.
    const source = Buffer.from(
      raw.buffer,
      raw.byteOffset,
      raw.byteLength,
    ).toString('binary');
    this.imap.withOrigin(null, () =>
      this.imap.appendMessage(
        INBOX,
        [...flags],
        new Date(receivedAt),
        source,
        false,
        { uid, emailId: id, ...measureSource(source) },
      ),
    );
  }

  private expunge(uids: readonly number[]): void {
    const present = uids.filter((uid) => this.mirrored(uid));
    if (present.length > 0) this.imap.control.expungeMessages(INBOX, present);
  }

  private mirrored(uid: number): boolean {
    return (
      this.imap.getMailbox(INBOX)?.messages.some((m) => m.uid === uid) ?? false
    );
  }

  /** Deletes messages an IMAP session expunged; runs before any session is told. */
  private persistExpunge(
    messages: readonly Message[],
    origin: IMAPConnection | null,
  ): void {
    // Changes without a session come from this adapter (control API).
    if (origin === null) return;
    try {
      this.service.deleteMany(
        messages.map((message) => (message as MirroredMessage).emailId),
        'imap',
      );
    } catch (error) {
      this.logger.error({ err: error }, 'Could not delete expunged messages');
      throw new PersistenceError('The messages could not be deleted', false, {
        cause: error,
      });
    }
  }
}

/** Sends output that {@link MailboxAdapter.runWithFlags} held back. */
export function replay(connection: IMAPConnection, output: HeldOutput): void {
  for (const args of output.responses) connection.send(...args);
  if (output.flagChanges.length > 0) {
    connection.notifyFlagChanges(output.flagChanges);
  }
}

/**
 * Runs a synchronous command handler with `connection.send()` and
 * `connection.notifyFlagChanges()` captured instead of executed.
 */
function holdOutput(
  handler: CommandHandler,
  connection: IMAPConnection,
  parsed: ParsedCommand,
  data: string,
): HeldOutput {
  const output: HeldOutput = { responses: [], flagChanges: [] };
  let completed = false;
  connection.send = (...args: SendArguments) => {
    output.responses.push(args);
  };
  connection.notifyFlagChanges = (messages: Message[]) => {
    output.flagChanges.push(...messages);
  };
  try {
    handler(connection, parsed, data, () => {
      completed = true;
    });
  } finally {
    Reflect.deleteProperty(connection, 'send');
    Reflect.deleteProperty(connection, 'notifyFlagChanges');
  }
  if (!completed) {
    throw new Error(`${parsed.command} did not complete synchronously`);
  }
  return output;
}

function selectedMailbox(connection: IMAPConnection): Mailbox | undefined {
  return connection.selectedMailbox || undefined;
}

/** The messages a session can address: its view plus the current ones. */
function addressable(connection: IMAPConnection): Message[] {
  const mailbox = selectedMailbox(connection);
  return [
    ...new Set([
      ...connection.getSessionMessages(),
      ...(mailbox ? mailbox.messages : []),
    ]),
  ];
}

function sameFlags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((flag) => b.includes(flag));
}

function singleMailboxArgument(parsed: ParsedCommand): string | undefined {
  const attributes = parsed.attributes ?? [];
  const [name] = attributes;
  return name &&
    attributes.length === 1 &&
    ['STRING', 'LITERAL', 'ATOM'].includes(name.type)
    ? String(name.value)
    : undefined;
}

/**
 * Octets IMAP serves for a source (ImapKit turns bare LF into CRLF) and for
 * its header section including the empty line, for FETCH output estimates.
 */
export function measureSource(source: string): {
  octets: number;
  headerOctets: number;
} {
  let bare = 0;
  let headerOctets: number | undefined;
  let index = source.indexOf('\n');
  while (index !== -1) {
    const crlf = index > 0 && source.codePointAt(index - 1) === 13;
    if (!crlf) bare++;
    // The header ends with the first empty line.
    const lineStart = crlf ? index - 1 : index;
    if (
      headerOctets === undefined &&
      (lineStart === 0 || source.codePointAt(lineStart - 1) === 10)
    ) {
      headerOctets = index + 1 + bare;
    }
    index = source.indexOf('\n', index + 1);
  }
  const octets = source.length + bare;
  return { octets, headerOctets: headerOctets ?? octets };
}
