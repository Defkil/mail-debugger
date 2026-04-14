import type { Email, EmailSummary, EmailFilter, HealthResponse } from './types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === 'object' && 'error' in body
        ? (body as { error: string }).error
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export async function listEmails(filter?: EmailFilter): Promise<EmailSummary[]> {
  const params = new URLSearchParams();
  if (filter?.from) params.set('from', filter.from);
  if (filter?.to) params.set('to', filter.to);
  if (filter?.subject) params.set('subject', filter.subject);
  if (filter?.since) params.set('since', filter.since);
  if (filter?.until) params.set('until', filter.until);
  const query = params.toString();
  const res = await request<{ data: EmailSummary[] }>(query ? `/api/emails?${query}` : '/api/emails');
  return res.data;
}

export async function getEmail(id: number): Promise<Email> {
  const res = await request<{ data: Email }>(`/api/emails/${id}`);
  return res.data;
}

export async function deleteEmail(id: number): Promise<boolean> {
  const res = await request<{ deleted: boolean }>(`/api/emails/${id}`, { method: 'DELETE' });
  return res.deleted;
}

export async function deleteAllEmails(): Promise<number> {
  const res = await request<{ deleted: number }>('/api/emails', { method: 'DELETE' });
  return res.deleted;
}

export async function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health');
}
