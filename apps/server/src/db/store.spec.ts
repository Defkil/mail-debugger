import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { silentLogger } from '../testing/mail-fixtures.js';
import { loadSqlJs } from './database.js';
import {
  DATABASE_FILE,
  DataDirectoryInUseError,
  LOCK_FILE,
} from './persistence.js';
import { openStore } from './store.js';

const LEGACY_SCHEMA = [
  `CREATE TABLE emails (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id  TEXT,
    from_addr   TEXT NOT NULL,
    to_addr     TEXT NOT NULL,
    cc          TEXT,
    bcc         TEXT,
    subject     TEXT,
    text_body   TEXT,
    html_body   TEXT,
    raw         TEXT NOT NULL,
    headers     TEXT,
    attachments TEXT,
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  'CREATE INDEX IF NOT EXISTS idx_emails_from ON emails(from_addr)',
  'CREATE INDEX IF NOT EXISTS idx_emails_subject ON emails(subject)',
  'CREATE INDEX IF NOT EXISTS idx_emails_received_at ON emails(received_at)',
];

/** A database file as mail-debugger 0.3.x wrote it. */
async function legacyDatabase(): Promise<Uint8Array> {
  const SQL = await loadSqlJs();
  const db = new SQL.Database();
  for (const statement of LEGACY_SCHEMA) db.run(statement);
  const insert = `INSERT INTO emails (message_id, from_addr, to_addr, cc, bcc, subject, text_body, html_body, raw, headers, attachments, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  db.run(insert, [
    '<one@example.com>',
    'alice@example.com',
    '["bob@example.com"]',
    null,
    null,
    'Grüße',
    'Hallo',
    null,
    'Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe?=\r\n\r\nHallo',
    '{"subject":"Grüße"}',
    '[{"filename":"a.bin","size":3,"contentType":"application/octet-stream","content":"AAEC"}]',
    '2026-03-01 10:00:00',
  ]);
  db.run(insert, [
    null,
    'carol@example.com',
    '["dave@example.com"]',
    '[]',
    '[]',
    null,
    null,
    '<p>x</p>',
    'Subject: second\r\n\r\nx',
    null,
    null,
    '2026-03-02 11:30:00',
  ]);
  db.run(insert, [
    '<gone@example.com>',
    'x@example.com',
    '[]',
    null,
    null,
    'gone',
    null,
    null,
    'x',
    null,
    null,
    '2026-03-03 00:00:00',
  ]);
  db.run('DELETE FROM emails WHERE id = 3');
  const bytes = db.export();
  db.close();
  return bytes;
}

describe('openStore', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-debugger-store-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps an in-memory store without files', async () => {
    const store = await openStore({ logger: silentLogger });
    expect(store.persistent).toBe(false);
    expect(store.repository.metadata()).toMatchObject({
      lastId: 0,
      uidNext: 1,
    });
    await store.close();
  });

  it('creates, locks and reopens a persistent store with the same identity', async () => {
    const first = await openStore({ dataDir: dir, logger: silentLogger });
    const identity = first.repository.metadata();
    expect(fs.existsSync(path.join(dir, DATABASE_FILE))).toBe(true);
    expect(fs.existsSync(path.join(dir, LOCK_FILE))).toBe(true);
    await first.close();
    expect(fs.existsSync(path.join(dir, LOCK_FILE))).toBe(false);

    const second = await openStore({ dataDir: dir, logger: silentLogger });
    expect(second.repository.metadata()).toEqual(identity);
    await second.close();
  });

  it('writes a debounced snapshot after changes and a final one on close', async () => {
    const store = await openStore({
      dataDir: dir,
      logger: silentLogger,
      snapshotDelayMs: 20,
    });
    store.db.run("UPDATE meta SET value = '41' WHERE key = 'last_id'");
    store.changed();
    const SQL = await loadSqlJs();
    await vi.waitFor(() => {
      const copy = new SQL.Database(
        fs.readFileSync(path.join(dir, DATABASE_FILE)),
      );
      const value = copy.exec("SELECT value FROM meta WHERE key = 'last_id'")[0]
        .values[0][0];
      copy.close();
      expect(value).toBe('41');
    });
    store.db.run("UPDATE meta SET value = '42' WHERE key = 'last_id'");
    store.changed();
    await store.close();
    const reopened = await openStore({ dataDir: dir, logger: silentLogger });
    expect(reopened.repository.metadata().lastId).toBe(42);
    await reopened.close();
  });

  it('refuses a data directory that another running process uses', async () => {
    fs.writeFileSync(
      path.join(dir, LOCK_FILE),
      JSON.stringify({ pid: process.ppid }),
    );
    await expect(
      openStore({ dataDir: dir, logger: silentLogger }),
    ).rejects.toBeInstanceOf(DataDirectoryInUseError);
  });

  it('refuses a second store on the same directory in this process', async () => {
    const store = await openStore({ dataDir: dir, logger: silentLogger });
    await expect(
      openStore({ dataDir: dir, logger: silentLogger }),
    ).rejects.toBeInstanceOf(DataDirectoryInUseError);
    await store.close();
  });

  it.each(['', '{', '{"pid":-1}', '{"pid":2147483000}'])(
    'preserves an incomplete, malformed or stale lock (%j)',
    async (contents) => {
      const lockFile = path.join(dir, LOCK_FILE);
      fs.writeFileSync(lockFile, contents);
      await expect(
        openStore({ dataDir: dir, logger: silentLogger }),
      ).rejects.toBeInstanceOf(DataDirectoryInUseError);
      expect(fs.readFileSync(lockFile, 'utf8')).toBe(contents);
      expect(fs.readdirSync(dir)).toEqual([LOCK_FILE]);
    },
  );

  describe('migration from mail-debugger 0.3', () => {
    it('migrates the data, keeps a backup and continues the id counter', async () => {
      const legacy = await legacyDatabase();
      fs.writeFileSync(path.join(dir, DATABASE_FILE), legacy);
      const warn = vi.spyOn(silentLogger, 'warn');

      const store = await openStore({ dataDir: dir, logger: silentLogger });
      const repo = store.repository;

      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ messages: 2 }),
        expect.stringContaining('cannot be restored'),
      );
      warn.mockRestore();
      expect(
        fs.readFileSync(path.join(dir, `${DATABASE_FILE}.schema1.bak`)),
      ).toEqual(Buffer.from(legacy));
      expect(repo.allKeys()).toEqual([
        { id: 1, uid: 1 },
        { id: 2, uid: 2 },
      ]);
      // id 3 was allocated and deleted in 0.3; it is never handed out again
      expect(repo.metadata()).toMatchObject({ lastId: 3, uidNext: 4 });

      expect(repo.findById(1)).toMatchObject({
        subject: 'Grüße',
        cc: [],
        bcc: [],
        receivedAt: '2026-03-01T10:00:00.000Z',
        raw: 'Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe?=\r\n\r\nHallo',
        attachments: [expect.objectContaining({ filename: 'a.bin', size: 3 })],
      });
      expect(repo.findById(1)).not.toHaveProperty('envelope');
      expect(repo.findById(2)).toMatchObject({
        subject: '',
        headers: {},
        attachments: [],
        receivedAt: '2026-03-02T11:30:00.000Z',
      });
      expect(Buffer.from(repo.findRaw(1) ?? [])).toEqual(
        Buffer.from(
          'Subject: =?UTF-8?Q?Gr=C3=BC=C3=9Fe?=\r\n\r\nHallo',
          'utf8',
        ),
      );
      expect(repo.stats().bytes).toBeGreaterThan(0);
      await store.close();

      // The migrated file opens without another migration.
      const reopened = await openStore({ dataDir: dir, logger: silentLogger });
      expect(reopened.repository.allKeys()).toHaveLength(2);
      await reopened.close();
      expect(
        fs.readdirSync(dir).filter((f) => f.includes('.bak')),
      ).toHaveLength(1);
    });

    it('leaves the original file untouched when the migration fails', async () => {
      const SQL = await loadSqlJs();
      const db = new SQL.Database(await legacyDatabase());
      // A table the migration needs to create already exists.
      db.run('CREATE TABLE meta (key TEXT)');
      const broken = db.export();
      db.close();
      fs.writeFileSync(path.join(dir, DATABASE_FILE), broken);

      await expect(
        openStore({ dataDir: dir, logger: silentLogger }),
      ).rejects.toThrow(/meta already exists/);
      expect(fs.readFileSync(path.join(dir, DATABASE_FILE))).toEqual(
        Buffer.from(broken),
      );
      expect(fs.readdirSync(dir)).toEqual([DATABASE_FILE]);
    });

    it('refuses data written by a newer schema', async () => {
      const SQL = await loadSqlJs();
      const db = new SQL.Database();
      db.run('PRAGMA user_version = 99');
      const bytes = db.export();
      db.close();
      fs.writeFileSync(path.join(dir, DATABASE_FILE), bytes);

      await expect(
        openStore({ dataDir: dir, logger: silentLogger }),
      ).rejects.toThrow(/newer mail-debugger/);
      expect(fs.readFileSync(path.join(dir, DATABASE_FILE))).toEqual(
        Buffer.from(bytes),
      );
    });
  });
});
