import { simpleParser, type AddressObject } from 'mailparser';
import type { AttachmentMeta } from '@mail-debugger/client';

/** The decoded parts of a message, without its source. */
export interface ParsedContent {
  messageId: string | null;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  textBody: string | null;
  htmlBody: string | null;
  headers: Record<string, string>;
  attachments: AttachmentMeta[];
}

function extractAddresses(
  value: AddressObject | AddressObject[] | undefined,
): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((group) => group.value.map((addr) => addr.address ?? ''));
}

/** Parses the exact octets of a message. */
export async function parseEmail(raw: Uint8Array): Promise<ParsedContent> {
  const parsed = await simpleParser(
    Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength),
  );

  const attachments: AttachmentMeta[] = (parsed.attachments ?? []).map(
    (att) => ({
      filename: att.filename ?? null,
      size: att.size,
      contentType: att.contentType,
      content: att.content.toString('base64'),
    }),
  );

  const headers: Record<string, string> = {};
  for (const [key, value] of parsed.headers.entries()) {
    headers[key] = typeof value === 'string' ? value : String(value);
  }

  const fromAddr = parsed.from?.value?.[0]?.address ?? parsed.from?.text ?? '';

  return {
    messageId: parsed.messageId ?? null,
    from: fromAddr,
    to: extractAddresses(parsed.to),
    cc: extractAddresses(parsed.cc),
    bcc: extractAddresses(parsed.bcc),
    subject: parsed.subject ?? '',
    textBody: parsed.text || null,
    htmlBody: parsed.html || null,
    headers,
    attachments,
  };
}
