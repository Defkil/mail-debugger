const textEncoder = new TextEncoder();

export interface SizedContent {
  raw: Uint8Array;
  textBody: string | null;
  htmlBody: string | null;
  /** Decoded sizes of the attachments in bytes. */
  attachmentSizes: number[];
}

/**
 * Bytes a message occupies in storage for the `--max-storage-bytes` limit:
 * the raw source plus the decoded bodies and attachments kept next to it.
 */
export function storedSize(content: SizedContent): number {
  return (
    content.raw.byteLength +
    utf8Length(content.textBody) +
    utf8Length(content.htmlBody) +
    content.attachmentSizes.reduce((sum, size) => sum + size, 0)
  );
}

function utf8Length(value: string | null): number {
  return value ? textEncoder.encode(value).byteLength : 0;
}
