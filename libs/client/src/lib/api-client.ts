import {
  MailDebuggerApiError,
  MailDebuggerNetworkError,
  MailDebuggerTimeoutError,
  type RequestTarget,
} from './errors.js';
import { emailFilterToEntries } from './filter.js';
import type {
  AttachmentDownload,
  Email,
  EmailFilter,
  EmailPage,
  HealthResponse,
  WaitForEmailParams,
  WaitResult,
} from './types.js';

/** Headers sent with every request, or a function that returns them. */
export type HeadersSource =
  HeadersInit | (() => HeadersInit | Promise<HeadersInit>);

// Spelled via RequestInit so the declarations also work without the DOM lib.
type HeadersInit = NonNullable<RequestInit['headers']>;

/** A bearer token, or a function that returns the current one. */
export type TokenSource =
  string | (() => string | undefined | Promise<string | undefined>);

export interface ApiClientOptions {
  /** `fetch` implementation; defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Extra request headers. */
  headers?: HeadersSource;
  /** Sent as `Authorization: Bearer <token>` (see MAIL_DEBUGGER_API_TOKEN). */
  token?: TokenSource;
  /** Per-request timeout in milliseconds; 0 disables it. Defaults to 10 000. */
  timeoutMs?: number;
}

export interface RequestOptions {
  /** Aborts the request; the promise then rejects with the signal's reason. */
  signal?: AbortSignal;
  /** Overrides the client's timeout for this request. */
  timeoutMs?: number;
}

export interface ListEmailsQuery {
  filter?: EmailFilter;
  /** 1 to 200; the server defaults to 50. */
  limit?: number;
  offset?: number;
}

export interface ApiClient {
  /** The normalized server URL ('' for same-origin requests). */
  readonly baseUrl: string;
  /** Server status, version, ports and the number of stored emails. */
  health(options?: RequestOptions): Promise<HealthResponse>;
  /** Lists emails newest first, optionally filtered and paged. */
  listEmails(
    filter?: EmailFilter,
    limit?: number,
    offset?: number,
    options?: RequestOptions,
  ): Promise<EmailPage>;
  listEmails(
    query: ListEmailsQuery,
    options?: RequestOptions,
  ): Promise<EmailPage>;
  /** One email with bodies, headers and attachments. */
  getEmail(id: number, options?: RequestOptions): Promise<Email>;
  /** The exact source octets of one email. */
  getRawEmail(id: number, options?: RequestOptions): Promise<Uint8Array>;
  /** One decoded attachment; `index` counts from 0. */
  getAttachment(
    id: number,
    index: number,
    options?: RequestOptions,
  ): Promise<AttachmentDownload>;
  /** Deletes one email; an unknown id rejects with a 404 error. */
  deleteEmail(id: number, options?: RequestOptions): Promise<boolean>;
  /** Deletes all emails and resolves to their number. */
  deleteAllEmails(options?: RequestOptions): Promise<number>;
  /**
   * Waits up to `timeoutMs` (max 60 000) for the lowest matching email
   * with an id above `afterId`. A timeout resolves with `timedOut: true`.
   */
  waitForEmail(
    params: WaitForEmailParams,
    options?: RequestOptions,
  ): Promise<WaitResult>;
}

export const DEFAULT_TIMEOUT_MS = 10_000;
/** Longest wait the server performs in one request. */
export const MAX_WAIT_MS = 60_000;
export const DEFAULT_WAIT_MS = 30_000;
/** Time a wait request gets on top of the server-side wait. */
const WAIT_GRACE_MS = 10_000;

/**
 * Creates a typed client for the REST API of a running mail-debugger.
 *
 * @param baseUrl HTTP(S) URL of the server without `/api`, e.g.
 *   `http://127.0.0.1:3000`, or `''` for same-origin requests in a browser.
 *   A path prefix of a reverse proxy is kept.
 *
 * @example
 * const mail = createApiClient('http://127.0.0.1:3000');
 * const { highWatermark = 0 } = await mail.listEmails({ limit: 1 });
 * // ... trigger the email under test ...
 * const result = await mail.waitForEmail({ afterId: highWatermark, filter: { to: 'alice@example.com' } });
 */
export function createApiClient(
  baseUrl: string,
  options: ApiClientOptions = {},
): ApiClient {
  const base = normalizeBaseUrl(baseUrl);
  const fetchImpl =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const clientTimeout = checkTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  async function request<T>(
    method: string,
    path: string,
    query: URLSearchParams | undefined,
    requestOptions: RequestOptions | undefined,
    read: (response: Response, target: RequestTarget) => Promise<T>,
    defaultTimeout = clientTimeout,
  ): Promise<T> {
    const search = query?.toString();
    const url = `${base}${path}${search ? `?${search}` : ''}`;
    const target = { method, url };
    const timeoutMs = checkTimeout(requestOptions?.timeoutMs ?? defaultTimeout);
    const callerSignal = requestOptions?.signal;
    callerSignal?.throwIfAborted();

    const controller = new AbortController();
    let timedOut = false;
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true;
            controller.abort();
          }, timeoutMs)
        : undefined;
    const forwardAbort = () => controller.abort(callerSignal?.reason);
    callerSignal?.addEventListener('abort', forwardAbort, { once: true });
    try {
      const headers = new Headers(
        typeof options.headers === 'function'
          ? await abortable(options.headers(), controller.signal)
          : options.headers,
      );
      const token =
        typeof options.token === 'function'
          ? await abortable(options.token(), controller.signal)
          : options.token;
      if (token) headers.set('authorization', `Bearer ${token}`);
      controller.signal.throwIfAborted();
      const response = await fetchImpl(url, {
        method,
        headers,
        signal: controller.signal,
      });
      if (!response.ok) throw await toApiError(response, target);
      return await read(response, target);
    } catch (error) {
      if (callerSignal?.aborted) throw callerSignal.reason;
      if (timedOut) throw new MailDebuggerTimeoutError(target, timeoutMs);
      if (error instanceof MailDebuggerApiError) throw error;
      throw new MailDebuggerNetworkError(target, error);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', forwardAbort);
    }
  }

  const getJson = <T>(
    path: string,
    query: URLSearchParams | undefined,
    requestOptions: RequestOptions | undefined,
    validate: (body: unknown) => body is T,
    defaultTimeout?: number,
  ) =>
    request(
      'GET',
      path,
      query,
      requestOptions,
      (response, target) => readJson(response, target, validate),
      defaultTimeout,
    );

  async function listEmails(
    first?: EmailFilter | ListEmailsQuery,
    second?: number | RequestOptions,
    offset?: number,
    requestOptions?: RequestOptions,
  ): Promise<EmailPage> {
    let filter: EmailFilter | undefined;
    let limit: number | undefined;
    let options = requestOptions;
    if (isListQuery(first)) {
      ({ filter, limit, offset } = first);
      options = second as RequestOptions | undefined;
    } else {
      filter = first;
      limit = second as number | undefined;
    }
    const query = new URLSearchParams(emailFilterToEntries(filter));
    if (limit !== undefined)
      query.set('limit', String(checkInteger(limit, 'limit', 1)));
    if (offset !== undefined)
      query.set('offset', String(checkInteger(offset, 'offset', 0)));
    return getJson('/api/emails', query, options, isEmailPage);
  }

  return {
    baseUrl: base,

    async health(requestOptions) {
      return getJson(
        '/api/health',
        undefined,
        requestOptions,
        isHealthResponse,
      );
    },

    listEmails: listEmails as ApiClient['listEmails'],

    async getEmail(id, requestOptions) {
      const body = await getJson(
        `/api/emails/${checkId(id)}`,
        undefined,
        requestOptions,
        isEmailEnvelope,
      );
      return body.data;
    },

    async getRawEmail(id, requestOptions) {
      return request(
        'GET',
        `/api/emails/${checkId(id)}/raw`,
        undefined,
        requestOptions,
        readBytes,
      );
    },

    async getAttachment(id, index, requestOptions) {
      return request(
        'GET',
        `/api/emails/${checkId(id)}/attachments/${checkInteger(index, 'index', 0)}`,
        undefined,
        requestOptions,
        async (response) => ({
          bytes: await readBytes(response),
          filename: dispositionFilename(
            response.headers.get('content-disposition'),
          ),
          contentType:
            response.headers.get('content-type') ?? 'application/octet-stream',
        }),
      );
    },

    async deleteEmail(id, requestOptions) {
      const body = await request(
        'DELETE',
        `/api/emails/${checkId(id)}`,
        undefined,
        requestOptions,
        (response, target) => readJson(response, target, isDeletedFlag),
      );
      return body.deleted;
    },

    async deleteAllEmails(requestOptions) {
      const body = await request(
        'DELETE',
        '/api/emails',
        undefined,
        requestOptions,
        (response, target) => readJson(response, target, isDeletedCount),
      );
      return body.deleted;
    },

    async waitForEmail(params, requestOptions) {
      const waitMs = params.timeoutMs ?? DEFAULT_WAIT_MS;
      if (!Number.isSafeInteger(waitMs) || waitMs < 0 || waitMs > MAX_WAIT_MS) {
        throw new RangeError(
          `timeoutMs must be an integer from 0 to ${MAX_WAIT_MS}`,
        );
      }
      const query = new URLSearchParams(emailFilterToEntries(params.filter));
      query.set('afterId', String(checkInteger(params.afterId, 'afterId', 0)));
      query.set('timeoutMs', String(waitMs));
      if (params.mailboxId) query.set('mailboxId', params.mailboxId);
      return getJson(
        '/api/emails/wait',
        query,
        requestOptions,
        isWaitResult,
        waitMs + WAIT_GRACE_MS,
      );
    },
  };
}

/** Header/token callbacks share the request's cancellation and timeout. */
async function abortable<T>(
  value: T | Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return await Promise.race([value, aborted]);
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function isListQuery(value: unknown): value is ListEmailsQuery {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('filter' in value || 'limit' in value || 'offset' in value)
  );
}

/** Trims trailing slashes and checks that the URL is an HTTP(S) URL. */
export function normalizeBaseUrl(baseUrl: string): string {
  if (baseUrl === '') return '';
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new TypeError(`Invalid mail-debugger URL "${baseUrl}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError(
      `The mail-debugger URL must use http or https: "${baseUrl}"`,
    );
  }
  if (url.search || url.hash) {
    throw new TypeError(
      `The mail-debugger URL must not contain a query or fragment: "${baseUrl}"`,
    );
  }
  // Rejected rather than stripped: fetch would echo them in its error message.
  if (url.username || url.password) {
    throw new TypeError(
      'The mail-debugger URL must not contain credentials; use the token or headers option',
    );
  }
  return url.href.replace(/\/+$/, '');
}

function checkTimeout(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError('timeoutMs must be a non-negative number');
  }
  return value;
}

function checkId(id: number): number {
  return checkInteger(id, 'id', 1);
}

function checkInteger(value: number, name: string, min: number): number {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new TypeError(
      `${name} must be an integer of at least ${min}, got ${value}`,
    );
  }
  return value;
}

async function toApiError(
  response: Response,
  target: RequestTarget,
): Promise<MailDebuggerApiError> {
  let text = '';
  try {
    text = await response.text();
  } catch {
    // An unreadable error body still yields the status.
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const error = (parsed as { error?: unknown } | undefined)?.error;
  if (error && typeof error === 'object') {
    const { code, message } = error as { code?: unknown; message?: unknown };
    if (typeof message === 'string') {
      return new MailDebuggerApiError(message, {
        ...target,
        status: response.status,
        code: typeof code === 'string' ? code : `HTTP_${response.status}`,
      });
    }
  }
  if (typeof error === 'string' && error) {
    // Error body of mail-debugger 0.3 and earlier.
    return new MailDebuggerApiError(error, {
      ...target,
      status: response.status,
      code: `HTTP_${response.status}`,
    });
  }
  return new MailDebuggerApiError(`HTTP ${response.status}`, {
    ...target,
    status: response.status,
    code: `HTTP_${response.status}`,
    body: text,
  });
}

function invalidResponse(
  response: Response,
  target: RequestTarget,
  reason: string,
) {
  return new MailDebuggerApiError(`Unexpected response: ${reason}`, {
    ...target,
    status: response.status,
    code: 'INVALID_RESPONSE',
  });
}

async function readJson<T>(
  response: Response,
  target: RequestTarget,
  validate: (body: unknown) => body is T,
): Promise<T> {
  const type = response.headers.get('content-type') ?? '';
  if (!/^application\/json\b/i.test(type)) {
    throw invalidResponse(
      response,
      target,
      `expected JSON, got "${type || 'no content type'}"`,
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw invalidResponse(response, target, 'malformed JSON');
  }
  if (!validate(body)) {
    throw invalidResponse(response, target, 'unexpected JSON shape');
  }
  return body;
}

async function readBytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

/** The file name of a `Content-Disposition` header (RFC 6266). */
export function dispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (extended) {
    try {
      return decodeURIComponent(extended[1].trim());
    } catch {
      // fall back to the plain parameter
    }
  }
  const quoted = /filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header);
  if (quoted) return quoted[1].replaceAll(/\\(.)/g, '$1');
  const token = /filename\s*=\s*([^;\s]+)/i.exec(header);
  return token ? token[1] : null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function isHealthResponse(body: unknown): body is HealthResponse {
  return (
    isObject(body) &&
    body['status'] === 'ok' &&
    isCount(body['smtpPort']) &&
    isCount(body['apiPort']) &&
    typeof body['persistent'] === 'boolean' &&
    isCount(body['emailCount']) &&
    (body['version'] === undefined || typeof body['version'] === 'string') &&
    (body['imapPort'] === undefined || isCount(body['imapPort'])) &&
    (body['mcp'] === undefined || typeof body['mcp'] === 'boolean')
  );
}

function isEmailPage(body: unknown): body is EmailPage {
  return (
    isObject(body) &&
    isArrayOf(body['data'], isSummary) &&
    isCount(body['total']) &&
    (body['highWatermark'] === undefined || isCount(body['highWatermark'])) &&
    (body['mailboxId'] === undefined || typeof body['mailboxId'] === 'string')
  );
}

function isEmailEnvelope(body: unknown): body is { data: Email } {
  return isObject(body) && isEmail(body['data']);
}

function isDeletedFlag(body: unknown): body is { deleted: boolean } {
  return isObject(body) && typeof body['deleted'] === 'boolean';
}

function isDeletedCount(body: unknown): body is { deleted: number } {
  return isObject(body) && isCount(body['deleted']);
}

function isWaitResult(body: unknown): body is WaitResult {
  return (
    isObject(body) &&
    typeof body['timedOut'] === 'boolean' &&
    (body['data'] === null || isSummary(body['data'])) &&
    isCount(body['highWatermark']) &&
    typeof body['mailboxId'] === 'string' &&
    (body['timedOut'] ? body['data'] === null : body['data'] !== null)
  );
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isArrayOf<T>(
  value: unknown,
  validate: (item: unknown) => item is T,
): value is T[] {
  return Array.isArray(value) && value.every(validate);
}

function hasEmailFields(body: Record<string, unknown>): boolean {
  return (
    isCount(body['id']) &&
    body['id'] > 0 &&
    isString(body['from']) &&
    isArrayOf(body['to'], isString) &&
    isString(body['subject']) &&
    isString(body['receivedAt'])
  );
}

function isSummary(body: unknown): body is EmailPage['data'][number] {
  return (
    isObject(body) &&
    hasEmailFields(body) &&
    typeof body['hasAttachments'] === 'boolean'
  );
}

function isAttachment(body: unknown): body is Email['attachments'][number] {
  return (
    isObject(body) &&
    isNullableString(body['filename']) &&
    isCount(body['size']) &&
    isString(body['contentType']) &&
    isString(body['content'])
  );
}

function isEnvelope(body: unknown): body is NonNullable<Email['envelope']> {
  return (
    isObject(body) &&
    isNullableString(body['from']) &&
    isArrayOf(body['to'], isString)
  );
}

function isEmail(body: unknown): body is Email {
  return (
    isObject(body) &&
    hasEmailFields(body) &&
    isNullableString(body['messageId']) &&
    isArrayOf(body['cc'], isString) &&
    isArrayOf(body['bcc'], isString) &&
    isNullableString(body['textBody']) &&
    isNullableString(body['htmlBody']) &&
    isString(body['raw']) &&
    isObject(body['headers']) &&
    Object.values(body['headers']).every(isString) &&
    isArrayOf(body['attachments'], isAttachment) &&
    (body['envelope'] === undefined || isEnvelope(body['envelope']))
  );
}
