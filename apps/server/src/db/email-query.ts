import type { SqlValue } from 'sql.js';
import type { EmailFilter } from '@mail-debugger/client';
import { InvalidArgumentError } from '../mail/errors.js';

/** A validated filter: text criteria as given, dates as UTC ISO 8601 strings. */
export interface EmailQuery {
  from?: string;
  to?: string;
  subject?: string;
  since?: string;
  until?: string;
}

export interface FilterClause {
  where: string;
  params: SqlValue[];
}

/** Longest accepted text criterion. */
export const MAX_FILTER_LENGTH = 512;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Parses a `since`/`until` bound to a UTC ISO 8601 timestamp with
 * milliseconds. Accepts a date (`2026-01-31`, the whole UTC day is
 * included) or a date-time with an optional zone (no zone means UTC, as in
 * the timestamps of 0.3.x).
 */
export function parseDateBound(
  value: string,
  bound: 'since' | 'until',
): string {
  const trimmed = value.trim();
  const invalid = () =>
    new InvalidArgumentError(
      `Invalid ${bound} date "${value}": use YYYY-MM-DD or an ISO 8601 date-time`,
    );

  const dateOnly = DATE_ONLY.exec(trimmed);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    if (!isCalendarDate(Number(y), Number(mo), Number(d))) throw invalid();
    const time = bound === 'since' ? '00:00:00.000' : '23:59:59.999';
    return new Date(`${y}-${mo}-${d}T${time}Z`).toISOString();
  }

  const match = DATE_TIME.exec(trimmed);
  if (!match) throw invalid();
  const [, y, mo, d, h, mi, s = '00', fraction = '', zone] = match;
  if (
    !isCalendarDate(Number(y), Number(mo), Number(d)) ||
    Number(h) > 23 ||
    Number(mi) > 59 ||
    Number(s) > 59 ||
    (zone !== undefined && !isZone(zone))
  ) {
    throw invalid();
  }
  const millis = (fraction.slice(1) + '000').slice(0, 3);
  const offset = zone ? normalizeZone(zone) : 'Z';
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}.${millis}${offset}`);
  if (Number.isNaN(date.getTime())) throw invalid();
  return date.toISOString();
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day <= daysInMonth;
}

function isZone(zone: string): boolean {
  if (zone.toUpperCase() === 'Z') return true;
  const digits = zone.replace(':', '');
  return Number(digits.slice(1, 3)) <= 23 && Number(digits.slice(3, 5)) <= 59;
}

function normalizeZone(zone: string): string {
  if (zone.toUpperCase() === 'Z') return 'Z';
  return zone.includes(':') ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`;
}

/**
 * Validates a filter: text criteria are literal, case-insensitive substrings
 * of at most {@link MAX_FILTER_LENGTH} characters; date bounds are inclusive
 * and must be ordered. Empty values are ignored.
 */
export function normalizeFilter(filter: EmailFilter | undefined): EmailQuery {
  const query: EmailQuery = {};
  for (const key of ['from', 'to', 'subject'] as const) {
    const value = filter?.[key];
    if (!value) continue;
    if (value.length > MAX_FILTER_LENGTH) {
      throw new InvalidArgumentError(
        `The ${key} filter is longer than ${MAX_FILTER_LENGTH} characters`,
      );
    }
    query[key] = value;
  }
  if (filter?.since) query.since = parseDateBound(filter.since, 'since');
  if (filter?.until) query.until = parseDateBound(filter.until, 'until');
  if (query.since && query.until && query.since > query.until) {
    throw new InvalidArgumentError('The since date is after the until date');
  }
  return query;
}

const TEXT_COLUMNS = {
  from: 'from_addr',
  to: 'to_addr',
  subject: 'subject',
} as const;

/**
 * Builds the SQL WHERE clause (including the `WHERE` keyword, or an empty
 * string) and its parameters. Text criteria use the `md_fold` function the
 * database registers (Unicode lower case), so they match literally and
 * case-insensitively without LIKE wildcards.
 */
export function buildFilterClause(query: EmailQuery): FilterClause {
  const conditions: string[] = [];
  const params: SqlValue[] = [];

  for (const key of ['from', 'to', 'subject'] as const) {
    const value = query[key];
    if (value === undefined) continue;
    conditions.push(`instr(md_fold(${TEXT_COLUMNS[key]}), md_fold(?)) > 0`);
    params.push(value);
  }
  if (query.since) {
    conditions.push('received_at >= ?');
    params.push(query.since);
  }
  if (query.until) {
    conditions.push('received_at <= ?');
    params.push(query.until);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}
