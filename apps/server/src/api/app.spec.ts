import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MailStore } from '../db/store.js';
import type { MailService } from '../mail/mail-service.js';
import {
  attachmentMessage,
  createTestService,
  rawMessage,
  silentLogger,
} from '../testing/mail-fixtures.js';
import { getVersion } from '../version.js';
import { createApp } from './app.js';
import { createHttpPolicy } from './guards.js';
import { contentDisposition, safeContentType } from './routes/emails.js';

const BASE = 'http://localhost:3000';

interface AppOptions {
  apiToken?: string;
  webDir?: string;
  allowedOrigins?: string[];
}

function makeApp(service: MailService, options: AppOptions = {}) {
  const policy = createHttpPolicy({
    host: '127.0.0.1',
    port: 3000,
    allowedHosts: [],
    allowedOrigins: options.allowedOrigins ?? [],
    ...(options.apiToken && { apiToken: options.apiToken }),
  });
  return createApp({
    service,
    logger: silentLogger,
    policy: () => policy,
    info: () => ({ smtpPort: 2525, apiPort: 3000 }),
    ...(options.webDir && { webDir: options.webDir }),
  });
}

function request(pathname: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has('host')) headers.set('host', 'localhost:3000');
  return new Request(`${BASE}${pathname}`, { ...init, headers });
}

describe('HTTP app', () => {
  let service: MailService;
  let store: MailStore;
  let app: ReturnType<typeof makeApp>;

  beforeEach(async () => {
    ({ service, store } = await createTestService());
    app = makeApp(service);
  });

  afterEach(async () => {
    await store.close();
  });

  async function call(pathname: string, init?: RequestInit) {
    const response = await app.handle(request(pathname, init));
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { status: response.status, headers: response.headers, body };
  }

  describe('GET /api/emails', () => {
    it('lists emails newest first with the total', async () => {
      await service.receive(rawMessage({ subject: 'first' }), null);
      await service.receive(rawMessage({ subject: 'second' }), null);
      const { status, body } = await call('/api/emails');
      expect(status).toBe(200);
      expect(body).toMatchObject({
        total: 2,
        data: [
          { id: 2, subject: 'second' },
          { id: 1, subject: 'first' },
        ],
      });
    });

    it('filters and pages', async () => {
      await service.receive(rawMessage({ subject: 'Welcome Alice' }), null);
      await service.receive(rawMessage({ subject: 'welcome bob' }), null);
      await service.receive(rawMessage({ subject: 'Reset' }), null);
      const { body } = await call(
        '/api/emails?subject=WELCOME&limit=1&offset=1',
      );
      expect(body).toMatchObject({
        total: 2,
        data: [{ subject: 'Welcome Alice' }],
      });
    });

    it.each([
      ['/api/emails?limit=0', /limit/],
      ['/api/emails?limit=201', /limit/],
      ['/api/emails?limit=abc', /limit/],
      ['/api/emails?offset=-1', /offset/],
      ['/api/emails?since=yesterday', /since/],
      ['/api/emails?since=2026-02-01&until=2026-01-01', /after/],
    ])('answers %s with 400', async (pathname, message) => {
      const { status, body } = await call(pathname);
      expect(status).toBe(400);
      expect(body).toEqual({
        error: {
          code: 'INVALID_ARGUMENT',
          message: expect.stringMatching(message),
        },
      });
    });
  });

  describe('GET /api/emails/:id', () => {
    it('returns the email', async () => {
      await service.receive(rawMessage({ subject: 'Hi' }), {
        from: 'a@example.com',
        to: ['b@example.com'],
      });
      const { status, body } = await call('/api/emails/1');
      expect(status).toBe(200);
      expect(body).toMatchObject({
        data: {
          id: 1,
          subject: 'Hi',
          envelope: { from: 'a@example.com', to: ['b@example.com'] },
        },
      });
    });

    it('answers unknown emails with a stable 404', async () => {
      const { status, body } = await call('/api/emails/99');
      expect(status).toBe(404);
      expect(body).toEqual({
        error: { code: 'EMAIL_NOT_FOUND', message: 'Email not found' },
      });
    });

    it.each(['abc', '0', '1.5', '-1', '01', '99999999999999999999'])(
      'rejects the id %s',
      async (id) => {
        const { status, body } = await call(`/api/emails/${id}`);
        expect(status).toBe(400);
        expect(body).toMatchObject({ error: { code: 'INVALID_ARGUMENT' } });
      },
    );
  });

  describe('DELETE', () => {
    it('deletes one email or answers 404', async () => {
      await service.receive(rawMessage(), null);
      expect((await call('/api/emails/1', { method: 'DELETE' })).body).toEqual({
        deleted: true,
      });
      const missing = await call('/api/emails/1', { method: 'DELETE' });
      expect(missing.status).toBe(404);
      expect(missing.body).toMatchObject({
        error: { code: 'EMAIL_NOT_FOUND' },
      });
    });

    it('deletes all emails and returns the count', async () => {
      await service.receive(rawMessage(), null);
      await service.receive(rawMessage(), null);
      expect((await call('/api/emails', { method: 'DELETE' })).body).toEqual({
        deleted: 2,
      });
    });
  });

  describe('GET /api/emails/wait', () => {
    it('returns a stored match with the cursor', async () => {
      await service.receive(rawMessage({ subject: 'one' }), null);
      const { mailboxId } = service.cursor();
      const { status, body } = await call(
        `/api/emails/wait?afterId=0&timeoutMs=0&subject=ONE&mailboxId=${mailboxId}`,
      );
      expect(status).toBe(200);
      expect(body).toEqual({
        data: expect.objectContaining({ id: 1, subject: 'one' }),
        timedOut: false,
        highWatermark: 1,
        mailboxId,
      });
    });

    it('answers a timeout with data null', async () => {
      const { body } = await call('/api/emails/wait?afterId=0&timeoutMs=10');
      expect(body).toMatchObject({
        data: null,
        timedOut: true,
        highWatermark: 0,
      });
    });

    it('waits for an arrival', async () => {
      const pending = call('/api/emails/wait?afterId=0&timeoutMs=5000');
      await service.receive(rawMessage({ subject: 'late' }), null);
      expect((await pending).body).toMatchObject({
        data: { id: 1, subject: 'late' },
        timedOut: false,
      });
    });

    it.each([
      ['/api/emails/wait', 'INVALID_ARGUMENT'],
      ['/api/emails/wait?afterId=', 'INVALID_ARGUMENT'],
      ['/api/emails/wait?afterId=-1', 'INVALID_ARGUMENT'],
      ['/api/emails/wait?afterId=0&timeoutMs=60001', 'INVALID_ARGUMENT'],
      ['/api/emails/wait?afterId=5', 'INVALID_CURSOR'],
      ['/api/emails/wait?afterId=0&mailboxId=other', 'INVALID_CURSOR'],
    ])('answers %s with 400 %s', async (pathname, code) => {
      const { status, body } = await call(pathname);
      expect(status).toBe(400);
      expect(body).toMatchObject({ error: { code } });
    });

    it('reports the cursor in list responses', async () => {
      await service.receive(rawMessage(), null);
      service.clear('rest');
      expect((await call('/api/emails')).body).toEqual({
        data: [],
        total: 0,
        highWatermark: 1,
        mailboxId: service.cursor().mailboxId,
      });
    });
  });

  describe('downloads', () => {
    it('serves the exact source bytes', async () => {
      const raw = Buffer.concat([rawMessage(), Buffer.from([0xff, 0xfe])]);
      await service.receive(raw, null);

      const response = await app.handle(request('/api/emails/1/raw'));
      expect(response.status).toBe(200);
      expect(Object.fromEntries(response.headers)).toMatchObject({
        'content-type': 'message/rfc822',
        'content-disposition': `attachment; filename="email-1.eml"; filename*=UTF-8''email-1.eml`,
        'content-security-policy': 'sandbox',
      });
      expect(Buffer.from(await response.arrayBuffer())).toEqual(raw);
    });

    it('serves attachments with an inert type and an escaped name', async () => {
      await service.receive(
        attachmentMessage({
          filename: 'a "quoted" résumé.html',
          contentType: 'text/html',
          bytes: Buffer.from('<script>alert(1)</script>'),
        }),
        null,
      );

      const response = await app.handle(request('/api/emails/1/attachments/0'));
      expect(response.status).toBe(200);
      expect(Object.fromEntries(response.headers)).toMatchObject({
        'content-type': 'application/octet-stream',
        'content-disposition': `attachment; filename="a _quoted_ r_sum_.html"; filename*=UTF-8''a%20%22quoted%22%20r%C3%A9sum%C3%A9.html`,
        'content-security-policy': 'sandbox',
      });
      expect(await response.text()).toBe('<script>alert(1)</script>');
    });

    it.each([
      ['/api/emails/9/raw', 404, 'EMAIL_NOT_FOUND'],
      ['/api/emails/9/attachments/0', 404, 'EMAIL_NOT_FOUND'],
      ['/api/emails/1/attachments/1', 404, 'ATTACHMENT_NOT_FOUND'],
      ['/api/emails/1/attachments/-1', 400, 'INVALID_ARGUMENT'],
      ['/api/emails/1/attachments/01', 400, 'INVALID_ARGUMENT'],
      ['/api/emails/x/raw', 400, 'INVALID_ARGUMENT'],
    ])('answers %s with %i %s', async (pathname, status, code) => {
      await service.receive(
        attachmentMessage({
          filename: 'a.txt',
          contentType: 'text/plain',
          bytes: Buffer.from('a'),
        }),
        null,
      );
      const result = await call(pathname);
      expect(result.status).toBe(status);
      expect(result.body).toMatchObject({ error: { code } });
    });
  });

  it.each([
    ['application/pdf', 'application/pdf'],
    ['IMAGE/PNG; name="x.png"', 'image/png'],
    ['text/plain', 'text/plain'],
    ['text/html', 'application/octet-stream'],
    ['application/xhtml+xml', 'application/octet-stream'],
    ['image/svg+xml', 'application/octet-stream'],
    ['text/javascript', 'application/octet-stream'],
    ['text/css', 'application/octet-stream'],
    ['no type', 'application/octet-stream'],
  ])('serves the declared type %s as %s', (declared, served) => {
    expect(safeContentType(declared)).toBe(served);
  });

  it('caps long download names and replaces lone surrogates', () => {
    const disposition = contentDisposition(`${'x'.repeat(300)}`);
    expect(disposition).toBe(
      `attachment; filename="${'x'.repeat(200)}"; filename*=UTF-8''${'x'.repeat(200)}`,
    );
    expect(contentDisposition('a\u{D800}b')).toBe(
      `attachment; filename="a_b"; filename*=UTF-8''a_b`,
    );
  });

  it('reports health with the version and the bound ports', async () => {
    await service.receive(rawMessage(), null);
    const { status, body } = await call('/api/health');
    expect(status).toBe(200);
    expect(body).toEqual({
      status: 'ok',
      version: getVersion(),
      smtpPort: 2525,
      apiPort: 3000,
      persistent: false,
      emailCount: 1,
    });
  });

  it('answers unknown API paths with JSON 404', async () => {
    const { status, body } = await call('/api/nope');
    expect(status).toBe(404);
    expect(body).toEqual({
      error: { code: 'NOT_FOUND', message: 'No such API endpoint' },
    });
  });

  it('serves the OpenAPI document with the package version', async () => {
    const { status, body } = await call('/swagger/json');
    expect(status).toBe(200);
    expect(body).toMatchObject({ info: { version: getVersion() } });
    expect((await call('/swagger')).status).toBe(200);
  });

  it('hides unexpected errors behind a generic 500', async () => {
    vi.spyOn(service, 'list').mockImplementation(() => {
      throw new Error('SQLITE_CORRUPT: secret detail');
    });
    const { status, body } = await call('/api/emails');
    expect(status).toBe(500);
    expect(body).toEqual({
      error: { code: 'INTERNAL', message: 'Internal server error' },
    });
  });

  describe('request guards', () => {
    it('rejects foreign Host headers (DNS rebinding)', async () => {
      const { status, body } = await call('/api/health', {
        headers: { host: 'attacker.example:3000' },
      });
      expect(status).toBe(403);
      expect(body).toMatchObject({ error: { code: 'FORBIDDEN_HOST' } });
    });

    it('accepts the loopback names with the bound port', async () => {
      for (const host of ['localhost:3000', '127.0.0.1:3000', '[::1]:3000']) {
        expect((await call('/api/health', { headers: { host } })).status).toBe(
          200,
        );
      }
      expect(
        (await call('/api/health', { headers: { host: 'localhost:3001' } }))
          .status,
      ).toBe(403);
    });

    it('rejects foreign origins and accepts the own and configured ones', async () => {
      const foreign = await call('/api/emails', {
        method: 'DELETE',
        headers: { origin: 'https://evil.example' },
      });
      expect(foreign.status).toBe(403);
      expect(foreign.body).toMatchObject({
        error: { code: 'FORBIDDEN_ORIGIN' },
      });
      expect(
        (
          await call('/api/emails', {
            method: 'DELETE',
            headers: { origin: 'null' },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await call('/api/emails', {
            method: 'DELETE',
            headers: { origin: 'http://localhost:3000' },
          })
        ).status,
      ).toBe(200);

      app = makeApp(service, { allowedOrigins: ['http://localhost:5173'] });
      expect(
        (
          await call('/api/emails', {
            method: 'DELETE',
            headers: { origin: 'http://localhost:5173' },
          })
        ).status,
      ).toBe(200);
    });

    it('requires the bearer token for the API when configured', async () => {
      app = makeApp(service, { apiToken: 'secret-token' });
      const missing = await call('/api/emails');
      expect(missing.status).toBe(401);
      expect(missing.headers.get('www-authenticate')).toBe(
        'Bearer realm="mail-debugger"',
      );
      expect(missing.body).toMatchObject({ error: { code: 'UNAUTHORIZED' } });
      expect(
        (
          await call('/api/emails', {
            headers: { authorization: 'Bearer wrong' },
          })
        ).status,
      ).toBe(401);
      expect(
        (
          await call('/api/emails', {
            headers: { authorization: 'Bearer secret-token' },
          })
        ).status,
      ).toBe(200);
      // The documentation and the web inbox stay reachable to ask for the token.
      expect((await call('/swagger/json')).status).toBe(200);
    });
  });

  describe('static web inbox', () => {
    let webDir: string;

    beforeEach(() => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-debugger-web-'));
      webDir = path.join(root, 'web');
      fs.mkdirSync(path.join(webDir, '_app', 'immutable'), { recursive: true });
      fs.writeFileSync(
        path.join(webDir, 'index.html'),
        '<!doctype html><title>inbox</title>',
      );
      fs.writeFileSync(
        path.join(webDir, '_app', 'immutable', 'app.js'),
        'export {}',
      );
      fs.writeFileSync(path.join(root, 'secret.txt'), 'top secret');
      app = makeApp(service, { webDir });
    });

    afterEach(() => {
      fs.rmSync(path.dirname(webDir), { recursive: true, force: true });
    });

    it('serves index.html and assets with safe headers', async () => {
      const index = await call('/');
      expect(index.status).toBe(200);
      expect(index.headers.get('content-type')).toBe(
        'text/html; charset=utf-8',
      );
      expect(index.headers.get('x-frame-options')).toBe('DENY');
      expect(index.body).toContain('inbox');

      const asset = await call('/_app/immutable/app.js');
      expect(asset.headers.get('content-type')).toBe(
        'text/javascript; charset=utf-8',
      );
      expect(asset.headers.get('cache-control')).toContain('immutable');
    });

    it('falls back to index.html for client routes only', async () => {
      expect((await call('/emails/42')).body).toContain('inbox');
      expect((await call('/missing.js')).status).toBe(404);
      expect((await call('/api/missing')).body).toMatchObject({
        error: { code: 'NOT_FOUND' },
      });
    });

    it.each([
      '/..%2fsecret.txt',
      '/%2e%2e/secret.txt',
      '/_app/..%2f..%2fsecret.txt',
      '/..%5csecret.txt',
      '/%00index.html',
    ])('never serves files outside the web directory: %s', async (pathname) => {
      const response = await call(pathname);
      expect(String(response.body)).not.toContain('top secret');
    });
  });
});
