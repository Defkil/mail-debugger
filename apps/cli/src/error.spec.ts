import { getErrorMessage } from './error.js';

describe('getErrorMessage', () => {
  it('returns the message of an Error instance', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('falls back to the provided string for non-Error values', () => {
    expect(getErrorMessage('oops', 'fallback')).toBe('fallback');
    expect(getErrorMessage(undefined, 'fallback')).toBe('fallback');
  });

  it('coerces non-Error values to string when no fallback is given', () => {
    expect(getErrorMessage('oops')).toBe('oops');
    expect(getErrorMessage(42)).toBe('42');
    expect(getErrorMessage(null)).toBe('null');
  });

  it('prefers the Error message even when a fallback is given', () => {
    expect(getErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
  });
});
