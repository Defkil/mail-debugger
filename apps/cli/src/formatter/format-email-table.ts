import type { EmailSummary } from '@mail-debugger/types';
import { truncate, padRight } from './text.js';

export function formatEmailTable(emails: EmailSummary[]): string {
  if (emails.length === 0) return 'No emails found.';

  const header = `${padRight('ID', 6)}${padRight('From', 30)}${padRight('Subject', 40)}${padRight('Date', 22)}Att`;
  const separator = '-'.repeat(header.length);
  const rows = emails.map((e) => {
    const date = new Date(e.receivedAt).toLocaleString();
    return (
      `${padRight(String(e.id), 6)}` +
      `${padRight(truncate(e.from, 28), 30)}` +
      `${padRight(truncate(e.subject, 38), 40)}` +
      `${padRight(date, 22)}` +
      `${e.hasAttachments ? 'Yes' : ''}`
    );
  });

  return [header, separator, ...rows].join('\n');
}
