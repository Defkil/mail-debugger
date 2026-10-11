// Runs in a project that installed mail-debugger from its tarball.
// Reads one email with the public client and prints what it got.
// Usage: node client-read.mjs <server URL> <email id>
import { createHash } from 'node:crypto';
import { createApiClient } from 'mail-debugger/client';

const [baseUrl, idText] = process.argv.slice(2);
const id = Number(idText);
const client = createApiClient(baseUrl);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

const email = await client.getEmail(id);
const raw = await client.getRawEmail(id);
const attachment = await client.getAttachment(id, 0);
const page = await client.listEmails();

process.stdout.write(
  JSON.stringify({
    messageId: email.messageId,
    raw: hash(raw),
    attachment: hash(attachment.bytes),
    filename: attachment.filename,
    total: page.total,
    highWatermark: page.highWatermark,
  }),
);
