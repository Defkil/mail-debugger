import { safeEqual } from '../crypto.js';
import { HttpError } from './http-errors.js';

export interface HttpPolicyOptions {
  /** The configured listener address. */
  host: string;
  /** The bound HTTP port. */
  port: number;
  /** Extra accepted Host header values (`host` or `host:port`). */
  allowedHosts: readonly string[];
  /** Extra accepted browser origins. */
  allowedOrigins: readonly string[];
  /** When set, `/api/*` requires `Authorization: Bearer <token>`. */
  apiToken?: string;
}

export interface HttpPolicy {
  readonly allowedHosts: ReadonlySet<string>;
  readonly allowedOrigins: ReadonlySet<string>;
  readonly apiToken?: string;
}

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::']);

function hostLiteral(host: string): string {
  return host.includes(':') ? `[${host}]` : host;
}

/**
 * The Host and Origin values the HTTP server accepts: the listener address
 * and the loopback names with the bound port, plus the configured extras.
 * Forwarded headers are never trusted. A page served from an accepted host
 * may call the API, so each accepted host also allows its http(s) origin.
 */
export function createHttpPolicy(options: HttpPolicyOptions): HttpPolicy {
  const names = ['localhost', '127.0.0.1', '[::1]'];
  if (!WILDCARD_HOSTS.has(options.host)) names.push(hostLiteral(options.host));

  const hosts = new Set<string>();
  for (const name of names) {
    hosts.add(`${name.toLowerCase()}:${options.port}`);
    if (options.port === 80) hosts.add(name.toLowerCase());
  }
  for (const host of options.allowedHosts) hosts.add(host.toLowerCase());

  const origins = new Set<string>();
  for (const host of hosts) {
    origins.add(`http://${host}`);
    origins.add(`https://${host}`);
  }
  for (const origin of options.allowedOrigins)
    origins.add(origin.toLowerCase());

  return {
    allowedHosts: hosts,
    allowedOrigins: origins,
    ...(options.apiToken && { apiToken: options.apiToken }),
  };
}

/** Paths that require the API token when one is configured. */
export function isProtectedPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}

/**
 * Validates a request against the policy before any handler runs. Host and
 * Origin checks block DNS rebinding and cross-site requests; native clients
 * that send no Origin are fine.
 */
export function checkRequest(
  policy: HttpPolicy,
  request: Request,
  pathname: string,
): HttpError | undefined {
  const host = request.headers.get('host')?.toLowerCase();
  if (!host || !policy.allowedHosts.has(host)) {
    return new HttpError(
      403,
      'FORBIDDEN_HOST',
      'The Host header is not allowed; add it with --http-allowed-host',
    );
  }
  const origin = request.headers.get('origin');
  if (origin !== null && !policy.allowedOrigins.has(origin.toLowerCase())) {
    return new HttpError(
      403,
      'FORBIDDEN_ORIGIN',
      'The request origin is not allowed; add it with --http-allowed-origin',
    );
  }
  if (policy.apiToken && isProtectedPath(pathname)) {
    const authorization = request.headers.get('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(authorization);
    if (!match || !safeEqual(match[1], policy.apiToken)) {
      return new HttpError(
        401,
        'UNAUTHORIZED',
        'This API requires a valid bearer token',
        { 'www-authenticate': 'Bearer realm="mail-debugger"' },
      );
    }
  }
  return undefined;
}
