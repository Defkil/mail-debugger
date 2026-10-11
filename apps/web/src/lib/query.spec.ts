import { emailDetailOptions, emailListOptions, queryKeys } from './query';
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
