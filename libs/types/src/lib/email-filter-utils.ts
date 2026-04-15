import type { EmailFilter } from './types.js';

const EMAIL_FILTER_KEYS = ['from', 'to', 'subject', 'since', 'until'] as const;

type EmailFilterSource = Partial<Record<keyof EmailFilter, string | undefined>>;

/**
 * Picks the email filter fields from a source object and returns a populated
 * EmailFilter, or `undefined` when no fields are set. Callers can forward the
 * result directly to repositories and query builders that treat `undefined` as
 * "no filter applied".
 */
export function pickEmailFilter(
  source: EmailFilterSource,
): EmailFilter | undefined {
  const filter: EmailFilter = {};
  for (const key of EMAIL_FILTER_KEYS) {
    const value = source[key];
    if (value) filter[key] = value;
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

/**
 * Flattens an EmailFilter into string `[key, value]` pairs suitable for
 * URLSearchParams or any other kv-serialisation. Omits undefined/empty values.
 */
export function emailFilterToEntries(
  filter: EmailFilter | undefined,
): Array<[string, string]> {
  if (!filter) return [];
  const entries: Array<[string, string]> = [];
  for (const key of EMAIL_FILTER_KEYS) {
    const value = filter[key];
    if (value) entries.push([key, value]);
  }
  return entries;
}
