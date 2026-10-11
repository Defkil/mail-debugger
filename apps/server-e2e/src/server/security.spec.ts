import http from 'node:http';
import { api } from '../helpers/mail.js';
import {
  startServerProcess,
  stopAllServers,
  type ServerProcess,
} from '../helpers/server.js';

/** A raw HTTP request with exactly the given headers (fetch fixes Host itself). */
function rawRequest(
  port: number,
  pathname: string,
  headers: Record<string, string>,
  method = 'GET',
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: pathname, method, headers },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => (body += chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on('error', reject);
    req.end();
  });
}

afterAll(async () => {
  await stopAllServers();
});

describe('HTTP security', () => {
  let server: ServerProcess;

  beforeAll(async () => {
    server = await startServerProcess();
  }, 30_000);

  it('binds the loopback interface by default', () => {
    expect(server.output()).toMatch(/SMTP server listening on 127\.0\.0\.1:/);
  });

  it('rejects foreign Host headers to stop DNS rebinding', async () => {
    const response = await rawRequest(server.apiPort, '/api/emails', {
      host: `rebind.example:${server.apiPort}`,
    });
    expect(response.status).toBe(403);
    expect(JSON.parse(response.body)).toMatchObject({
      error: { code: 'FORBIDDEN_HOST' },
    });
  });

  it('rejects cross-site origins but not native clients', async () => {
    const crossSite = await rawRequest(
      server.apiPort,
      '/api/emails',
      { host: `localhost:${server.apiPort}`, origin: 'https://evil.example' },
      'DELETE',
    );
    expect(crossSite.status).toBe(403);
    const native = await rawRequest(server.apiPort, '/api/emails', {
      host: `localhost:${server.apiPort}`,
    });
    expect(native.status).toBe(200);
  });

  it('answers unknown API paths with JSON 404 and sets security headers', async () => {
    const { status, headers, body } = await api(
      server.baseUrl,
      '/api/does-not-exist',
    );
    expect(status).toBe(404);
    expect(body).toEqual({
      error: { code: 'NOT_FOUND', message: 'No such API endpoint' },
    });
    expect(headers.get('x-content-type-options')).toBe('nosniff');
    expect(headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('serves the web inbox with deep links but no files outside it', async () => {
    const index = await api(server.baseUrl, '/');
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(index.headers.get('x-frame-options')).toBe('DENY');

    const deepLink = await api(server.baseUrl, '/emails/42');
    expect(deepLink.body).toBe(index.body);

    for (const pathname of [
      '/..%2f..%2f..%2fpackage.json',
      '/%2e%2e/%2e%2e/%2e%2e/package.json',
      '/..%5c..%5c..%5cpackage.json',
    ]) {
      const response = await rawRequest(server.apiPort, pathname, {
        host: `localhost:${server.apiPort}`,
      });
      expect(response.body).not.toContain('"name"');
    }
  });

  it('serves every asset the web inbox references', async () => {
    const html = (await api(server.baseUrl, '/')).body as string;
    const assets = new Set(
      Array.from(
        html.matchAll(/(?:href|src)="(\/[^"]+)"|import\("(\/[^"]+)"\)/g),
        (match) => match[1] ?? match[2],
      ),
    );
    expect(assets.size).toBeGreaterThan(0);
    for (const asset of assets) {
      const response = await fetch(`${server.baseUrl}${asset}`);
      expect(response.status, asset).toBe(200);
      expect(response.headers.get('content-type'), asset).not.toBe(
        'application/octet-stream',
      );
    }
  });

  it('keeps the API documentation at /swagger', async () => {
    expect((await api(server.baseUrl, '/swagger')).status).toBe(200);
    const spec = await api(server.baseUrl, '/swagger/json');
    expect(spec.body.info.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(Object.keys(spec.body.paths)).toContain('/api/emails');
  });
});

describe('API token', () => {
  it('protects the REST API but not the web inbox', async () => {
    const server = await startServerProcess({
      env: { MAIL_DEBUGGER_API_TOKEN: 'e2e-api-token' },
    });
    try {
      const missing = await api(server.baseUrl, '/api/emails');
      expect(missing.status).toBe(401);
      expect(missing.headers.get('www-authenticate')).toContain('Bearer');
      const valid = await api(server.baseUrl, '/api/emails', {
        headers: { authorization: 'Bearer e2e-api-token' },
      });
      expect(valid.status).toBe(200);
      expect((await api(server.baseUrl, '/')).status).toBe(200);
      expect(server.output()).not.toContain('e2e-api-token');
    } finally {
      await server.stop();
    }
  }, 30_000);
});
