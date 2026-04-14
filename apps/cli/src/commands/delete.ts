import type { ApiClient } from '@mail-debugger/api-client';

export async function deleteCommand(
  client: ApiClient,
  id: number,
  json?: boolean,
): Promise<void> {
  const deleted = await client.deleteEmail(id);

  if (json) {
    console.log(JSON.stringify({ id, deleted }));
  } else {
    console.log(deleted ? `Email ${id} deleted.` : `Email ${id} not found.`);
  }
}
