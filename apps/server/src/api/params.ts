import type { EmailFilter } from '@mail-debugger/types';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type Page,
} from '../mail/mail-service.js';
import { HttpError } from './http-errors.js';

export type QueryValues = Record<string, unknown>;

function invalid(message: string): HttpError {
  return new HttpError(400, 'INVALID_ARGUMENT', message);
}

/** A path id: a positive safe integer written in plain decimal digits. */
export function parseId(value: string, name = 'email id'): number {
  const id = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(id)) {
    throw invalid(`Invalid ${name} "${value}"`);
  }
  return id;
}

function single(query: QueryValues, name: string): string | undefined {
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw invalid(`${name} must be given at most once`);
  }
  return value;
}

function integer(
  query: QueryValues,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = single(query, name);
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(number) ||
    number < min ||
    number > max
  ) {
    throw invalid(`${name} must be a whole number from ${min} to ${max}`);
  }
  return number;
}

/** The filter of `from`, `to`, `subject`, `since` and `until`; empty values are ignored. */
export function parseFilter(query: QueryValues): EmailFilter {
  const filter: EmailFilter = {};
  for (const key of ['from', 'to', 'subject', 'since', 'until'] as const) {
    const value = single(query, key);
    if (value) filter[key] = value;
  }
  return filter;
}

/** Page window: `limit` 1..200 (default 50) and `offset` >= 0 (default 0). */
export function parsePage(query: QueryValues): Page {
  return {
    limit: integer(query, 'limit', DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE),
    offset: integer(query, 'offset', 0, 0, Number.MAX_SAFE_INTEGER),
  };
}
