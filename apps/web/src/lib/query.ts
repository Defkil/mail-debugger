import { QueryClient } from '@tanstack/svelte-query';
import { listEmails, getEmail, getHealth } from './api';
import type { EmailFilter } from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2000,
      refetchInterval: 3000,
      retry: 1,
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

export function emailListOptions(filter?: EmailFilter, limit?: number, offset?: number) {
  return {
    queryKey: queryKeys.emails.list(filter, limit, offset),
    queryFn: () => listEmails(filter, limit, offset),
  };
}

export function emailDetailOptions(id: number) {
  return {
    queryKey: queryKeys.emails.detail(id),
    queryFn: () => getEmail(id),
    refetchInterval: false as const,
  };
}

export function healthOptions() {
  return {
    queryKey: queryKeys.health,
    queryFn: getHealth,
    refetchInterval: 10000,
  };
}
