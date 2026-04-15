/**
 * Extracts a user-facing message from an unknown thrown value. The API client
 * throws `Error` instances with server-supplied messages, so this helper is
 * the canonical way for consumers to surface those — with a fallback for the
 * rare case where a non-Error value is thrown.
 */
export function getErrorMessage(err: unknown, fallback?: string): string {
  if (err instanceof Error) return err.message;
  return fallback ?? String(err);
}
