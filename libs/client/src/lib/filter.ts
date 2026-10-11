import type { EmailFilter } from './types.js';

/** The keys of {@link EmailFilter}, in query-string order. */
export const EMAIL_FILTER_KEYS = [
  'from',
  'to',
  'subject',
  'since',
  'until',
] as const satisfies readonly (keyof EmailFilter)[];

type EmailFilterSource = Partial<Record<keyof EmailFilter, unknown>>;

/**
 * Picks the non-empty string filter fields of an object, e.g. parsed query
 * parameters. Returns `undefined` when no field is set.
 */
export function pickEmailFilter(
  source: EmailFilterSource,
): EmailFilter | undefined {
  const filter: EmailFilter = {};
  for (const key of EMAIL_FILTER_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value) filter[key] = value;
  }
  return Object.keys(filter).length > 0 ? filter : undefined;
}

/**
 * Flattens a filter into `[key, value]` pairs for URLSearchParams, without
 * empty values.
 */
export function emailFilterToEntries(
  filter: EmailFilter | undefined,
): [string, string][] {
  if (!filter) return [];
  const entries: [string, string][] = [];
  for (const key of EMAIL_FILTER_KEYS) {
    const value = filter[key];
    if (value) entries.push([key, value]);
  }
  return entries;
}
