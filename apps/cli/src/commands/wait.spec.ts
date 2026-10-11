import { MAX_WAIT_MS, type WaitResult } from '@mail-debugger/client';
import type { MockInstance } from 'vitest';
import { createMockClient, mockSummary } from './test-fixtures.js';
import { waitCommand } from './wait.js';

let logSpy: MockInstance;
let errorSpy: MockInstance;

beforeEach(() => {
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {
    /* noop */
  });
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {
    /* noop */
  });
});

afterEach(() => {
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

const timedOut = (highWatermark: number): WaitResult => ({
  data: null,
  timedOut: true,
  highWatermark,
  mailboxId: 'm1',
});

describe('waitCommand', () => {
  it('starts at the current high watermark and prints the email', async () => {
    const client = createMockClient({
      listEmails: vi.fn().mockResolvedValue({
        data: [],
        total: 0,
        highWatermark: 7,
        mailboxId: 'm1',
      }),
    });

    await expect(
      waitCommand(client, { timeoutMs: 1000, filter: { to: 'a' } }),
    ).resolves.toBe(0);
    expect(client.listEmails).toHaveBeenCalledWith({ limit: 1 });
    expect(client.waitForEmail).toHaveBeenCalledWith({
      afterId: 7,
      mailboxId: 'm1',
      filter: { to: 'a' },
      timeoutMs: expect.any(Number),
    });
    expect(logSpy.mock.calls[0][0]).toContain('Test Subject');
  });

  it('waits in server-sized steps and moves the cursor', async () => {
    vi.useFakeTimers();
    try {
      const waitForEmail = vi.fn(async (params: { timeoutMs?: number }) => {
        vi.advanceTimersByTime(params.timeoutMs ?? 0);
        return waitForEmail.mock.calls.length < 3
          ? timedOut(10 + waitForEmail.mock.calls.length)
          : { ...timedOut(12), data: mockSummary, timedOut: false };
      });
      const client = createMockClient({ waitForEmail });

      await expect(
        waitCommand(client, { afterId: 3, timeoutMs: 150_000 }, true),
      ).resolves.toBe(0);
      expect(waitForEmail.mock.calls.map(([params]) => params)).toEqual([
        { afterId: 3, timeoutMs: MAX_WAIT_MS },
        { afterId: 11, mailboxId: 'm1', timeoutMs: MAX_WAIT_MS },
        { afterId: 12, mailboxId: 'm1', timeoutMs: 30_000 },
      ]);
      expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toMatchObject({
        data: { id: mockSummary.id },
        timedOut: false,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('exits with 1 when the time runs out', async () => {
    const client = createMockClient({
      waitForEmail: vi.fn().mockResolvedValue(timedOut(4)),
    });

    await expect(
      waitCommand(client, { afterId: 4, timeoutMs: 0 }),
    ).resolves.toBe(1);
    expect(client.waitForEmail).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'No matching email arrived within 0 ms.',
    );
  });

  it('prints the timed-out result as JSON', async () => {
    const client = createMockClient({
      waitForEmail: vi.fn().mockResolvedValue(timedOut(4)),
    });

    await expect(
      waitCommand(client, { afterId: 4, timeoutMs: 0 }, true),
    ).resolves.toBe(1);
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual(timedOut(4));
  });
});
