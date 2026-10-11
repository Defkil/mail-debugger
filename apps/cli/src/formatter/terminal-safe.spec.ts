import type { Email } from '@mail-debugger/client';
import {
  safeEmail,
  safeSummary,
  terminalBlock,
  terminalLine,
} from './terminal-safe.js';

const ESC = '\u{1B}';
const BEL = '\u{7}';
// eslint-disable-next-line no-control-regex -- the test looks for control characters
const CONTROL = /[\u{0}-\u{8}\u{B}-\u{1F}\u{7F}-\u{9F}]/u;

describe('terminalLine', () => {
  it('replaces escape sequences, other controls and C1 characters', () => {
    expect(terminalLine(`a${ESC}]52;c;cHduZWQ=${BEL}b`)).toBe(
      'a\u{FFFD}]52;c;cHduZWQ=\u{FFFD}b',
    );
    expect(terminalLine(`${ESC}[2J\u{9B}1m\u{7F}\0`)).toBe(
      '\u{FFFD}[2J\u{FFFD}1m\u{FFFD}\u{FFFD}',
    );
  });

  it('puts the text on one line', () => {
    expect(terminalLine('one\r\ntwo\tthree\nfour')).toBe('one  two three four');
  });

  it('keeps ordinary Unicode text', () => {
    expect(terminalLine('Grüße — 你好 ✓')).toBe('Grüße — 你好 ✓');
  });
});

describe('terminalBlock', () => {
  it('keeps tabs and line feeds and normalizes CRLF', () => {
    expect(terminalBlock('a\r\nb\tc\nd')).toBe('a\nb\tc\nd');
  });

  it('replaces a lone carriage return, which could overwrite a line', () => {
    expect(terminalBlock(`safe\roverwritten${ESC}[1A`)).toBe(
      'safe\u{FFFD}overwritten\u{FFFD}[1A',
    );
  });
});

describe('safeSummary and safeEmail', () => {
  const hostile = `x${ESC}]0;title${BEL}`;
  const email: Email = {
    id: 3,
    messageId: `<${hostile}@example.test>`,
    from: hostile,
    to: [hostile],
    cc: [hostile],
    bcc: [hostile],
    subject: hostile,
    textBody: `line\r\n${hostile}`,
    htmlBody: `<p>${hostile}</p>`,
    raw: hostile,
    headers: { subject: hostile },
    attachments: [
      { filename: hostile, contentType: hostile, size: 1, content: 'AA==' },
    ],
    receivedAt: '2026-10-11T10:00:00.000Z',
  };

  it('cleans every displayed text of an email', () => {
    const safe = safeEmail(email);
    const displayed = [
      safe.messageId,
      safe.from,
      ...safe.to,
      ...safe.cc,
      ...safe.bcc,
      safe.subject,
      safe.textBody,
      safe.htmlBody,
      safe.attachments[0]?.filename,
      safe.attachments[0]?.contentType,
    ];
    for (const text of displayed) expect(text).not.toMatch(CONTROL);
    expect(safe.textBody).toBe('line\nx\u{FFFD}]0;title\u{FFFD}');
    expect(safe).toMatchObject({ id: 3, raw: hostile, headers: email.headers });
    expect(email.from).toBe(hostile);
  });

  it('keeps null fields null', () => {
    const safe = safeEmail({
      ...email,
      messageId: null,
      textBody: null,
      htmlBody: null,
      attachments: [{ ...email.attachments[0], filename: null }],
    } as Email);
    expect(safe).toMatchObject({
      messageId: null,
      textBody: null,
      htmlBody: null,
      attachments: [{ filename: null }],
    });
  });

  it('cleans the texts of a summary', () => {
    const safe = safeSummary({
      id: 3,
      from: hostile,
      to: [hostile],
      subject: hostile,
      receivedAt: email.receivedAt,
      hasAttachments: true,
    });
    for (const text of [safe.from, ...safe.to, safe.subject]) {
      expect(text).not.toMatch(CONTROL);
    }
    expect(safe.id).toBe(3);
  });
});
