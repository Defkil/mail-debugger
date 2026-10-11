import {
  MAX_WAIT_MS,
  type ApiClient,
  type EmailFilter,
  type WaitResult,
} from '@mail-debugger/client';
import { formatEmailTable } from '../formatter/format-email-table.js';

export interface WaitCommandOptions {
  filter?: EmailFilter;
  /** Defaults to the current high watermark: only new emails count. */
  afterId?: number;
  mailboxId?: string;
  timeoutMs: number;
}

/**
 * Waits for the first matching email above the cursor, in server requests
 * of at most {@link MAX_WAIT_MS}, and prints it. Resolves to the exit code:
 * 0 when an email arrived, 1 when the time ran out.
 */
export async function waitCommand(
  client: ApiClient,
  options: WaitCommandOptions,
  json?: boolean,
): Promise<number> {
  const deadline = Date.now() + options.timeoutMs;
  let { afterId, mailboxId } = options;
  if (afterId === undefined) {
    const cursor = await client.listEmails({ limit: 1 });
    afterId = cursor.highWatermark ?? 0;
    mailboxId ??= cursor.mailboxId;
  }

  let result: WaitResult;
  do {
    result = await client.waitForEmail({
      afterId,
      timeoutMs: Math.min(Math.max(deadline - Date.now(), 0), MAX_WAIT_MS),
      ...(mailboxId && { mailboxId }),
      ...(options.filter && { filter: options.filter }),
    });
    // Every email up to the high watermark was checked and did not match.
    afterId = result.highWatermark;
    mailboxId = result.mailboxId;
  } while (result.timedOut && Date.now() < deadline);

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.data) {
    console.log(formatEmailTable([result.data]));
  } else {
    console.error(`No matching email arrived within ${options.timeoutMs} ms.`);
  }
  return result.data ? 0 : 1;
}
