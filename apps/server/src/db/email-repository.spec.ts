import Database from 'better-sqlite3';
import { EmailRepository } from './email-repository';
import { CREATE_EMAILS_TABLE, CREATE_INDEXES } from './schema';
import type { EmailSummary, ParsedEmail } from '../types';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(CREATE_EMAILS_TABLE);
  for (const idx of CREATE_INDEXES) {
    db.exec(idx);
  }
  return db;
}

function makeParsedEmail(overrides: Partial<ParsedEmail> = {}): ParsedEmail {
  return {
    messageId: '<test@example.com>',
    from: 'sender@example.com',
    to: ['recipient@example.com'],
    cc: [],
    bcc: [],
    subject: 'Test Subject',
    textBody: 'Hello, world!',
    htmlBody: '<p>Hello, world!</p>',
    raw: 'From: sender@example.com\r\nTo: recipient@example.com\r\nSubject: Test Subject\r\n\r\nHello, world!',
    headers: { from: 'sender@example.com', to: 'recipient@example.com' },
    attachments: [],
    ...overrides,
  };
}

describe('EmailRepository', () => {
  let db: Database.Database;
  let repo: EmailRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new EmailRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('insert', () => {
    it('should insert an email and return the id', () => {
      const id = repo.insert(makeParsedEmail());
      expect(id).toBe(1);
    });

    it('should auto-increment ids', () => {
      const id1 = repo.insert(makeParsedEmail());
      const id2 = repo.insert(makeParsedEmail({ subject: 'Second' }));
      expect(id2).toBe(id1 + 1);
    });
  });

  describe('findAll', () => {
    it('should return empty array when no emails exist', () => {
      expect(repo.findAll()).toEqual([]);
    });

    it('should return all emails ordered by received_at desc', () => {
      repo.insert(makeParsedEmail({ subject: 'First' }));
      repo.insert(makeParsedEmail({ subject: 'Second' }));

      const results = repo.findAll();
      expect(results).toHaveLength(2);
      expect(results[0].subject).toBe('Second');
      expect(results[1].subject).toBe('First');
    });

    it('should filter by from address', () => {
      repo.insert(makeParsedEmail({ from: 'alice@example.com' }));
      repo.insert(makeParsedEmail({ from: 'bob@example.com' }));

      const results = repo.findAll({ from: 'alice' });
      expect(results).toHaveLength(1);
      expect(results[0].from).toBe('alice@example.com');
    });

    it('should filter by to address', () => {
      repo.insert(makeParsedEmail({ to: ['alice@example.com'] }));
      repo.insert(makeParsedEmail({ to: ['bob@example.com'] }));

      const results = repo.findAll({ to: 'bob' });
      expect(results).toHaveLength(1);
      expect(results[0].to).toEqual(['bob@example.com']);
    });

    it('should filter by subject', () => {
      repo.insert(makeParsedEmail({ subject: 'Welcome aboard' }));
      repo.insert(makeParsedEmail({ subject: 'Password reset' }));

      const results = repo.findAll({ subject: 'Welcome' });
      expect(results).toHaveLength(1);
      expect(results[0].subject).toBe('Welcome aboard');
    });

    it('should indicate hasAttachments correctly', () => {
      repo.insert(makeParsedEmail({ attachments: [] }));
      repo.insert(
        makeParsedEmail({
          subject: 'With attachment',
          attachments: [
            {
              filename: 'file.txt',
              size: 100,
              contentType: 'text/plain',
              content: 'aGVsbG8=',
            },
          ],
        })
      );

      const results = repo.findAll();
      const withAttachment = results.find(
        (e: EmailSummary) => e.subject === 'With attachment'
      );
      const withoutAttachment = results.find(
        (e: EmailSummary) => e.subject !== 'With attachment'
      );

      expect(withAttachment?.hasAttachments).toBe(true);
      expect(withoutAttachment?.hasAttachments).toBe(false);
    });
  });

  describe('findById', () => {
    it('should return undefined for non-existent id', () => {
      expect(repo.findById(999)).toBeUndefined();
    });

    it('should return full email details', () => {
      const parsed = makeParsedEmail();
      const id = repo.insert(parsed);

      const email = repo.findById(id);
      if (!email) throw new Error('Expected email to be defined');
      expect(email.id).toBe(id);
      expect(email.from).toBe(parsed.from);
      expect(email.to).toEqual(parsed.to);
      expect(email.subject).toBe(parsed.subject);
      expect(email.textBody).toBe(parsed.textBody);
      expect(email.htmlBody).toBe(parsed.htmlBody);
      expect(email.raw).toBe(parsed.raw);
      expect(email.receivedAt).toBeDefined();
    });
  });

  describe('deleteById', () => {
    it('should return false for non-existent id', () => {
      expect(repo.deleteById(999)).toBe(false);
    });

    it('should delete the email and return true', () => {
      const id = repo.insert(makeParsedEmail());
      expect(repo.deleteById(id)).toBe(true);
      expect(repo.findById(id)).toBeUndefined();
    });
  });

  describe('deleteAll', () => {
    it('should return 0 when no emails exist', () => {
      expect(repo.deleteAll()).toBe(0);
    });

    it('should delete all emails and return count', () => {
      repo.insert(makeParsedEmail());
      repo.insert(makeParsedEmail());
      repo.insert(makeParsedEmail());

      expect(repo.deleteAll()).toBe(3);
      expect(repo.findAll()).toEqual([]);
    });
  });

  describe('count', () => {
    it('should return 0 when empty', () => {
      expect(repo.count()).toBe(0);
    });

    it('should return correct count', () => {
      repo.insert(makeParsedEmail());
      repo.insert(makeParsedEmail());
      expect(repo.count()).toBe(2);
    });
  });
});
