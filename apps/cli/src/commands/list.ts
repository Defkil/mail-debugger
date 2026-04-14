import type { ApiClient } from '@mail-debugger/api-client';
import type { EmailFilter } from '@mail-debugger/types';
import { formatEmailTable } from '../formatter/format-email-table.js';

export async function listCommand(
  client: ApiClient,
  filter?: EmailFilter,
  json?: boolean,
): Promise<void> {
  const { data: emails } = await client.listEmails(filter);

  if (json) {
    console.log(JSON.stringify(emails, null, 2));
  } else {
    console.log(formatEmailTable(emails));
  }
}
