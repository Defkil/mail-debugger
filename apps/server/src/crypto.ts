import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Compares secrets in constant time. Hashing first gives both sides the same
 * length, so the comparison does not reveal the expected length either.
 */
export function safeEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(digest(actual), digest(expected));
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
