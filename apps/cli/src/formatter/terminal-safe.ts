import type { Email, EmailSummary } from '@mail-debugger/client';

// Captured mail is untrusted. Printed as it is, an escape sequence in a
// subject or body could move the cursor, rewrite earlier output, retitle
// the window or write to the clipboard. These helpers turn every control
// character (C0, DEL and C1) into U+FFFD before text reaches a terminal.

// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL = /[\u{0}-\u{1F}\u{7F}-\u{9F}]/gu;
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_EXCEPT_TAB_AND_LF = /[\u{0}-\u{8}\u{B}-\u{1F}\u{7F}-\u{9F}]/gu;

/** Text for one line: tabs and line breaks become spaces. */
export function terminalLine(text: string): string {
  return text.replaceAll(/[\t\n\r]/g, ' ').replaceAll(CONTROL, '\u{FFFD}');
}

/** Text of several lines: keeps tabs and line feeds, CRLF becomes LF. */
export function terminalBlock(text: string): string {
  return text
    .replaceAll('\r\n', '\n')
    .replaceAll(CONTROL_EXCEPT_TAB_AND_LF, '\u{FFFD}');
}

/** A copy of a summary whose texts are safe to print. */
export function safeSummary(summary: EmailSummary): EmailSummary {
  return {
    ...summary,
    from: terminalLine(summary.from),
    to: summary.to.map((address) => terminalLine(address)),
    subject: terminalLine(summary.subject),
  };
}

/**
 * A copy of an email whose displayed texts (addresses, subject, Message-ID,
 * bodies and attachment names and types) are safe to print.
 */
export function safeEmail(email: Email): Email {
  return {
    ...email,
    from: terminalLine(email.from),
    to: email.to.map((address) => terminalLine(address)),
    cc: email.cc.map((address) => terminalLine(address)),
    bcc: email.bcc.map((address) => terminalLine(address)),
    subject: terminalLine(email.subject),
    messageId: email.messageId === null ? null : terminalLine(email.messageId),
    textBody: email.textBody === null ? null : terminalBlock(email.textBody),
    htmlBody: email.htmlBody === null ? null : terminalBlock(email.htmlBody),
    attachments: email.attachments.map((attachment) => ({
      ...attachment,
      filename:
        attachment.filename === null ? null : terminalLine(attachment.filename),
      contentType: terminalLine(attachment.contentType),
    })),
  };
}
