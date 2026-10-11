export {
  createApiClient,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_WAIT_MS,
  dispositionFilename,
  MAX_WAIT_MS,
  normalizeBaseUrl,
  type ApiClient,
  type ApiClientOptions,
  type HeadersSource,
  type ListEmailsQuery,
  type RequestOptions,
  type TokenSource,
} from './lib/api-client.js';
export {
  getErrorMessage,
  MailDebuggerApiError,
  MailDebuggerNetworkError,
  MailDebuggerTimeoutError,
  type RequestTarget,
} from './lib/errors.js';
export {
  EMAIL_FILTER_KEYS,
  emailFilterToEntries,
  pickEmailFilter,
} from './lib/filter.js';
export type {
  AttachmentDownload,
  AttachmentMeta,
  Email,
  EmailFilter,
  EmailPage,
  EmailSummary,
  HealthResponse,
  PaginatedResponse,
  ParsedEmail,
  SmtpEnvelope,
  WaitForEmailParams,
  WaitResult,
} from './lib/types.js';
