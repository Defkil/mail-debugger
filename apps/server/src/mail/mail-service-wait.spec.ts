import type { MailStore } from '../db/store.js';
import {
  attachmentMessage,
  createTestService,
  rawMessage,
} from '../testing/mail-fixtures.js';
import { ShuttingDownError } from './errors.js';
import { MAX_ACTIVE_WAITS, type MailService } from './mail-service.js';

describe('MailService cursors', () => {
  let service: MailService;
  let store: MailStore;

  beforeEach(async () => {
    ({ service, store } = await createTestService());
  });

  afterEach(async () => {
    await store.close();
  });

  const listeners = () => service.events.listenerCount('inserted');

  describe('waitForEmail', () => {
    it('returns the lowest stored match above the cursor at once', async () => {
      await service.receive(rawMessage({ to: 'a@example.com' }), null);
      await service.receive(rawMessage({ to: 'b@example.com' }), null);
      await service.receive(rawMessage({ to: 'b@example.com' }), null);

      await expect(
        service.waitForEmail({
          afterId: 1,
          filter: { to: 'B@EXAMPLE' },
          timeoutMs: 0,
        }),
      ).resolves.toEqual({
        data: expect.objectContaining({ id: 2, to: ['b@example.com'] }),
        timedOut: false,
        highWatermark: 3,
        mailboxId: service.cursor().mailboxId,
      });
    });

    it('waits for the next matching arrival', async () => {
      const pending = service.waitForEmail({
        afterId: 0,
        filter: { subject: 'wanted' },
        timeoutMs: 5000,
      });
      await service.receive(rawMessage({ subject: 'other' }), null);
      await service.receive(rawMessage({ subject: 'The wanted one' }), null);

      await expect(pending).resolves.toMatchObject({
        data: { id: 2, subject: 'The wanted one' },
        timedOut: false,
        highWatermark: 2,
      });
      expect(listeners()).toBe(0);
    });

    it('times out with the cursor of an empty mailbox', async () => {
      await expect(
        service.waitForEmail({ afterId: 0, timeoutMs: 20 }),
      ).resolves.toEqual({
        data: null,
        timedOut: true,
        highWatermark: 0,
        mailboxId: service.cursor().mailboxId,
      });
      expect(listeners()).toBe(0);
    });

    it('only checks the stored emails for timeoutMs 0', async () => {
      await expect(
        service.waitForEmail({ afterId: 0, timeoutMs: 0 }),
      ).resolves.toMatchObject({ data: null, timedOut: true });
      expect(listeners()).toBe(0);
    });

    it('rejects foreign or future cursors and invalid arguments', async () => {
      await service.receive(rawMessage(), null);
      const wait = (
        options: Partial<Parameters<MailService['waitForEmail']>[0]>,
      ) => service.waitForEmail({ afterId: 0, timeoutMs: 0, ...options });

      await expect(wait({ mailboxId: 'another' })).rejects.toMatchObject({
        code: 'INVALID_CURSOR',
      });
      await expect(wait({ afterId: 2 })).rejects.toMatchObject({
        code: 'INVALID_CURSOR',
      });
      await expect(wait({ afterId: -1 })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      await expect(wait({ timeoutMs: 60_001 })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      await expect(wait({ filter: { since: 'soon' } })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT',
      });
      await expect(
        wait({ afterId: 1, mailboxId: service.cursor().mailboxId }),
      ).resolves.toMatchObject({ timedOut: true, highWatermark: 1 });
    });

    it('keeps cursors valid across clear', async () => {
      await service.receive(rawMessage(), null);
      service.clear('rest');
      const { highWatermark } = service.list(undefined);
      expect(highWatermark).toBe(1);

      const pending = service.waitForEmail({
        afterId: highWatermark,
        timeoutMs: 5000,
      });
      await service.receive(rawMessage({ subject: 'after clear' }), null);
      await expect(pending).resolves.toMatchObject({
        data: { id: 2, subject: 'after clear' },
      });
    });

    it('stops waiting when the signal aborts', async () => {
      const controller = new AbortController();
      const pending = service.waitForEmail({
        afterId: 0,
        timeoutMs: 5000,
        signal: controller.signal,
      });
      controller.abort();

      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(listeners()).toBe(0);
    });

    it('ends pending waits on shutdown and refuses new ones', async () => {
      const pending = service.waitForEmail({ afterId: 0, timeoutMs: 5000 });
      service.stopAccepting();

      await expect(pending).rejects.toBeInstanceOf(ShuttingDownError);
      await expect(
        service.waitForEmail({ afterId: 0, timeoutMs: 0 }),
      ).rejects.toBeInstanceOf(ShuttingDownError);
      expect(listeners()).toBe(0);
    });

    it(`allows at most ${MAX_ACTIVE_WAITS} pending waits`, async () => {
      const controller = new AbortController();
      const pending = Array.from({ length: MAX_ACTIVE_WAITS }, () =>
        service.waitForEmail({
          afterId: 0,
          timeoutMs: 5000,
          signal: controller.signal,
        }),
      );

      await expect(
        service.waitForEmail({ afterId: 0, timeoutMs: 5000 }),
      ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
      await expect(
        service.waitForEmail({ afterId: 0, timeoutMs: 0 }),
      ).resolves.toMatchObject({ timedOut: true });

      controller.abort();
      await Promise.allSettled(pending);
      expect(listeners()).toBe(0);
      const next = service.waitForEmail({ afterId: 0, timeoutMs: 5000 });
      await service.receive(rawMessage(), null);
      await expect(next).resolves.toMatchObject({ data: { id: 1 } });
    });
  });

  describe('getAttachment', () => {
    it('returns the decoded bytes, name and declared type', async () => {
      await service.receive(
        attachmentMessage({
          filename: 'résumé.bin',
          contentType: 'application/x-custom',
          bytes: new Uint8Array([0x00, 0x01, 0x02, 0xff]),
        }),
        null,
      );

      expect(service.getAttachment(1, 0)).toEqual({
        filename: 'résumé.bin',
        contentType: 'application/x-custom',
        bytes: Buffer.from([0x00, 0x01, 0x02, 0xff]),
      });
    });

    it('reports missing emails and attachments', async () => {
      await service.receive(rawMessage(), null);

      expect(() => service.getAttachment(2, 0)).toThrow(
        expect.objectContaining({ code: 'EMAIL_NOT_FOUND' }),
      );
      for (const index of [0, -1, 1.5]) {
        expect(() => service.getAttachment(1, index)).toThrow(
          expect.objectContaining({ code: 'ATTACHMENT_NOT_FOUND' }),
        );
      }
    });
  });
});
