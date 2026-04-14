import { formatBytes, timeAgo } from './format';

describe('formatBytes', () => {
  it('should format bytes below 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('should format bytes in KB range', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(1024 * 500)).toBe('500.0 KB');
  });

  it('should format bytes in MB range', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
  });
});

describe('timeAgo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return "just now" for less than 60 seconds', () => {
    const now = new Date('2026-01-15T11:59:30Z').toISOString();
    expect(timeAgo(now)).toBe('just now');
  });

  it('should return minutes ago', () => {
    const fiveMinutesAgo = new Date('2026-01-15T11:55:00Z').toISOString();
    expect(timeAgo(fiveMinutesAgo)).toBe('5m ago');
  });

  it('should return hours ago', () => {
    const twoHoursAgo = new Date('2026-01-15T10:00:00Z').toISOString();
    expect(timeAgo(twoHoursAgo)).toBe('2h ago');
  });

  it('should return days ago', () => {
    const threeDaysAgo = new Date('2026-01-12T12:00:00Z').toISOString();
    expect(timeAgo(threeDaysAgo)).toBe('3d ago');
  });
});
