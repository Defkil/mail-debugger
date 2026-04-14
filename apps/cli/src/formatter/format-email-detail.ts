import type { Email } from '../types.js';

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
