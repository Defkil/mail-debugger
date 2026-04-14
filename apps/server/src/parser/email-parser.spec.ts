import { parseEmail } from './email-parser';

const SIMPLE_EMAIL = [
  'From: sender@example.com',
  'To: recipient@example.com',
  'Subject: Test Subject',
  'Message-ID: <test123@example.com>',
  'Content-Type: text/plain',
  '',
  'Hello, world!',
].join('\r\n');

const HTML_EMAIL = [
  'From: sender@example.com',
  'To: recipient@example.com',
  'Subject: HTML Email',
  'Content-Type: text/html',
  '',
  '<p>Hello, world!</p>',
].join('\r\n');

const MULTIPART_EMAIL = [
  'From: sender@example.com',
  'To: alice@example.com, bob@example.com',
  'Cc: carol@example.com',
  'Subject: Multipart Test',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="boundary123"',
  '',
  '--boundary123',
  'Content-Type: text/plain',
  '',
  'Plain text body',
  '--boundary123',
  'Content-Type: text/html',
  '',
  '<p>HTML body</p>',
  '--boundary123',
  'Content-Type: application/octet-stream',
  'Content-Disposition: attachment; filename="test.txt"',
  'Content-Transfer-Encoding: base64',
  '',
  'SGVsbG8gV29ybGQ=',
  '--boundary123--',
].join('\r\n');

describe('parseEmail', () => {
  it('should parse a simple plain text email', async () => {
    const result = await parseEmail(SIMPLE_EMAIL);

    expect(result.from).toBe('sender@example.com');
    expect(result.to).toEqual(['recipient@example.com']);
    expect(result.subject).toBe('Test Subject');
    expect(result.messageId).toBe('<test123@example.com>');
    expect(result.textBody).toContain('Hello, world!');
    expect(result.htmlBody).toBeNull();
    expect(result.attachments).toEqual([]);
    expect(result.cc).toEqual([]);
    expect(result.bcc).toEqual([]);
    expect(result.raw).toBe(SIMPLE_EMAIL);
  });

  it('should parse an HTML email', async () => {
    const result = await parseEmail(HTML_EMAIL);

    expect(result.subject).toBe('HTML Email');
    expect(result.htmlBody).toContain('<p>Hello, world!</p>');
  });

  it('should parse multipart email with attachments', async () => {
    const result = await parseEmail(MULTIPART_EMAIL);

    expect(result.from).toBe('sender@example.com');
    expect(result.to).toEqual(['alice@example.com', 'bob@example.com']);
    expect(result.cc).toEqual(['carol@example.com']);
    expect(result.subject).toBe('Multipart Test');
    expect(result.textBody).toContain('Plain text body');
    expect(result.htmlBody).toContain('<p>HTML body</p>');

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0].filename).toBe('test.txt');
    expect(result.attachments[0].contentType).toBeDefined();
    expect(result.attachments[0].content).toBeDefined();
  });

  it('should handle missing fields gracefully', async () => {
    const minimal = ['From: a@b.com', '', 'body'].join('\r\n');
    const result = await parseEmail(minimal);

    expect(result.from).toBe('a@b.com');
    expect(result.to).toEqual([]);
    expect(result.subject).toBe('');
    expect(result.messageId).toBeNull();
  });

  it('should populate headers', async () => {
    const result = await parseEmail(SIMPLE_EMAIL);
    expect(result.headers).toBeDefined();
    expect(result.headers['subject']).toBe('Test Subject');
  });
});
