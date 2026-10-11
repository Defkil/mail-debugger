import { formatEmailTable } from './format-email-table.js';
import type { EmailSummary } from '@mail-debugger/client';

// eslint-disable-next-line no-control-regex -- the test looks for control characters
const CONTROL = /[\u{0}-\u{8}\u{B}-\u{1F}\u{7F}-\u{9F}]/u;

const mockSummary: EmailSummary = {
  id: 1,
  from: 'sender@example.com',
  to: ['recipient@example.com'],
  subject: 'Test Subject',
  receivedAt: '2025-01-01T00:00:00Z',
  hasAttachments: false,
};

describe('formatEmailTable', () => {
  it('should return "No emails found." for empty list', () => {
    expect(formatEmailTable([])).toBe('No emails found.');
  });

  it('should render header, separator, and row', () => {
    const output = formatEmailTable([mockSummary]);
    const lines = output.split('\n');

    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('ID');
    expect(lines[0]).toContain('From');
    expect(lines[0]).toContain('Subject');
    expect(lines[0]).toContain('Date');
    expect(lines[1]).toMatch(/^-+$/);
    expect(lines[2]).toContain('1');
    expect(lines[2]).toContain('sender@example.com');
    expect(lines[2]).toContain('Test Subject');
  });

  it('should show "Yes" for emails with attachments', () => {
    const withAtt = { ...mockSummary, hasAttachments: true };
    const output = formatEmailTable([withAtt]);
    const row = output.split('\n', 3)[2];
    expect(row).toContain('Yes');
  });

  it('should render multiple rows', () => {
    const emails = [mockSummary, { ...mockSummary, id: 2, subject: 'Another' }];
    const lines = formatEmailTable(emails).split('\n');
    expect(lines.length).toBe(4);
  });

  it('replaces control characters of the sender and subject', () => {
    const output = formatEmailTable([
      {
        ...mockSummary,
        from: 'a\u{1B}[31m@example.com',
        subject: 'line\nbreak\u{7}',
      },
    ]);
    expect(output).not.toMatch(CONTROL);
    expect(output).toContain('line break\u{FFFD}');
  });
});
