import selfsigned from 'selfsigned';

export interface TlsCert {
  key: string;
  cert: string;
}

export async function generateSelfSignedCert(): Promise<TlsCert> {
  const attrs = [{ name: 'commonName', value: 'mail-debugger' }];
  const notAfterDate = new Date();
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 10);

  const pems = await selfsigned.generate(attrs, { notAfterDate });

  return { key: pems.private, cert: pems.cert };
}
