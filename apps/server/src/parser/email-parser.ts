import { simpleParser, type AddressObject } from 'mailparser';
import type { ParsedEmail, AttachmentMeta } from '../types.js';

function extractAddresses(
  value: AddressObject | AddressObject[] | undefined
): string[] {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((group) =>
    group.value.map((addr) => addr.address ?? '')
  );
}

export async function parseEmail(raw: string): Promise<ParsedEmail> {
  const parsed = await simpleParser(raw);

  const attachments: AttachmentMeta[] = (parsed.attachments ?? []).map(
    (att) => ({
      filename: att.filename ?? null,
      size: att.size,
      contentType: att.contentType,
      content: att.content.toString('base64'),
    })
  );

  const headers: Record<string, string> = {};
  parsed.headers.forEach((value, key) => {
    headers[key] = typeof value === 'string' ? value : String(value);
  });

  const fromAddr =
    parsed.from?.value?.[0]?.address ?? parsed.from?.text ?? '';

  return {
    messageId: parsed.messageId ?? null,
    from: fromAddr,
    to: extractAddresses(parsed.to),
    cc: extractAddresses(parsed.cc),
    bcc: extractAddresses(parsed.bcc),
    subject: parsed.subject ?? '',
    textBody: parsed.text || null,
    htmlBody: parsed.html || null,
    raw,
    headers,
    attachments,
  };
}
