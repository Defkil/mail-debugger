// Compiled in a project that installed mail-debugger from its tarball, once
// with NodeNext and Node types and once with Bundler and the DOM library.
import {
  createApiClient,
  MailDebuggerApiError,
  type Email,
  type EmailSummary,
  type WaitResult,
} from 'mail-debugger/client';

const client = createApiClient('http://127.0.0.1:3000', { timeoutMs: 1000 });

export async function read(): Promise<number> {
  const page = await client.listEmails({ subject: 'welcome' }, 10, 0);
  const first: EmailSummary | undefined = page.data[0];
  const email: Email = await client.getEmail(first?.id ?? 1);
  const raw: Uint8Array = await client.getRawEmail(email.id);
  const wait: WaitResult = await client.waitForEmail({
    afterId: page.highWatermark ?? 0,
    timeoutMs: 1000,
  });
  const attachment = await client.getAttachment(email.id, 0);
  return raw.byteLength + attachment.bytes.byteLength + (wait.data?.id ?? 0);
}

export function status(error: unknown): number | undefined {
  return error instanceof MailDebuggerApiError ? error.status : undefined;
}
