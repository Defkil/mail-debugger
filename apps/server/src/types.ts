export interface EmailAddress {
  name: string;
  address: string;
}

export type TlsMode = 'none' | 'starttls' | 'implicit';

export interface Config {
  smtpPort: number;
  apiPort: number;
  tls: TlsMode;
  persist: boolean;
}
