import { MailDebuggerApiError } from '@mail-debugger/client';
import {
  emailDetailOptions,
  emailListOptions,
  isUnauthorized,
  queryClient,
  queryKeys,
} from './query';
import { api } from './api';

vi.mock('./api', () => ({
  api: {
    listEmails: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getEmail: vi.fn().mockResolvedValue({ id: 7 }),
    health: vi.fn(),
  },
}));

describe('email queries', () => {
  it('keys list queries by filter and page so each page is cached separately', () => {
    const filter = { from: 'alice', subject: 'reset' };

    expect(emailListOptions(filter, 25, 50).queryKey).toEqual([
      'emails',
      'list',
      filter,
      25,
      50,
    ]);
    expect(emailListOptions(undefined, 25, 0).queryKey).toEqual([
      'emails',
      'list',
      {},
      25,
      0,
    ]);
  });

  it('passes the filter and page window to the API client', async () => {
    const filter = { to: 'bob@example.com' };

    await emailListOptions(filter, 50, 100).queryFn();

    expect(api.listEmails).toHaveBeenCalledWith(filter, 50, 100);
  });

  it('loads one email by id without polling', async () => {
    const options = emailDetailOptions(7);

    expect(options.queryKey).toEqual(['emails', 'detail', 7]);
    expect(options.refetchInterval).toBe(false);
    await expect(options.queryFn()).resolves.toEqual({ id: 7 });
    expect(api.getEmail).toHaveBeenCalledWith(7);
  });

  it('nests list and detail keys under the shared emails key for invalidation', () => {
    expect(queryKeys.emails.list().slice(0, 1)).toEqual(queryKeys.emails.all);
    expect(queryKeys.emails.detail(1).slice(0, 1)).toEqual(
      queryKeys.emails.all,
    );
  });
});

describe('isUnauthorized', () => {
  const target = { method: 'GET', url: '/api/health' };

  it('recognizes the 401 of a server that requires a token', () => {
    expect(
      isUnauthorized(
        new MailDebuggerApiError('This API requires a valid bearer token', {
          ...target,
          status: 401,
          code: 'UNAUTHORIZED',
        }),
      ),
    ).toBe(true);
    expect(
      isUnauthorized(
        new MailDebuggerApiError('Email not found', {
          ...target,
          status: 404,
          code: 'EMAIL_NOT_FOUND',
        }),
      ),
    ).toBe(false);
    expect(isUnauthorized(new Error('offline'))).toBe(false);
  });

  it('does not retry a missing token', () => {
    const retry = queryClient.getDefaultOptions().queries?.retry as (
      failures: number,
      error: unknown,
    ) => boolean;
    const unauthorized = new MailDebuggerApiError('denied', {
      ...target,
      status: 401,
      code: 'UNAUTHORIZED',
    });

    expect(retry(0, unauthorized)).toBe(false);
    expect(retry(0, new Error('offline'))).toBe(true);
    expect(retry(1, new Error('offline'))).toBe(false);
  });
});
