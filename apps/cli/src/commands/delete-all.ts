import type { ApiClient } from '@mail-debugger/client';

export async function deleteAllCommand(
  client: ApiClient,
  json?: boolean,
): Promise<void> {
  const count = await client.deleteAllEmails();

  if (json) {
    console.log(JSON.stringify({ deleted: count }));
  } else {
    console.log(`Deleted ${count} email(s).`);
  }
}
