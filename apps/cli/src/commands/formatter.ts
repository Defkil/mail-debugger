import type { Email, EmailSummary, HealthResponse } from '../types.js';

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + ' '.repeat(len - str.length);
}

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

export function formatEmailDetail(email: Email): string {
  const lines: string[] = [];

  lines.push(`ID:         ${email.id}`);
  lines.push(`From:       ${email.from}`);
  lines.push(`To:         ${email.to.join(', ')}`);
  if (email.cc.length > 0) lines.push(`CC:         ${email.cc.join(', ')}`);
  if (email.bcc.length > 0) lines.push(`BCC:        ${email.bcc.join(', ')}`);
  lines.push(`Subject:    ${email.subject}`);
  lines.push(`Date:       ${new Date(email.receivedAt).toLocaleString()}`);
  if (email.messageId) lines.push(`Message-ID: ${email.messageId}`);
  lines.push('');

  if (email.textBody) {
    lines.push('--- Body ---');
    lines.push(email.textBody);
  } else if (email.htmlBody) {
    lines.push('--- Body (HTML) ---');
    lines.push(email.htmlBody);
  } else {
    lines.push('(no body)');
  }

  if (email.attachments.length > 0) {
    lines.push('');
    lines.push('--- Attachments ---');
    for (const att of email.attachments) {
      lines.push(
        `  ${att.filename ?? '(unnamed)'}  ${att.contentType}  ${att.size} bytes`
      );
    }
  }

  return lines.join('\n');
}

export function formatHealth(health: HealthResponse): string {
  return [
    `Status:      ${health.status}`,
    `SMTP Port:   ${health.smtpPort}`,
    `API Port:    ${health.apiPort}`,
    `Persistent:  ${health.persistent}`,
    `Email Count: ${health.emailCount}`,
  ].join('\n');
}
