import {
  createApiClient,
  dispositionFilename,
  normalizeBaseUrl,
} from './api-client.js';
import {
  MailDebuggerApiError,
  MailDebuggerNetworkError,
  MailDebuggerTimeoutError,
} from './errors.js';
import type { Email, EmailSummary, HealthResponse } from './types.js';

const BASE = 'http://mail.test:3000';

const summary: EmailSummary = {
  id: 1,
  from: 'sender@example.com',
  to: ['recipient@example.com'],
  subject: 'Test Subject',
  receivedAt: '2026-01-01T00:00:00.000Z',
  hasAttachments: false,
};

const email: Email = {
  ...summary,
  messageId: '<test@example.com>',
  cc: [],
  bcc: [],
  textBody: 'Hello World',
  htmlBody: null,
  raw: 'Subject: Test Subject\r\n\r\nHello World',
  headers: { subject: 'Test Subject' },
  attachments: [],
};

const health: HealthResponse = {
  status: 'ok',
  version: '0.4.0',
  smtpPort: 2525,
  apiPort: 3000,
  persistent: false,
  emailCount: 5,
};

interface Call {
  url: URL;
  init: RequestInit;
}

type Route = (call: Call) => Response | Promise<Response>;

/** A fetch stub that records requests and answers them with `route`. */
function stubFetch(route: Route = () => Response.json({})) {
  const calls: Call[] = [];
  const fetch = vi.fn(
    async (input: string | URL | Request, init: RequestInit = {}) => {
      const call = { url: new URL(String(input)), init };
      calls.push(call);
      return route(call);
    },
  );
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

/** A fetch that never answers but honours the abort signal. */
const hangingFetch: typeof globalThis.fetch = (_input, init = {}) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
  });

/** The rejection reason of a promise that must reject. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject');
}

describe('normalizeBaseUrl', () => {
  it('trims trailing slashes and keeps proxy prefixes', () => {
    expect(normalizeBaseUrl('http://host:4000///')).toBe('http://host:4000');
    expect(normalizeBaseUrl('https://proxy.example/mail/')).toBe(
      'https://proxy.example/mail',
    );
    expect(normalizeBaseUrl('')).toBe('');
  });

  it.each([
    'localhost:3000',
    'ftp://host',
    'http://host/?x=1',
    'not a url',
    'http://user:secret@host',
  ])('rejects %j', (url) => {
    expect(() => normalizeBaseUrl(url)).toThrow(TypeError);
  });
});

describe('createApiClient', () => {
  it('fetches the health status', async () => {
    const { fetch, calls } = stubFetch(() => Response.json(health));
    const client = createApiClient(BASE, { fetch });

    await expect(client.health()).resolves.toEqual(health);
    expect(calls[0].url.href).toBe(`${BASE}/api/health`);
    expect(calls[0].init.method).toBe('GET');
  });

  it('uses relative URLs for same-origin requests', async () => {
    const calls: string[] = [];
    const client = createApiClient('', {
      fetch: async (input) => {
        calls.push(String(input));
        return Response.json({ data: [], total: 0 });
      },
    });
    await client.listEmails();
    expect(calls).toEqual(['/api/emails']);
  });

  describe('listEmails', () => {
    it('keeps the positional filter, limit and offset arguments', async () => {
      const page = {
        data: [summary],
        total: 1,
        highWatermark: 7,
        mailboxId: 'm1',
      };
      const { fetch, calls } = stubFetch(() => Response.json(page));
      const client = createApiClient(BASE, { fetch });

      await expect(
        client.listEmails({ from: 'alice@test.com', subject: 'hello' }, 10, 20),
      ).resolves.toEqual(page);
      expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({
        from: 'alice@test.com',
        subject: 'hello',
        limit: '10',
        offset: '20',
      });
    });

    it('accepts a query object', async () => {
      const { fetch, calls } = stubFetch(() =>
        Response.json({ data: [], total: 0 }),
      );
      const client = createApiClient(BASE, { fetch });

      await client.listEmails({ filter: { to: 'bob' }, offset: 5 });
      expect(calls[0].url.search).toBe('?to=bob&offset=5');
    });

    it('rejects invalid paging without a request', async () => {
      const { fetch, calls } = stubFetch();
      const client = createApiClient(BASE, { fetch });

      await expect(client.listEmails(undefined, 0)).rejects.toThrow(TypeError);
      await expect(client.listEmails({ offset: -1 })).rejects.toThrow(
        TypeError,
      );
      expect(calls).toHaveLength(0);
    });
  });

  describe('getEmail', () => {
    it('unwraps the email', async () => {
      const { fetch, calls } = stubFetch(() => Response.json({ data: email }));
      const client = createApiClient(BASE, { fetch });

      await expect(client.getEmail(1)).resolves.toEqual(email);
      expect(calls[0].url.pathname).toBe('/api/emails/1');
    });

    it('turns a structured error into a MailDebuggerApiError', async () => {
      const { fetch } = stubFetch(() =>
        Response.json(
          { error: { code: 'EMAIL_NOT_FOUND', message: 'Email not found' } },
          { status: 404 },
        ),
      );
      const client = createApiClient(BASE, { fetch });

      const error = await rejectionOf(client.getEmail(99));
      expect(error).toBeInstanceOf(MailDebuggerApiError);
      expect(error).toMatchObject({
        message: 'Email not found',
        status: 404,
        code: 'EMAIL_NOT_FOUND',
        method: 'GET',
        url: `${BASE}/api/emails/99`,
      });
    });

    it('reads the string error body of 0.3 servers', async () => {
      const { fetch } = stubFetch(() =>
        Response.json({ error: 'Email not found' }, { status: 404 }),
      );
      const client = createApiClient(BASE, { fetch });

      await expect(client.getEmail(9)).rejects.toMatchObject({
        message: 'Email not found',
        code: 'HTTP_404',
      });
    });

    it('keeps an excerpt of non-JSON error pages', async () => {
      const { fetch } = stubFetch(
        () => new Response(`<html>${'x'.repeat(2000)}</html>`, { status: 502 }),
      );
      const client = createApiClient(BASE, { fetch });

      const error = (await rejectionOf(
        client.getEmail(1),
      )) as MailDebuggerApiError;
      expect(error.message).toBe('HTTP 502');
      expect(error.code).toBe('HTTP_502');
      expect(error.body?.length).toBeLessThanOrEqual(501);
    });

    it.each([0, -1, 1.5, NaN])(
      'rejects the id %s without a request',
      async (id) => {
        const { fetch, calls } = stubFetch();
        const client = createApiClient(BASE, { fetch });

        await expect(client.getEmail(id)).rejects.toThrow(TypeError);
        expect(calls).toHaveLength(0);
      },
    );
  });

  describe('response validation', () => {
    it.each([
      [
        'malformed JSON',
        () =>
          new Response('{', {
            headers: { 'content-type': 'application/json' },
          }),
      ],
      [
        'a non-JSON success',
        () =>
          new Response('<html>', { headers: { 'content-type': 'text/html' } }),
      ],
      ['an unexpected shape', () => Response.json({ items: [] })],
    ])('rejects %s as INVALID_RESPONSE', async (_name, respond) => {
      const { fetch } = stubFetch(respond);
      const client = createApiClient(BASE, { fetch });

      await expect(client.listEmails()).rejects.toMatchObject({
        name: 'MailDebuggerApiError',
        code: 'INVALID_RESPONSE',
      });
    });

    it.each([
      ...Object.keys(summary).map((field): [string, unknown] => [
        `summary ${field}`,
        { ...summary, [field]: undefined },
      ]),
      ['a non-object summary', null],
      ['a zero id', { ...summary, id: 0 }],
      ['a fractional id', { ...summary, id: 1.5 }],
      ['a non-string recipient', { ...summary, to: [1] }],
    ])(
      'rejects malformed %s in a list and wait result',
      async (_name, data) => {
        const { fetch } = stubFetch(({ url }) =>
          url.pathname.endsWith('/wait')
            ? Response.json({
                data,
                timedOut: false,
                highWatermark: 1,
                mailboxId: 'm1',
              })
            : Response.json({ data: [data], total: 1 }),
        );
        const client = createApiClient(BASE, { fetch });
        await expect(client.listEmails()).rejects.toMatchObject({
          code: 'INVALID_RESPONSE',
        });
        await expect(
          client.waitForEmail({ afterId: 0, timeoutMs: 0 }),
        ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
      },
    );

    it.each([
      ...[
        'id',
        'from',
        'to',
        'subject',
        'receivedAt',
        'messageId',
        'cc',
        'bcc',
        'textBody',
        'htmlBody',
        'raw',
        'headers',
        'attachments',
      ].map((field): [string, unknown] => [
        `missing ${field}`,
        { ...email, [field]: undefined },
      ]),
      ['a non-object email', null],
      ['a non-string header', { ...email, headers: { subject: 1 } }],
      ['a non-object attachment', { ...email, attachments: [null] }],
      ...['filename', 'size', 'contentType', 'content'].map(
        (field): [string, unknown] => [
          `attachment ${field}`,
          {
            ...email,
            attachments: [
              {
                filename: null,
                size: 1,
                contentType: 'text/plain',
                content: 'AA==',
                [field]: undefined,
              },
            ],
          },
        ],
      ),
      ['a null envelope', { ...email, envelope: null }],
      [
        'a malformed envelope sender',
        { ...email, envelope: { from: 1, to: [] } },
      ],
      [
        'a malformed envelope recipient',
        { ...email, envelope: { from: null, to: [1] } },
      ],
    ])(
      'rejects %s rather than asserting an Email type',
      async (_name, data) => {
        const client = createApiClient(BASE, {
          fetch: stubFetch(() => Response.json({ data })).fetch,
        });
        await expect(client.getEmail(1)).rejects.toMatchObject({
          code: 'INVALID_RESPONSE',
        });
      },
    );

    it.each([
      ...['status', 'smtpPort', 'apiPort', 'persistent', 'emailCount'].map(
        (field): [string, unknown] => [
          `missing ${field}`,
          { ...health, [field]: undefined },
        ],
      ),
      ['a non-object health result', null],
      ['a negative count', { ...health, emailCount: -1 }],
      ['an invalid version', { ...health, version: 1 }],
      ['an invalid IMAP port', { ...health, imapPort: '143' }],
      ['an invalid MCP flag', { ...health, mcp: 'true' }],
    ])('rejects health with %s', async (_name, body) => {
      const client = createApiClient(BASE, {
        fetch: stubFetch(() => Response.json(body)).fetch,
      });
      await expect(client.health()).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    });

    it('accepts complete optional metadata and legacy omissions', async () => {
      const client = createApiClient(BASE, {
        fetch: stubFetch(({ url }) => {
          if (url.pathname.endsWith('/health'))
            return Response.json({
              ...health,
              version: undefined,
              imapPort: 143,
              mcp: true,
            });
          return Response.json({
            data: {
              ...email,
              envelope: { from: null, to: ['bcc@example.test'] },
              attachments: [
                {
                  filename: 'a.txt',
                  size: 1,
                  contentType: 'text/plain',
                  content: 'AA==',
                },
              ],
            },
          });
        }).fetch,
      });
      await expect(client.health()).resolves.toMatchObject({
        imapPort: 143,
        mcp: true,
      });
      await expect(client.getEmail(1)).resolves.toMatchObject({
        envelope: { from: null },
      });
    });

    it.each([
      { data: [], total: -1 },
      { data: [], total: 0, highWatermark: -1 },
      { data: [], total: 0, mailboxId: 1 },
      { data: {}, total: 0 },
    ])(
      'rejects invalid page counters and cursor metadata: %j',
      async (body) => {
        const client = createApiClient(BASE, {
          fetch: stubFetch(() => Response.json(body)).fetch,
        });
        await expect(client.listEmails()).rejects.toMatchObject({
          code: 'INVALID_RESPONSE',
        });
      },
    );

    it.each([
      { data: null, timedOut: false, highWatermark: 0, mailboxId: 'm1' },
      { data: summary, timedOut: true, highWatermark: 1, mailboxId: 'm1' },
      { data: null, timedOut: true, highWatermark: -1, mailboxId: 'm1' },
      { data: null, timedOut: true, highWatermark: 0, mailboxId: null },
    ])('rejects an inconsistent wait result: %j', async (body) => {
      const client = createApiClient(BASE, {
        fetch: stubFetch(() => Response.json(body)).fetch,
      });
      await expect(
        client.waitForEmail({ afterId: 0, timeoutMs: 0 }),
      ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    });

    it('rejects invalid deletion responses', async () => {
      const client = createApiClient(BASE, {
        fetch: stubFetch(() => Response.json({ deleted: -1 })).fetch,
      });
      await expect(client.deleteEmail(1)).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
      await expect(client.deleteAllEmails()).rejects.toMatchObject({
        code: 'INVALID_RESPONSE',
      });
    });
  });

  describe('deletion', () => {
    it('deletes one email', async () => {
      const { fetch, calls } = stubFetch(() =>
        Response.json({ deleted: true }),
      );
      const client = createApiClient(BASE, { fetch });

      await expect(client.deleteEmail(1)).resolves.toBe(true);
      expect(calls[0].init.method).toBe('DELETE');
    });

    it('reports a missing email as a 404 error', async () => {
      const { fetch } = stubFetch(() =>
        Response.json(
          { error: { code: 'EMAIL_NOT_FOUND', message: 'Email not found' } },
          { status: 404 },
        ),
      );
      const client = createApiClient(BASE, { fetch });

      await expect(client.deleteEmail(9)).rejects.toMatchObject({
        status: 404,
      });
    });

    it('deletes all emails and returns the count', async () => {
      const { fetch, calls } = stubFetch(() => Response.json({ deleted: 3 }));
      const client = createApiClient(BASE, { fetch });

      await expect(client.deleteAllEmails()).resolves.toBe(3);
      expect(calls[0].url.pathname).toBe('/api/emails');
      expect(calls[0].init.method).toBe('DELETE');
    });
  });

  describe('authentication and headers', () => {
    it('does not reveal invalid Authorization headers in request errors', async () => {
      const { fetch, calls } = stubFetch();
      const client = createApiClient(BASE, {
        fetch,
        headers: { authorization: 'Bearer secret\0token' },
      });
      const error = await rejectionOf(client.health());
      expect(error).toBeInstanceOf(MailDebuggerNetworkError);
      expect(error).toMatchObject({
        message: expect.stringContaining('invalid HTTP header'),
      });
      expect((error as Error).message).not.toContain('secret');
      expect(calls).toHaveLength(0);
    });

    it.each([
      '',
      'secret\0token',
      'secret\u{1B}token',
      'secret token',
      'secret\u{1F512}token',
    ])(
      'rejects an invalid token without exposing it or fetching',
      async (token) => {
        const { fetch, calls } = stubFetch();
        const client = createApiClient(BASE, { fetch, token });
        const error = await rejectionOf(client.health());
        expect(error).toBeInstanceOf(MailDebuggerNetworkError);
        expect(error).toMatchObject({
          message: expect.stringContaining('visible ASCII'),
        });
        expect((error as Error).message).not.toContain('secret');
        expect(calls).toHaveLength(0);
      },
    );

    it('sends static headers and a static token', async () => {
      const { fetch, calls } = stubFetch(() => Response.json(health));
      const headers = { 'x-test': '1' };
      const client = createApiClient(BASE, { fetch, headers, token: 'secret' });

      await client.health();
      const sent = new Headers(calls[0].init.headers);
      expect(sent.get('x-test')).toBe('1');
      expect(sent.get('authorization')).toBe('Bearer secret');
      expect(headers).toEqual({ 'x-test': '1' });
    });

    it('asks header and token callbacks on every request', async () => {
      const { fetch, calls } = stubFetch(() => Response.json(health));
      let token = 'first';
      const client = createApiClient(BASE, {
        fetch,
        token: () => token,
        headers: async () => ({ 'x-request': token }),
      });

      await client.health();
      token = 'second';
      await client.health();
      expect(
        calls.map((call) =>
          new Headers(call.init.headers).get('authorization'),
        ),
      ).toEqual(['Bearer first', 'Bearer second']);
    });
  });

  describe('timeouts, aborts and network errors', () => {
    it('times out after the configured time', async () => {
      const client = createApiClient(BASE, {
        fetch: hangingFetch,
        timeoutMs: 20,
      });

      const error = await rejectionOf(client.health());
      expect(error).toBeInstanceOf(MailDebuggerTimeoutError);
      expect(error).toMatchObject({ timeoutMs: 20, method: 'GET' });
    });

    it('lets a request override the timeout', async () => {
      const client = createApiClient(BASE, {
        fetch: hangingFetch,
        timeoutMs: 10_000,
      });

      await expect(client.health({ timeoutMs: 10 })).rejects.toBeInstanceOf(
        MailDebuggerTimeoutError,
      );
    });

    it('rejects with the caller abort reason', async () => {
      const client = createApiClient(BASE, { fetch: hangingFetch });
      const controller = new AbortController();

      const pending = client.health({ signal: controller.signal });
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      await expect(
        client.health({ signal: controller.signal }),
      ).rejects.toMatchObject({
        name: 'AbortError',
      });
    });

    it.each(['headers', 'token'] as const)(
      'cancels while an asynchronous %s callback is pending, without fetching',
      async (source) => {
        const fetch = vi.fn<typeof globalThis.fetch>();
        const reason = new Error('cancelled during credential lookup');
        const controller = new AbortController();
        const pendingSource = new Promise<string>(() => {
          // A stalled credential provider must not prevent cancellation.
        });
        const client = createApiClient(BASE, {
          fetch,
          ...(source === 'headers'
            ? {
                headers: async () => {
                  await pendingSource;
                  return {};
                },
              }
            : { token: () => pendingSource }),
        });

        const pending = client.health({ signal: controller.signal });
        controller.abort(reason);
        await expect(pending).rejects.toBe(reason);
        expect(fetch).not.toHaveBeenCalled();
      },
    );

    it('includes a stalled credential lookup in the request timeout', async () => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      const client = createApiClient(BASE, {
        fetch,
        token: () =>
          new Promise(() => {
            /* The provider never answers. */
          }),
        timeoutMs: 10,
      });
      await expect(client.health()).rejects.toBeInstanceOf(
        MailDebuggerTimeoutError,
      );
      expect(fetch).not.toHaveBeenCalled();
    });

    it('wraps connection failures', async () => {
      const cause = new TypeError('fetch failed', {
        cause: new Error('connect ECONNREFUSED 127.0.0.1:3000'),
      });
      const client = createApiClient(BASE, {
        fetch: async () => {
          throw cause;
        },
      });

      const error = await rejectionOf(client.health());
      expect(error).toBeInstanceOf(MailDebuggerNetworkError);
      expect(error).toMatchObject({
        cause,
        url: `${BASE}/api/health`,
        message: `GET ${BASE}/api/health failed: fetch failed (connect ECONNREFUSED 127.0.0.1:3000)`,
      });
    });

    it('reports a real refused connection', async () => {
      const client = createApiClient('http://127.0.0.1:9');

      await expect(client.health()).rejects.toBeInstanceOf(
        MailDebuggerNetworkError,
      );
    });
  });

  describe('waitForEmail', () => {
    const result = {
      data: summary,
      timedOut: false,
      highWatermark: 12,
      mailboxId: 'm1',
    };

    it('sends the cursor, identity, timeout and filter', async () => {
      const { fetch, calls } = stubFetch(() => Response.json(result));
      const client = createApiClient(BASE, { fetch });

      await expect(
        client.waitForEmail({
          afterId: 11,
          mailboxId: 'm1',
          timeoutMs: 5000,
          filter: { to: 'alice@example.com' },
        }),
      ).resolves.toEqual(result);
      expect(calls[0].url.pathname).toBe('/api/emails/wait');
      expect(Object.fromEntries(calls[0].url.searchParams)).toEqual({
        to: 'alice@example.com',
        afterId: '11',
        timeoutMs: '5000',
        mailboxId: 'm1',
      });
    });

    it('resolves a timeout as a result', async () => {
      const { fetch } = stubFetch(() =>
        Response.json({
          data: null,
          timedOut: true,
          highWatermark: 3,
          mailboxId: 'm1',
        }),
      );
      const client = createApiClient(BASE, { fetch });

      await expect(
        client.waitForEmail({ afterId: 3, timeoutMs: 0 }),
      ).resolves.toMatchObject({
        data: null,
        timedOut: true,
      });
    });

    it('gives the request more time than the server-side wait', async () => {
      const client = createApiClient(BASE, {
        timeoutMs: 10,
        fetch: async () => {
          await new Promise((resolve) => setTimeout(resolve, 60));
          return Response.json(result);
        },
      });

      await expect(
        client.waitForEmail({ afterId: 0, timeoutMs: 50 }),
      ).resolves.toEqual(result);
    });

    it('validates the parameters', async () => {
      const client = createApiClient(BASE, { fetch: stubFetch().fetch });

      await expect(client.waitForEmail({ afterId: -1 })).rejects.toThrow(
        TypeError,
      );
      await expect(
        client.waitForEmail({ afterId: 0, timeoutMs: 60_001 }),
      ).rejects.toThrow(RangeError);
    });
  });

  describe('binary downloads', () => {
    it('returns the exact raw bytes', async () => {
      const bytes = new Uint8Array([0, 1, 2, 255]);
      const { fetch, calls } = stubFetch(
        () =>
          new Response(bytes, {
            headers: { 'content-type': 'message/rfc822' },
          }),
      );
      const client = createApiClient(BASE, { fetch });

      await expect(client.getRawEmail(4)).resolves.toEqual(bytes);
      expect(calls[0].url.pathname).toBe('/api/emails/4/raw');
    });

    it('returns attachment bytes, name and type', async () => {
      const { fetch, calls } = stubFetch(
        () =>
          new Response(new Uint8Array([9, 8]), {
            headers: {
              'content-type': 'application/pdf',
              'content-disposition': `attachment; filename="report.pdf"; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf`,
            },
          }),
      );
      const client = createApiClient(BASE, { fetch });

      await expect(client.getAttachment(4, 0)).resolves.toEqual({
        bytes: new Uint8Array([9, 8]),
        filename: 'résumé.pdf',
        contentType: 'application/pdf',
      });
      expect(calls[0].url.pathname).toBe('/api/emails/4/attachments/0');
    });
  });
});

describe('dispositionFilename', () => {
  it.each([
    [null, null],
    ['attachment', null],
    [String.raw`attachment; filename="a \"b\".txt"`, 'a "b".txt'],
    ['attachment; filename=plain.txt', 'plain.txt'],
    ["attachment; filename*=UTF-8''%E2%82%AC.txt", '€.txt'],
  ])('%s -> %s', (header, expected) => {
    expect(dispositionFilename(header)).toBe(expected);
  });
});
