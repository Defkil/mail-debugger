import { createApiClient } from '@mail-debugger/client';

let token = '';

/**
 * Sets the API token of a server started with MAIL_DEBUGGER_API_TOKEN. It
 * lives in this tab's memory only: never in storage and never in a URL.
 */
export function setApiToken(value: string): void {
  token = value.trim();
}

export const api = createApiClient('', { token: () => token || undefined });
