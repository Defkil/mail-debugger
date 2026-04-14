import type { Email } from '@mail-debugger/types';

export function formatEmailDetail(email: Email): string {
  const lines: string[] = [
    `ID:         ${email.id}`,
    `From:       ${email.from}`,
    `To:         ${email.to.join(', ')}`,
  ];

  if (email.cc.length > 0) lines.push(`CC:         ${email.cc.join(', ')}`);
  if (email.bcc.length > 0) lines.push(`BCC:        ${email.bcc.join(', ')}`);

  lines.push(
    `Subject:    ${email.subject}`,
    `Date:       ${new Date(email.receivedAt).toLocaleString()}`,
  );

  if (email.messageId) lines.push(`Message-ID: ${email.messageId}`);
  lines.push('');

  if (email.textBody) {
    lines.push('--- Body ---', email.textBody);
  } else if (email.htmlBody) {
    lines.push('--- Body (HTML) ---', email.htmlBody);
  } else {
    lines.push('(no body)');
  }

  if (email.attachments.length > 0) {
    lines.push('', '--- Attachments ---');
    for (const att of email.attachments) {
      lines.push(
        `  ${att.filename ?? '(unnamed)'}  ${att.contentType}  ${att.size} bytes`,
      );
    }
  }

  return lines.join('\n');
}
