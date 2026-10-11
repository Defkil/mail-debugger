import net from 'node:net';
import type { IMAPConnection } from 'imapkit';
import pino from 'pino';
import {
  closeTestImaps,
  imapClient,
  loggedInImap,
  rawImap,
  startTestImap,
  type TestImap,
} from '../testing/imap.js';
import { ImapTranscript } from '../testing/imap-transcript.js';
import { rawMessage } from '../testing/mail-fixtures.js';
import {
  limitOutput,
  MAX_FETCH_ITEMS,
  outputLimits,
  sequenceSet,
  type OutputLimits,
} from './output-control.js';
import {
  MAX_QUEUED_COMMAND_BYTES,
  MAX_QUEUED_COMMANDS,
  MAX_QUEUED_NOTIFICATIONS,
} from './pending-work.js';

afterEach(async () => {
  await closeTestImaps();
});

const KiB = 1024;

/** Small output limits, so tests can exceed them with little data. */
const smallOutput: OutputLimits = {
  budgetBytes: 256 * KiB,
  maxResponseBytes: 192 * KiB,
  batchBytes: 64 * KiB,
  lowWaterBytes: 32 * KiB,
  drainTimeoutMs: 500,
};

/**
 * Limits far below the 16 MB that a FETCH of 40 messages of 400 KiB
 * produces, which is more than the socket buffers of the operating system
 * absorb: without pacing, the in-process client could not read before the
 * budget runs out.
 */
const pacedOutput: OutputLimits = {
  budgetBytes: 1024 * KiB,
  maxResponseBytes: 768 * KiB,
  batchBytes: 64 * KiB,
  lowWaterBytes: 32 * KiB,
  drainTimeoutMs: 500,
};

/** A message whose source has about `size` octets. */
function sizedMessage(index: number, size: number): Buffer {
  const line = `${String(index).padStart(6, '0')} ${'x'.repeat(70)}\r\n`;
  return rawMessage({
    subject: `message ${index}`,
    text: line.repeat(Math.ceil(size / line.length)),
  });
}

async function fill(imap: TestImap, count: number, size: number) {
  const sources: Buffer[] = [];
  for (let index = 1; index <= count; index++) {
    const source = sizedMessage(index, size);
    sources.push(source);
    await imap.service.receive(source, null);
  }
  return sources;
}

/** A logger whose warnings the test can read. */
function recordingLogger() {
  const lines: { msg: string; reason?: string }[] = [];
  const destination = {
    write: (line: string) => {
      lines.push(JSON.parse(line) as { msg: string; reason?: string });
    },
  };
  return { logger: pino({ level: 'info' }, destination), lines };
}

describe('IMAP output limits', () => {
  it('answers a FETCH larger than the budget in batches the client can read', async () => {
    const imap = await startTestImap({ limits: { output: pacedOutput } });
    const sources = await fill(imap, 40, 400 * KiB);

    const client = imapClient(imap.port);
    await client.connect();
    await client.mailboxOpen('INBOX');
    const fetched: Buffer[] = [];
    const messages = client.fetch('1:*', { source: true });
    for await (const message of messages) {
      fetched.push(message.source ?? Buffer.alloc(0));
    }
    expect(fetched).toHaveLength(40);
    for (const [index, source] of sources.entries()) {
      expect(Buffer.compare(fetched[index], source)).toBe(0);
    }

    // FETCH BODY[] (not PEEK) sets \Seen, stored batch by batch.
    const raw = await loggedInImap(imap.port);
    await raw.command('S', 'SELECT INBOX');
    const response = await raw.command('F', 'FETCH 1:* BODY[]', 20_000);
    expect(response.match(/^\* \d+ FETCH /gm)).toHaveLength(40);
    expect(response).toMatch(/^F OK/m);
    const unseen = imap.service
      .mailboxEntries()
      .filter((entry) => !entry.flags.includes(String.raw`\Seen`));
    expect(unseen).toEqual([]);
  }, 60_000);

  it('keeps the numbers of a batched FETCH while mail arrives and leaves', async () => {
    const imap = await startTestImap({ limits: { output: pacedOutput } });
    const sources = await fill(imap, 20, 400 * KiB);
    const doomed = imap.service.mailboxEntries()[15];
    const raw = await loggedInImap(imap.port);
    await raw.command('S', 'SELECT INBOX');

    // Each batch stores \Seen for its message; while the second batch does,
    // mail arrives and another surface deletes a message of a later batch.
    const setFlags = imap.service.setFlags.bind(imap.service);
    let batches = 0;
    let arrival: Promise<{ uid: number }> | undefined;
    vi.spyOn(imap.service, 'setFlags').mockImplementation((changes, origin) => {
      batches++;
      if (batches === 2) {
        arrival = imap.service.receive(rawMessage({ subject: 'late' }), null);
        imap.service.delete(doomed.id, 'rest');
      }
      return setFlags(changes, origin);
    });
    const response = await raw.command(
      'F',
      'FETCH 1:* (BODY[HEADER.FIELDS (SUBJECT)] BODY[TEXT])',
      20_000,
    );
    const arrived = await arrival;
    const unseen = imap.service
      .mailboxEntries()
      .filter((entry) => !entry.flags.includes(String.raw`\Seen`));
    expect(unseen.map((entry) => entry.uid)).toEqual([arrived?.uid]);
    const subjects = Array.from(
      response.matchAll(/^Subject: (message \d+)\r?$/gm),
      (match) => match[1],
    );
    // Every message of the original numbering, the deleted one included.
    expect(subjects).toEqual(sources.map((_, index) => `message ${index + 1}`));
    expect(response).not.toMatch(/^\* \d+ EXPUNGE/m);
    expect(response).toMatch(/^F OK \[EXPUNGEISSUED\]/m);
    const noop = await raw.command('N', 'NOOP');
    expect(noop).toContain('* 16 EXPUNGE');
    expect(noop).toContain('* 20 EXISTS');
    expect(await raw.command('U', 'UID SEARCH ALL')).toContain(
      ` ${arrived?.uid}\r\n`,
    );
  }, 60_000);

  it('disconnects a client that stops reading', async () => {
    const { logger, lines } = recordingLogger();
    const imap = await startTestImap({
      limits: { output: pacedOutput },
      logger,
    });
    // 24 MB: more than the socket buffers of the system can take.
    await fill(imap, 40, 600 * KiB);
    const raw = await loggedInImap(imap.port);
    await raw.command('S', 'SELECT INBOX');
    raw.socket.pause();
    raw.write('F FETCH 1:* BODY.PEEK[]\r\n');
    const deadline = Date.now() + 10_000;
    while (lines.every((line) => line.reason !== 'drain')) {
      if (Date.now() > deadline) throw new Error('The client was not cut off');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // The connection is gone once the client reads what reached it.
    raw.socket.resume();
    const received = await raw.readUntil(() => raw.closed, 10_000);
    expect(received).not.toMatch(/^F OK/m);
  }, 30_000);

  it('refuses a FETCH whose response for one message would exceed the limit', async () => {
    const imap = await startTestImap({ limits: { output: smallOutput } });
    await fill(imap, 1, 100 * KiB);
    const raw = await loggedInImap(imap.port);
    await raw.command('S', 'SELECT INBOX');
    expect(
      await raw.command('A', 'FETCH 1 (BODY.PEEK[] BODY.PEEK[TEXT])'),
    ).toMatch(/^A NO \[LIMIT\]/m);
    // A partial range keeps the response small.
    expect(
      await raw.command('B', 'FETCH 1 (BODY.PEEK[]<0.10> BODY.PEEK[TEXT])'),
    ).toMatch(/^B OK/m);
    const items = Array.from({ length: MAX_FETCH_ITEMS + 1 }, () => 'UID').join(
      ' ',
    );
    expect(await raw.command('C', `FETCH 1 (${items})`)).toMatch(
      /^C NO \[LIMIT\]/m,
    );
  });

  it('counts large envelopes before constructing repeated FETCH responses', async () => {
    const imap = await startTestImap({ limits: { output: smallOutput } });
    await imap.service.receive(
      rawMessage({ subject: `${'\\'.repeat(64 * KiB)} end` }),
      null,
    );
    const raw = await loggedInImap(imap.port);
    await raw.command('S', 'SELECT INBOX');
    expect(await raw.command('F', 'FETCH 1 (ENVELOPE ENVELOPE)')).toMatch(
      /^F NO \[LIMIT\]/m,
    );
    expect(await raw.command('N', 'NOOP')).toMatch(/^N OK/m);
  });

  it('cuts off output above the budget', () => {
    const socket = {
      destroyed: false,
      writableLength: 0,
      writableNeedDrain: false,
      destroy: () => {
        socket.destroyed = true;
      },
    };
    const written: number[] = [];
    const connection = {
      socket,
      writeRaw: (data: Buffer) => {
        written.push(data.length);
        socket.writableLength += data.length;
      },
    } as unknown as IMAPConnection;
    const exceeded: string[] = [];
    limitOutput(connection, smallOutput, (reason) => {
      exceeded.push(reason);
    });

    connection.writeRaw(Buffer.alloc(200 * KiB));
    expect(written).toEqual([200 * KiB]);
    connection.writeRaw(Buffer.alloc(100 * KiB));
    expect(written).toEqual([200 * KiB]);
    expect(exceeded).toEqual(['budget']);
    expect(socket.destroyed).toBe(true);
  });

  it('sizes the default budget for two messages at the size limit', () => {
    const limits = outputLimits(25 * 1024 * 1024);
    expect(limits.budgetBytes).toBe(58 * 1024 * 1024);
    expect(limits.maxResponseBytes).toBeGreaterThan(2 * 25 * 1024 * 1024);
    expect(sequenceSet([1, 2, 3, 5, 7, 8])).toBe('1:3,5,7:8');
  });
});

describe('IMAP session limits', () => {
  it('bounds pipelined commands behind a pending CHECK', async () => {
    const imap = await startTestImap();
    const raw = await loggedInImap(imap.port);
    await raw.command('S', 'SELECT INBOX');
    let release: (() => void) | undefined;
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- The configured TypeScript lib is ES2022.
    const flush = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(imap.service, 'flush').mockReturnValue(flush);
    try {
      raw.write('C CHECK\r\n');
      raw.write(
        Array.from(
          { length: MAX_QUEUED_COMMANDS + 1 },
          (_, index) => `N${index} NOOP\r\n`,
        ).join(''),
      );
      await raw.waitForClose();
    } finally {
      release?.();
    }
    // Refusing one client's queue does not exhaust the listener's sessions.
    expect(
      await (await loggedInImap(imap.port)).command('N', 'NOOP'),
    ).toContain('N OK');
  });

  it('bounds queued input bytes even when there are few commands', async () => {
    const imap = await startTestImap();
    const raw = await loggedInImap(imap.port);
    await raw.command('S', 'SELECT INBOX');
    let release: (() => void) | undefined;
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers -- The configured TypeScript lib is ES2022.
    const flush = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(imap.service, 'flush').mockReturnValue(flush);
    try {
      raw.write('C CHECK\r\n');
      const size = Math.floor(MAX_QUEUED_COMMAND_BYTES / 5);
      for (let index = 0; index < 6; index++) {
        raw.write(`F${index} UID SEARCH TEXT "${'x'.repeat(size)}"\r\n`);
      }
      await raw.waitForClose();
    } finally {
      release?.();
    }
  });

  it('bounds notifications for a selected client that never asks for updates', async () => {
    const imap = await startTestImap();
    const received = await imap.service.receive(rawMessage(), null);
    const raw = await loggedInImap(imap.port);
    await raw.command('S', 'SELECT INBOX');
    for (let index = 0; index <= MAX_QUEUED_NOTIFICATIONS; index++) {
      imap.service.setFlags(
        [
          {
            id: received.id,
            flags: index % 2 === 0 ? [String.raw`\Seen`] : [],
          },
        ],
        'internal',
      );
    }
    await raw.waitForClose();
    expect(imap.service.get(received.id)).toBeDefined();
  });

  it('bounds deleted sources retained for a selected session', async () => {
    const imap = await startTestImap({ limits: { output: smallOutput } });
    await fill(imap, 2, 100 * KiB);
    const raw = await loggedInImap(imap.port);
    await raw.command('S', 'SELECT INBOX');
    for (const entry of imap.service.mailboxEntries()) {
      imap.service.delete(entry.id, 'rest');
    }
    await raw.waitForClose();
    expect(imap.service.mailboxEntries()).toEqual([]);
  });

  it('keeps an IDLE reader connected when large expunges drain immediately', async () => {
    const imap = await startTestImap({ limits: { output: smallOutput } });
    await fill(imap, 2, 100 * KiB);
    const raw = await loggedInImap(imap.port);
    await raw.command('S', 'SELECT INBOX');
    raw.write('I IDLE\r\n');
    await raw.readUntil((text) => text.startsWith('+ '));
    imap.service.clear('rest');
    const updates = await raw.readUntil((text) => text.includes('* 0 EXISTS'));
    expect(updates.match(/^\* \d+ EXPUNGE/gm)).toHaveLength(2);
    expect(updates).not.toContain('* BYE');
    raw.write('DONE\r\n');
    expect(await raw.tagged('I')).toMatch(/^I OK/m);
  });

  it('says BYE to connections above the session limit', async () => {
    const imap = await startTestImap({ limits: { maxSessions: 2 } });
    await rawImap(imap.port);
    await rawImap(imap.port);
    const third = await ImapTranscript.connect(imap.port);
    try {
      expect(await third.greeting()).toBe(
        '* BYE [UNAVAILABLE] Too many connections\r\n',
      );
      await third.waitForClose();
    } finally {
      third.close();
    }
  });

  it('logs out clients that do not authenticate in time or stay idle', async () => {
    const imap = await startTestImap({
      limits: { preAuthMs: 300, idleMs: 600 },
    });
    const anonymous = await rawImap(imap.port);
    await anonymous.command('C', 'CAPABILITY');
    await anonymous.waitForClose(5000);

    const idle = await loggedInImap(imap.port);
    await new Promise((resolve) => setTimeout(resolve, 400));
    // Input restarts the idle time.
    expect(await idle.command('N', 'NOOP')).toContain('N OK');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(idle.closed).toBe(false);
    const bye = await idle.readUntil((text) => text.includes('* BYE'), 5000);
    expect(bye).toContain('Autologout');
  });

  it('refuses literals above the limit before reading them', async () => {
    const imap = await startTestImap();
    const raw = await rawImap(imap.port);
    raw.write('A LOGIN {70000}\r\n');
    expect(await raw.tagged('A')).toMatch(/^A BAD Literal too large/m);
    await raw.command('L', 'LOGIN mail-debugger mail-debugger');
    raw.write('B SEARCH TEXT {70000}\r\n');
    expect(await raw.tagged('B')).toMatch(/^B BAD Literal too large/m);
  });

  it('closes a STARTTLS client that never begins its TLS handshake', async () => {
    const imap = await startTestImap({
      tls: 'starttls',
      limits: { preAuthMs: 300 },
    });
    const raw = await rawImap(imap.port);
    expect(await raw.command('T', 'STARTTLS')).toMatch(/^T OK/m);
    await raw.waitForClose();
  });

  it('says BYE to every session on shutdown', async () => {
    const imap = await startTestImap();
    const raw = await loggedInImap(imap.port);
    await raw.command('S', 'SELECT INBOX');
    const closing = imap.listener.close(2000);
    const bye = await raw.readUntil((text) => text.includes('* BYE'));
    expect(bye).toContain('Server shutting down');
    await raw.waitForClose();
    await closing;
    await expect(rawImap(imap.port)).rejects.toThrow();
  });

  it('does not wait for an unfinished implicit TLS handshake on shutdown', async () => {
    const imap = await startTestImap({ tls: 'implicit' });
    const socket = net.connect({ host: '127.0.0.1', port: imap.port });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('error', reject);
      });
      // Sending no ClientHello leaves this outside ImapKit's session set.
      const closing = imap.listener.close(50);
      await expect(
        Promise.race([
          closing,
          new Promise((resolve) =>
            setTimeout(() => resolve('still waiting'), 1000),
          ),
        ]),
      ).resolves.toBeUndefined();
    } finally {
      socket.destroy();
    }
  });
});
