import type { ApiClient } from '../api/client.js';
import { formatEmailDetail } from '../formatter/format-email-detail.js';

export async function showCommand(
  client: ApiClient,
  id: number,
  json?: boolean
): Promise<void> {
  const email = await client.getEmail(id);

  if (json) {
    console.log(JSON.stringify(email, null, 2));
  } else {
    console.log(formatEmailDetail(email));
  }
}
