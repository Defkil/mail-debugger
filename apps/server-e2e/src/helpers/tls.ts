import fs from 'node:fs';
import path from 'node:path';
import selfsigned from 'selfsigned';
import { makeTempDir } from './server.js';

export interface TrustedCertificate {
  /** PEM certificate; clients trust it to verify the server as localhost. */
  cert: string;
  certFile: string;
  keyFile: string;
  /** Server arguments that make it present this certificate. */
  args: string[];
}

/**
 * A self-signed certificate for localhost in files for --tls-cert and
 * --tls-key. The directory is removed by removeTempDirs().
 */
export async function createTrustedCertificate(): Promise<TrustedCertificate> {
  const dir = makeTempDir('mail-debugger-e2e-cert-');
  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: 'localhost' }],
    {
      extensions: [
        {
          name: 'subjectAltName',
          altNames: [{ type: 2, value: 'localhost' }],
        },
      ],
    },
  );
  const certFile = path.join(dir, 'cert.pem');
  const keyFile = path.join(dir, 'key.pem');
  fs.writeFileSync(certFile, pems.cert);
  fs.writeFileSync(keyFile, pems.private);
  return {
    cert: pems.cert,
    certFile,
    keyFile,
    args: ['--tls-cert', certFile, '--tls-key', keyFile],
  };
}
