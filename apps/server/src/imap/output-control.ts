import type {
  Attribute,
  CommandHandler,
  IMAPConnection,
  IMAPError,
  Message,
  ParsedCommand,
} from 'imapkit';
import type { Logger } from '../logger.js';
import {
  replay,
  type MailboxAdapter,
  type MirroredMessage,
} from './mailbox-adapter.js';

const MiB = 1024 * 1024;

/** Per-session output limits; see {@link outputLimits}. */
export interface OutputLimits {
  /** Pending output above this disconnects the session. */
  budgetBytes: number;
  /** A FETCH whose response for one message could exceed this is refused. */
  maxResponseBytes: number;
  /** A larger FETCH is answered in batches of about this size. */
  batchBytes: number;
  /** A batch starts only when at most this much output is pending. */
  lowWaterBytes: number;
  /** Output that does not drain for this long disconnects the session. */
  drainTimeoutMs: number;
}

/** Most data items one FETCH may request. */
export const MAX_FETCH_ITEMS = 64;

/**
 * Output limits for a largest accepted message: the budget is twice that
 * size plus 8 MiB (58 MiB by default), so one message at the size limit
 * fits even when it is fetched with a second full section.
 */
export function outputLimits(maxMessageBytes: number): OutputLimits {
  const budgetBytes = 2 * maxMessageBytes + 8 * MiB;
  return {
    budgetBytes,
    maxResponseBytes: budgetBytes - 4 * MiB,
    batchBytes: 4 * MiB,
    lowWaterBytes: MiB,
    drainTimeoutMs: 30_000,
  };
}

/**
 * Bounds the output a session can have pending. ImapKit writes responses to
 * the socket without looking at backpressure, so every write is checked:
 * output above the budget, or output that does not drain in time, ends the
 * session instead of growing memory.
 */
export function limitOutput(
  connection: IMAPConnection,
  limits: OutputLimits,
  onExceeded: (reason: 'budget' | 'drain', pendingBytes: number) => void,
): void {
  const writeRaw = connection.writeRaw.bind(connection);
  let drainTimer: NodeJS.Timeout | undefined;
  connection.writeRaw = (data: Buffer | string, callback?: () => void) => {
    const socket = connection.socket;
    if (!socket || socket.destroyed) return;
    const size = typeof data === 'string' ? data.length : data.byteLength;
    if (socket.writableLength + size > limits.budgetBytes) {
      onExceeded('budget', socket.writableLength + size);
      socket.destroy();
      return;
    }
    writeRaw(data, callback);
    if (drainTimer || !socket.writableNeedDrain) return;
    const timer = setTimeout(() => {
      drainTimer = undefined;
      if (socket.destroyed || socket.writableLength === 0) return;
      onExceeded('drain', socket.writableLength);
      socket.destroy();
    }, limits.drainTimeoutMs);
    timer.unref();
    drainTimer = timer;
    socket.once('drain', () => {
      clearTimeout(timer);
      if (drainTimer === timer) drainTimer = undefined;
    });
  };
}

/**
 * Resolves once at most `lowWaterBytes` of output are pending: true, or
 * false when the session closed meanwhile. Reading pauses while waiting, so
 * a client that does not read cannot queue more commands.
 */
export function waitForRoom(
  connection: IMAPConnection,
  limits: OutputLimits,
): Promise<boolean> {
  const socket = connection.socket;
  if (!socket || !connection.isOpen()) return Promise.resolve(false);
  if (socket.writableLength <= limits.lowWaterBytes) {
    return Promise.resolve(true);
  }
  socket.pause();
  return new Promise((resolve) => {
    const done = () => {
      socket.off('drain', done);
      socket.off('close', done);
      if (!socket.destroyed) socket.resume();
      resolve(connection.isOpen());
    };
    socket.on('drain', done);
    socket.on('close', done);
  });
}

type FetchPlan =
  | { kind: 'refuse'; text: string }
  | { kind: 'pass' }
  | { kind: 'batches'; batches: { set: string; messages: Message[] }[] };

const MACROS: Readonly<Record<string, readonly string[]>> = {
  ALL: ['FLAGS', 'INTERNALDATE', 'RFC822.SIZE', 'ENVELOPE'],
  FAST: ['FLAGS', 'INTERNALDATE', 'RFC822.SIZE'],
  FULL: ['FLAGS', 'INTERNALDATE', 'RFC822.SIZE', 'ENVELOPE', 'BODY'],
};

const CONTENT_ITEMS = new Set(['RFC822', 'RFC822.HEADER', 'RFC822.TEXT']);
const STRUCTURE_ITEMS = new Set(['BODYSTRUCTURE', 'ENVELOPE', 'BODY']);
const STRUCTURE_BOUND = MiB;
const SMALL_ITEM = 64;

/**
 * FETCH and UID FETCH with bounded output: a FETCH that could produce more
 * than one batch is answered batch by batch, each batch only once the
 * client has read most of the previous output. A FETCH whose response for
 * a single message could exceed the output budget is refused with
 * `NO [LIMIT]`. Flag changes (\Seen) are stored per batch before the batch
 * is sent.
 */
export function pacedFetch(
  handler: CommandHandler,
  isUid: boolean,
  adapter: MailboxAdapter,
  limits: OutputLimits,
  logger: Logger,
): CommandHandler {
  return (connection, parsed, data, callback) => {
    const plan = planFetch(connection, parsed, isUid, limits);
    if (plan.kind === 'refuse') {
      connection.sendStatus(parsed, data, 'NO', plan.text, 'LIMIT');
      return callback();
    }
    const socket = connection.socket;
    if (
      socket &&
      plan.kind === 'pass' &&
      socket.writableLength <= limits.lowWaterBytes
    ) {
      const output = adapter.runWithFlags(handler, connection, parsed, data);
      if (output) replay(connection, output);
      return callback();
    }
    const batches =
      plan.kind === 'batches'
        ? plan.batches
        : [{ set: '', messages: undefined }];
    void (async () => {
      try {
        for (const [index, batch] of batches.entries()) {
          if (!(await waitForRoom(connection, limits))) return;
          const batchParsed: ParsedCommand = batch.set
            ? {
                ...parsed,
                attributes: [
                  { type: 'SEQUENCE', value: batch.set },
                  parsed.attributes?.[1],
                ],
              }
            : parsed;
          const output = adapter.runWithFlags(
            handler,
            connection,
            batchParsed,
            data,
            batch.messages,
          );
          if (!output) return;
          const last = index === batches.length - 1;
          const tagged = output.responses.findIndex(
            ([response]) => response.tag === parsed.tag,
          );
          const status = output.responses[tagged]?.[0].command;
          if (!last && status === 'OK') output.responses.splice(tagged, 1);
          replay(connection, output);
          if (status !== 'OK') return;
        }
      } catch (error) {
        if ((error as IMAPError).imapResponse === 'BAD') {
          connection.sendStatus(parsed, data, 'BAD', (error as Error).message);
        } else {
          logger.error({ err: error }, 'IMAP FETCH failed');
          connection.sendStatus(
            parsed,
            data,
            'NO',
            'The FETCH could not be completed',
            'SERVERBUG',
          );
        }
      } finally {
        callback();
      }
    })();
  };
}

/**
 * Decides how a FETCH is answered. Anything that is not a well-formed
 * FETCH passes to ImapKit unchanged, which answers it with BAD.
 */
function planFetch(
  connection: IMAPConnection,
  parsed: ParsedCommand,
  isUid: boolean,
  limits: OutputLimits,
): FetchPlan {
  const attributes = parsed.attributes;
  const [set, itemList] = attributes ?? [];
  if (
    !set ||
    !itemList ||
    attributes?.length !== 2 ||
    !['ATOM', 'SEQUENCE'].includes(set.type)
  ) {
    return { kind: 'pass' };
  }
  let range: [number, Message][];
  try {
    range = connection.limitRange(
      parsed,
      connection.getCommandRange(set.value, isUid),
    );
  } catch {
    return { kind: 'pass' };
  }
  const items = fetchItems(itemList);
  if (!items) return { kind: 'pass' };
  if (items.length > MAX_FETCH_ITEMS) {
    return {
      kind: 'refuse',
      text: `A FETCH can request at most ${MAX_FETCH_ITEMS} data items`,
    };
  }

  const estimates = range.map(([, message]) => estimate(message, items));
  if (estimates.some((bytes) => bytes > limits.maxResponseBytes)) {
    return {
      kind: 'refuse',
      text: `The response for one message would exceed ${limits.maxResponseBytes} bytes; request fewer or partial body sections`,
    };
  }
  const total = estimates.reduce((sum, bytes) => sum + bytes, 0);
  if (total <= limits.batchBytes) return { kind: 'pass' };

  const batches: { set: string; messages: Message[] }[] = [];
  let current: [number, Message][] = [];
  let size = 0;
  for (const [index, entry] of range.entries()) {
    const bytes = estimates[index];
    if (current.length > 0 && size + bytes > limits.batchBytes) {
      batches.push(batchOf(current, isUid));
      current = [];
      size = 0;
    }
    current.push(entry);
    size += bytes;
  }
  if (current.length > 0) batches.push(batchOf(current, isUid));
  return { kind: 'batches', batches };
}

function batchOf(
  entries: [number, Message][],
  isUid: boolean,
): { set: string; messages: Message[] } {
  return {
    set: sequenceSet(
      entries.map(([sequence, message]) => (isUid ? message.uid : sequence)),
    ),
    messages: entries.map(([, message]) => message),
  };
}

/** A compact sequence set of ascending numbers, e.g. "1:3,7". */
export function sequenceSet(numbers: readonly number[]): string {
  const parts: string[] = [];
  let start = numbers[0];
  let end = start;
  for (const number of numbers.slice(1)) {
    if (number === end + 1) {
      end = number;
      continue;
    }
    parts.push(start === end ? String(start) : `${start}:${end}`);
    start = end = number;
  }
  if (start !== undefined) {
    parts.push(start === end ? String(start) : `${start}:${end}`);
  }
  return parts.join(',');
}

interface FetchItem {
  name: string;
  section: boolean;
  /** The item returns at most the header of the message. */
  header: boolean;
  /** Length of a partial range. */
  partial?: number;
}

const HEADER_SECTION = /^HEADER(\.FIELDS(\.NOT)?)?$/;

function fetchItems(itemList: Attribute): FetchItem[] | undefined {
  const named = (name: string): FetchItem => ({
    name,
    section: false,
    header: name === 'RFC822.HEADER',
  });
  if (!Array.isArray(itemList) && itemList?.type === 'ATOM') {
    const macro = MACROS[String(itemList.value).toUpperCase()];
    if (macro) return macro.map((name) => named(name));
  }
  const list: Attribute[] = Array.isArray(itemList) ? itemList : [itemList];
  const items: FetchItem[] = [];
  for (const item of list) {
    if (typeof item === 'string') {
      items.push(named(item.toUpperCase()));
      continue;
    }
    if (item?.type !== 'ATOM') return undefined;
    const name = String(item.value).toUpperCase();
    const partial = Array.isArray(item.partial)
      ? Number(item.partial[1])
      : undefined;
    const section: Attribute[] | undefined = Array.isArray(item.section)
      ? item.section
      : undefined;
    const specifier = String(section?.[0]?.value ?? '').toUpperCase();
    items.push({
      name,
      section: !!section,
      header: name === 'RFC822.HEADER' || HEADER_SECTION.test(specifier),
      ...(partial !== undefined && Number.isFinite(partial) && { partial }),
    });
  }
  return items;
}

/** An upper bound of the FETCH response for one message, in octets. */
function estimate(message: Message, items: readonly FetchItem[]): number {
  const mirrored = message as Partial<MirroredMessage>;
  const octets = mirrored.octets ?? 2 * message.raw.length;
  const headerOctets = mirrored.headerOctets ?? octets;
  let bytes = SMALL_ITEM;
  for (const item of items) {
    if (item.section || CONTENT_ITEMS.has(item.name)) {
      const size = item.header ? headerOctets : octets;
      bytes += Math.min(item.partial ?? size, size) + SMALL_ITEM;
    } else if (STRUCTURE_ITEMS.has(item.name)) {
      bytes += Math.min(octets, STRUCTURE_BOUND);
    } else {
      bytes += SMALL_ITEM;
    }
  }
  return bytes;
}

/** Session timeouts: before authentication and while authenticated. */
export interface SessionTimeouts {
  /** A client must authenticate within this time after connecting. */
  preAuthMs: number;
  /** An authenticated client that sends nothing for this long is logged out. */
  idleMs: number;
}

/**
 * Logs a session out when it does not authenticate in time or stays
 * silent for too long. Returns the function that stops the timer.
 */
export function limitSessionTime(
  connection: IMAPConnection,
  timeouts: SessionTimeouts,
  onTimeout: () => void,
): () => void {
  const opened = Date.now();
  let lastInput = opened;
  const onData = connection.onData.bind(connection);
  connection.onData = (chunk: Buffer) => {
    lastInput = Date.now();
    onData(chunk);
  };
  let timer: NodeJS.Timeout;
  const schedule = (delay: number) => {
    timer = setTimeout(check, Math.max(delay, 0));
    timer.unref();
  };
  const check = () => {
    if (!connection.isOpen()) return;
    const now = Date.now();
    const remaining =
      (connection.state === 'Not Authenticated'
        ? opened + timeouts.preAuthMs
        : lastInput + timeouts.idleMs) - now;
    if (remaining <= 0) {
      onTimeout();
      return;
    }
    schedule(remaining);
  };
  schedule(timeouts.preAuthMs);
  return () => clearTimeout(timer);
}
