import type { Database } from 'sql.js';
import { openDatabase } from './database.js';
import { buildFilterClause, normalizeFilter } from './email-query.js';
import { EmailRepository, type NewEmail } from './email-repository.js';

function newEmail(overrides: Partial<NewEmail> = {}): NewEmail {
  return {
    messageId: '<test@example.com>',
    from: 'sender@example.com',
    to: ['recipient@example.com'],
    cc: [],
    bcc: [],
    subject: 'Test Subject',
    textBody: 'Hello, world!',
    htmlBody: '<p>Hello, world!</p>',
    raw: new Uint8Array(Buffer.from('Subject: Test Subject\r\n\r\nHello')),
    headers: { subject: 'Test Subject' },
    attachments: [],
    envelope: { from: 'bounce@example.com', to: ['recipient@example.com'] },
    receivedAt: '2026-01-01T00:00:00.000Z',
    sizeBytes: 42,
    ...overrides,
  };
}

const everything = buildFilterClause({});

describe('EmailRepository', () => {
  let db: Database;
  let repo: EmailRepository;

  beforeEach(async () => {
    ({ db } = await openDatabase());
    repo = new EmailRepository(db);
  });

  afterEach(() => db.close());

  function insert(overrides: Partial<NewEmail> = {}) {
    return repo.transaction(() => repo.insert(newEmail(overrides)));
  }

  function matching(filter: Parameters<typeof normalizeFilter>[0]) {
    return repo.list(buildFilterClause(normalizeFilter(filter)), 10, 0);
  }

  const find = (filter: Parameters<typeof normalizeFilter>[0]) =>
    matching(filter).map((e) => e.subject);
  const ids = (filter: Parameters<typeof normalizeFilter>[0]) =>
    matching(filter).map((e) => e.id);

  it('allocates increasing ids and UIDs from the stored counters', () => {
    expect(insert()).toEqual({ id: 1, uid: 1 });
    expect(insert()).toEqual({ id: 2, uid: 2 });
    expect(repo.metadata()).toMatchObject({ lastId: 2, uidNext: 3 });
  });

  it('never reuses ids or UIDs after deletions and clear', () => {
    insert();
    insert();
    repo.transaction(() => repo.deleteAll());
    expect(insert()).toEqual({ id: 3, uid: 3 });
  });

  it('rolls an allocation back with its transaction', () => {
    expect(() =>
      repo.transaction(() => {
        repo.insert(newEmail());
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(repo.count()).toBe(0);
    expect(insert()).toEqual({ id: 1, uid: 1 });
  });

  it('keeps the exact message octets', () => {
    const raw = new Uint8Array([0x48, 0x00, 0xff, 0xfe, 0x0d, 0x0a]);
    const { id } = insert({ raw });
    expect(repo.findRaw(id)).toEqual(raw);
    expect(repo.findRaw(99)).toBeUndefined();
  });

  it('returns full details with the envelope', () => {
    const { id } = insert();
    expect(repo.findById(id)).toMatchObject({
      id,
      subject: 'Test Subject',
      raw: 'Subject: Test Subject\r\n\r\nHello',
      receivedAt: '2026-01-01T00:00:00.000Z',
      envelope: { from: 'bounce@example.com', to: ['recipient@example.com'] },
    });
    expect(repo.findById(99)).toBeUndefined();
  });

  it('omits the envelope when none was recorded', () => {
    const { id } = insert({ envelope: null });
    expect(repo.findById(id)).not.toHaveProperty('envelope');
  });

  it('lists newest first and breaks timestamp ties by id', () => {
    insert({ subject: 'a', receivedAt: '2026-01-01T00:00:00.000Z' });
    insert({ subject: 'b', receivedAt: '2026-01-02T00:00:00.000Z' });
    insert({ subject: 'c', receivedAt: '2026-01-02T00:00:00.000Z' });
    expect(repo.list(everything, 10, 0).map((e) => e.subject)).toEqual([
      'c',
      'b',
      'a',
    ]);
  });

  it('pages with limit and offset independently', () => {
    for (let i = 1; i <= 5; i++) {
      insert({ subject: `s${i}`, receivedAt: `2026-01-0${i}T00:00:00.000Z` });
    }
    expect(repo.list(everything, 2, 1).map((e) => e.subject)).toEqual([
      's4',
      's3',
    ]);
    expect(repo.list(everything, 10, 4).map((e) => e.subject)).toEqual(['s1']);
    expect(repo.count(everything)).toBe(5);
  });

  it('matches text criteria literally and case-insensitively, also beyond ASCII', () => {
    insert({ subject: 'Größe 100%_done', from: 'ÄRGER@example.com' });
    insert({ subject: 'other', from: 'bob@example.com' });
    expect(find({ subject: 'grÖße' })).toEqual(['Größe 100%_done']);
    expect(find({ subject: '100%_' })).toEqual(['Größe 100%_done']);
    expect(find({ subject: '1_0' })).toEqual([]);
    expect(find({ subject: '%' })).toEqual(['Größe 100%_done']);
    expect(find({ from: 'ärger' })).toEqual(['Größe 100%_done']);
  });

  it('filters by recipient and inclusive dates', () => {
    insert({
      to: ['alice@example.com'],
      receivedAt: '2026-01-01T10:00:00.000Z',
    });
    insert({ to: ['bob@example.com'], receivedAt: '2026-01-02T10:00:00.000Z' });
    expect(ids({ to: 'BOB' })).toEqual([2]);
    expect(ids({ since: '2026-01-02' })).toEqual([2]);
    expect(ids({ until: '2026-01-01' })).toEqual([1]);
    expect(
      ids({ since: '2026-01-01T10:00:00Z', until: '2026-01-01T10:00:00Z' }),
    ).toEqual([1]);
  });

  it('reports attachments in summaries', () => {
    insert({ subject: 'plain' });
    insert({
      subject: 'with file',
      attachments: [
        {
          filename: 'a.txt',
          size: 1,
          contentType: 'text/plain',
          content: 'YQ==',
        },
      ],
    });
    const byId = Object.fromEntries(
      repo.list(everything, 10, 0).map((e) => [e.subject, e.hasAttachments]),
    );
    expect(byId).toEqual({ plain: false, 'with file': true });
  });

  it('deletes by id and reports only existing keys', () => {
    insert();
    insert();
    expect(repo.transaction(() => repo.deleteByIds([2, 7]))).toEqual([
      { id: 2, uid: 2 },
    ]);
    expect(repo.allKeys()).toEqual([{ id: 1, uid: 1 }]);
  });

  it('stores IMAP flags', () => {
    const { id } = insert();
    expect(repo.getFlags(id)).toEqual([]);
    expect(repo.setFlags(id, [String.raw`\Seen`, 'custom'])).toBe(true);
    expect(repo.getFlags(id)).toEqual([String.raw`\Seen`, 'custom']);
    expect(repo.setFlags(99, [])).toBe(false);
  });

  it('sums the stored sizes', () => {
    insert({ sizeBytes: 10 });
    insert({ sizeBytes: 32 });
    expect(repo.stats()).toEqual({ count: 2, bytes: 42 });
  });
});
