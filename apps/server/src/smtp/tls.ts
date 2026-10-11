import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { createSecureContext } from 'node:tls';
import selfsigned from 'selfsigned';
import type { ServerConfig } from '../types.js';

export interface TlsCert {
  key: string;
  cert: string;
}

/** Host names and addresses every generated certificate covers. */
const LOCAL_NAMES = ['localhost', '127.0.0.1', '::1'];

/**
 * Generates a self-signed certificate for local development. It covers
 * localhost, 127.0.0.1 and ::1 plus `extraNames` (e.g. the configured
 * host), so clients that pin the certificate can verify the name.
 */
export async function generateSelfSignedCert(
  extraNames: readonly string[] = [],
): Promise<TlsCert> {
  const names = [...new Set([...LOCAL_NAMES, ...extraNames])].filter(
    (name) => name !== '0.0.0.0' && name !== '::',
  );
  const notAfterDate = new Date();
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 10);

  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: 'mail-debugger' }],
    {
      notAfterDate,
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
        {
          name: 'subjectAltName',
          altNames: names.map((name) =>
            isIP(name) === 0 ? { type: 2, value: name } : { type: 7, ip: name },
          ),
        },
      ],
    },
  );

  return { key: pems.private, cert: pems.cert };
}

/**
 * The certificate SMTP uses: the configured PEM files, a generated
 * self-signed certificate, or none without TLS. Invalid or mismatched files
 * fail here, before any listener opens.
 */
export async function loadCertificate(
  config: Pick<ServerConfig, 'tls' | 'tlsCertFile' | 'tlsKeyFile' | 'host'>,
): Promise<TlsCert | undefined> {
  if (config.tls === 'none') return undefined;
  if (!config.tlsCertFile || !config.tlsKeyFile) {
    return generateSelfSignedCert([config.host]);
  }
  const certificate = {
    cert: readPem(config.tlsCertFile, '--tls-cert'),
    key: readPem(config.tlsKeyFile, '--tls-key'),
  };
  try {
    createSecureContext(certificate);
  } catch (error) {
    throw new Error(
      `The certificate and key of --tls-cert/--tls-key cannot be used: ${(error as Error).message}`,
      { cause: error },
    );
  }
  return certificate;
}

function readPem(file: string, option: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(
      `Cannot read ${option} ${file}: ${(error as Error).message}`,
      {
        cause: error,
      },
    );
  }
}
