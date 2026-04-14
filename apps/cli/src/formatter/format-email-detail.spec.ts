import { formatEmailDetail } from './format-email-detail';
import type { Email } from '../types';

const mockEmail: Email = {
  id: 1,
  messageId: '<test@example.com>',
  from: 'sender@example.com',
  to: ['recipient@example.com'],
  cc: [],
  bcc: [],
  subject: 'Test Subject',
  textBody: 'Hello World',
  htmlBody: null,
  raw: 'raw',
  headers: {},
  attachments: [],
  receivedAt: '2025-01-01T00:00:00Z',
};

describe('formatEmailDetail', () => {
  it('should include basic email fields', () => {
    const output = formatEmailDetail(mockEmail);

    expect(output).toContain('ID:         1');
    expect(output).toContain('From:       sender@example.com');
    expect(output).toContain('To:         recipient@example.com');
    expect(output).toContain('Subject:    Test Subject');
  });

  it('should include text body', () => {
    const output = formatEmailDetail(mockEmail);
    expect(output).toContain('--- Body ---');
    expect(output).toContain('Hello World');
  });

  it('should fall back to HTML body when no text body', () => {
    const htmlEmail = {
      ...mockEmail,
      textBody: null,
      htmlBody: '<p>HTML content</p>',
    };
    const output = formatEmailDetail(htmlEmail);
    expect(output).toContain('--- Body (HTML) ---');
    expect(output).toContain('<p>HTML content</p>');
  });

  it('should show "(no body)" when neither text nor HTML', () => {
    const noBody = { ...mockEmail, textBody: null, htmlBody: null };
    const output = formatEmailDetail(noBody);
    expect(output).toContain('(no body)');
  });

  it('should include CC and BCC when present', () => {
    const withCC = {
      ...mockEmail,
      cc: ['cc@example.com'],
      bcc: ['bcc@example.com'],
    };
    const output = formatEmailDetail(withCC);
    expect(output).toContain('CC:         cc@example.com');
    expect(output).toContain('BCC:        bcc@example.com');
  });

  it('should omit CC/BCC when empty', () => {
    const output = formatEmailDetail(mockEmail);
    expect(output).not.toContain('CC:');
    expect(output).not.toContain('BCC:');
  });

  it('should include Message-ID when present', () => {
    const output = formatEmailDetail(mockEmail);
    expect(output).toContain('Message-ID: <test@example.com>');
  });

  it('should include attachments when present', () => {
    const withAtt = {
      ...mockEmail,
      attachments: [
        {
          filename: 'doc.pdf',
          contentType: 'application/pdf',
          size: 1024,
          content: '',
        },
      ],
    };
    const output = formatEmailDetail(withAtt);
    expect(output).toContain('--- Attachments ---');
    expect(output).toContain('doc.pdf');
    expect(output).toContain('application/pdf');
    expect(output).toContain('1024 bytes');
  });
});
