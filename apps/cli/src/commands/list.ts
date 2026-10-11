import type { ApiClient, ListEmailsQuery } from '@mail-debugger/client';
import { formatEmailTable } from '../formatter/format-email-table.js';

export async function listCommand(
  client: ApiClient,
  query: ListEmailsQuery = {},
  json?: boolean,
): Promise<void> {
  const { data: emails } = await client.listEmails(query);

  if (json) {
    console.log(JSON.stringify(emails, null, 2));
  } else {
    console.log(formatEmailTable(emails));
  }
}
