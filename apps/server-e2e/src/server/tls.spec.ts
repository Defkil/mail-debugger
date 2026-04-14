import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTransport } from 'nodemailer';

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(thisDir, '../../../server/dist/main.mjs');

interface ServerInstance {
  process: ChildProcess;
  smtpPort: number;
  apiPort: number;
}

async function waitForHealth(url: string, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
}

async function startServer(
  smtpPort: number,
  apiPort: number,
  tlsMode: string,
): Promise<ServerInstance> {
  const proc = spawn(
    'node',
    [
      serverPath,
      '--smtp-port',
      String(smtpPort),
      '--api-port',
      String(apiPort),
      '--tls',
      tlsMode,
    ],
    { stdio: 'pipe' },
  );

  proc.stderr?.on('data', (data: Buffer) => {
    console.error(`[server:${tlsMode} stderr]`, data.toString());
  });

  await waitForHealth(`http://localhost:${apiPort}/api/health`);

  return { process: proc, smtpPort, apiPort };
}

function stopServer(server: ServerInstance): Promise<void> {
  return new Promise((resolve) => {
    server.process.on('close', () => resolve());
    server.process.kill('SIGTERM');
  });
}

function api(server: ServerInstance, urlPath: string, init?: RequestInit) {
  return fetch(`http://localhost:${server.apiPort}${urlPath}`, init);
}

describe('TLS E2E', () => {
  describe('TLS mode: none', () => {
    let server: ServerInstance;

    beforeAll(async () => {
      server = await startServer(2530, 3010, 'none');
    }, 30_000);

    afterAll(async () => {
      await stopServer(server);
    });

    it('should accept a plain-text SMTP connection and receive email', async () => {
      const transport = createTransport({
        host: '127.0.0.1',
        port: server.smtpPort,
        secure: false,
        tls: { rejectUnauthorized: false },
      });

      await transport.sendMail({
        from: 'tls-none@example.com',
        to: 'recipient@example.com',
        subject: 'TLS None Test',
        text: 'Plain text connection test',
      });

      await new Promise((r) => setTimeout(r, 300));

      const res = await api(server, '/api/emails');
      const body = (await res.json()) as {
        data: { from: string; subject: string }[];
      };

      expect(body.data).toHaveLength(1);
      expect(body.data[0].from).toBe('tls-none@example.com');
      expect(body.data[0].subject).toBe('TLS None Test');
    });
  });

  describe('TLS mode: starttls', () => {
    let server: ServerInstance;

    beforeAll(async () => {
      server = await startServer(2531, 3011, 'starttls');
    }, 30_000);

    afterAll(async () => {
      await stopServer(server);
    });

    it('should accept a STARTTLS-upgraded connection and receive email', async () => {
      const transport = createTransport({
        host: '127.0.0.1',
        port: server.smtpPort,
        secure: false,
        requireTLS: true,
        tls: { rejectUnauthorized: false },
      });

      await transport.sendMail({
        from: 'tls-starttls@example.com',
        to: 'recipient@example.com',
        subject: 'STARTTLS Test',
        text: 'STARTTLS connection test',
      });

      await new Promise((r) => setTimeout(r, 300));

      const res = await api(server, '/api/emails');
      const body = (await res.json()) as {
        data: { from: string; subject: string }[];
      };

      expect(body.data).toHaveLength(1);
      expect(body.data[0].from).toBe('tls-starttls@example.com');
      expect(body.data[0].subject).toBe('STARTTLS Test');
    });
  });

  describe('TLS mode: implicit', () => {
    let server: ServerInstance;

    beforeAll(async () => {
      server = await startServer(2532, 3012, 'implicit');
    }, 30_000);

    afterAll(async () => {
      await stopServer(server);
    });

    it('should accept an implicit TLS (SMTPS) connection and receive email', async () => {
      const transport = createTransport({
        host: '127.0.0.1',
        port: server.smtpPort,
        secure: true,
        tls: { rejectUnauthorized: false },
      });

      await transport.sendMail({
        from: 'tls-implicit@example.com',
        to: 'recipient@example.com',
        subject: 'Implicit TLS Test',
        text: 'Implicit TLS connection test',
      });

      await new Promise((r) => setTimeout(r, 300));

      const res = await api(server, '/api/emails');
      const body = (await res.json()) as {
        data: { from: string; subject: string }[];
      };

      expect(body.data).toHaveLength(1);
      expect(body.data[0].from).toBe('tls-implicit@example.com');
      expect(body.data[0].subject).toBe('Implicit TLS Test');
    });
  });
});
