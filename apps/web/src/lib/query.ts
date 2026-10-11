import { QueryClient } from '@tanstack/svelte-query';
import { MailDebuggerApiError, type EmailFilter } from '@mail-debugger/client';
import { api } from './api';

/** The answer of a server that requires an API token the tab does not have. */
export function isUnauthorized(error: unknown): boolean {
  return error instanceof MailDebuggerApiError && error.status === 401;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2000,
      refetchInterval: 3000,
      // A missing token does not fix itself; the login form asks for it.
      retry: (failures, error) => failures < 1 && !isUnauthorized(error),
      refetchOnWindowFocus: true,
    },
  },
});

export const queryKeys = {
  emails: {
    all: ['emails'] as const,
    list: (filter?: EmailFilter, limit?: number, offset?: number) =>
      ['emails', 'list', filter ?? {}, limit, offset] as const,
    detail: (id: number) => ['emails', 'detail', id] as const,
  },
  health: ['health'] as const,
};

export function emailListOptions(
  filter?: EmailFilter,
  limit?: number,
  offset?: number,
) {
  return {
    queryKey: queryKeys.emails.list(filter, limit, offset),
    queryFn: () => api.listEmails(filter, limit, offset),
  };
}

export function emailDetailOptions(id: number) {
  return {
    queryKey: queryKeys.emails.detail(id),
    queryFn: () => api.getEmail(id),
    refetchInterval: false as const,
  };
}

export function healthOptions() {
  return {
    queryKey: queryKeys.health,
    queryFn: () => api.health(),
    refetchInterval: 10_000,
  };
}
