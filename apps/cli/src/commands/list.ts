import type { ApiClient } from '../api/client.js';
import type { EmailFilter } from '../types.js';
import { formatEmailTable } from '../formatter/format-email-table.js';

export async function listCommand(
  client: ApiClient,
  filter?: EmailFilter,
  json?: boolean
): Promise<void> {
  const emails = await client.listEmails(filter);

  if (json) {
    console.log(JSON.stringify(emails, null, 2));
  } else {
    console.log(formatEmailTable(emails));
  }
}
