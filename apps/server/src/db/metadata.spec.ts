import { randomInt } from 'node:crypto';
import { newMetadata } from './metadata.js';

vi.mock('node:crypto', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:crypto')>()),
  randomInt: vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(0xff_ff_ff_ff),
}));

describe('newMetadata', () => {
  it('allocates dataset identities independently of a frozen clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
    try {
      const first = newMetadata({ lastId: 0 });
      const second = newMetadata({ lastId: 0 });
      expect(randomInt).toHaveBeenCalledWith(1, 0x1_00_00_00_00);
      expect(second.mailboxId).not.toBe(first.mailboxId);
      expect(second.uidValidity).not.toBe(first.uidValidity);
      for (const meta of [first, second]) {
        expect(meta.uidValidity).toBeGreaterThan(0);
        expect(meta.uidValidity).toBeLessThanOrEqual(0xff_ff_ff_ff);
        expect(meta).toMatchObject({ lastId: 0, uidNext: 1 });
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
