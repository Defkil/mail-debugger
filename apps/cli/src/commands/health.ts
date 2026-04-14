import type { ApiClient } from '@mail-debugger/api-client';
import { formatHealth } from '../formatter/format-health.js';

export async function healthCommand(
  client: ApiClient,
  json?: boolean,
): Promise<void> {
  const data = await client.health();

  if (json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(formatHealth(data));
  }
}
