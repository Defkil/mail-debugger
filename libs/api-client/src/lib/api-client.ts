import {
  type Email,
  type EmailFilter,
  emailFilterToEntries,
  type EmailSummary,
  type HealthResponse,
  type PaginatedResponse,
} from '@mail-debugger/types';

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${baseUrl}${path}`, init);
  if (!res.ok) {
    throw new Error(errorMessage(await readJson(res)) ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

/**
 * The message of an error body: `{ error: { code, message } }` since 0.4,
 * `{ error: "message" }` before.
 */
function errorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object' || !('error' in body)) return undefined;
  const { error } = body;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object' && 'message' in error) {
    const { message } = error;
    if (typeof message === 'string' && message) return message;
  }
  return undefined;
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function buildEmailsQuery(
  filter?: EmailFilter,
  limit?: number,
  offset?: number,
): string {
  const params = new URLSearchParams(emailFilterToEntries(filter));
  if (limit != null) params.set('limit', String(limit));
  if (offset != null) params.set('offset', String(offset));
  return params.toString();
}

export function createApiClient(baseUrl: string) {
  async function listEmails(
    filter?: EmailFilter,
    limit?: number,
    offset?: number,
  ): Promise<PaginatedResponse<EmailSummary>> {
    const query = buildEmailsQuery(filter, limit, offset);
    const path = query ? `/api/emails?${query}` : '/api/emails';
    return request<PaginatedResponse<EmailSummary>>(baseUrl, path);
  }

  async function getEmail(id: number): Promise<Email> {
    const res = await request<{ data: Email }>(baseUrl, `/api/emails/${id}`);
    return res.data;
  }

  async function deleteEmail(id: number): Promise<boolean> {
    const res = await request<{ deleted: boolean }>(
      baseUrl,
      `/api/emails/${id}`,
      { method: 'DELETE' },
    );
    return res.deleted;
  }

  async function deleteAllEmails(): Promise<number> {
    const res = await request<{ deleted: number }>(baseUrl, '/api/emails', {
      method: 'DELETE',
    });
    return res.deleted;
  }

  async function health(): Promise<HealthResponse> {
    return request<HealthResponse>(baseUrl, '/api/health');
  }

  return { listEmails, getEmail, deleteEmail, deleteAllEmails, health };
}

export type ApiClient = ReturnType<typeof createApiClient>;
