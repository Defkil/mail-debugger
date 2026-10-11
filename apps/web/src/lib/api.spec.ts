import { api, setApiToken } from './api';

describe('api', () => {
  afterEach(() => {
    setApiToken('');
    vi.restoreAllMocks();
  });

  it('sends the token from memory as a bearer header, not in the URL', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => Response.json({ data: [], total: 0 }));

    await api.listEmails();
    setApiToken('  secret-token  ');
    await api.listEmails();

    const [first, second] = fetch.mock.calls;
    expect(new Headers(first[1]?.headers).has('authorization')).toBe(false);
    expect(String(second[0])).toBe('/api/emails');
    expect(new Headers(second[1]?.headers).get('authorization')).toBe(
      'Bearer secret-token',
    );
  });
});
