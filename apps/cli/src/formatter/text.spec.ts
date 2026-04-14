import { truncate, padRight } from './text';

describe('truncate', () => {
  it('should return string unchanged when shorter than max', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('should return string unchanged when equal to max', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('should truncate and add ellipsis when longer than max', () => {
    expect(truncate('hello world', 8)).toBe('hello w…');
  });

  it('should handle max of 1', () => {
    expect(truncate('hello', 1)).toBe('…');
  });

  it('should handle empty string', () => {
    expect(truncate('', 5)).toBe('');
  });
});

describe('padRight', () => {
  it('should pad string to target length', () => {
    expect(padRight('hi', 5)).toBe('hi   ');
  });

  it('should return string unchanged when equal to target length', () => {
    expect(padRight('hello', 5)).toBe('hello');
  });

  it('should return string unchanged when longer than target length', () => {
    expect(padRight('hello world', 5)).toBe('hello world');
  });

  it('should handle empty string', () => {
    expect(padRight('', 3)).toBe('   ');
  });
});
