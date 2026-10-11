import { writeMetadata } from '../db/metadata.js';
import { createTestService, rawMessage } from '../testing/mail-fixtures.js';
import {
  InvalidArgumentError,
  MessageTooLargeError,
  ShuttingDownError,
  StorageFullError,
} from './errors.js';
import type { MailEventMap } from './mail-events.js';
import { MAX_IMAP_NUMBER, type MailService } from './mail-service.js';

function record<K extends keyof MailEventMap>(service: MailService, event: K) {
  const events: MailEventMap[K][] = [];
  service.events.on(event, (payload) => {
    events.push(payload);
  });
  return events;
}

describe('MailService', () => {
  describe('receive', () => {
    it('stores the exact octets and announces the email once after commit', async () => {
      const { service, store } = await createTestService();
      const inserted = record(service, 'inserted');
      let countAtEvent = -1;
      service.events.on('inserted', () => {
        countAtEvent = service.stats().count;
      });
      const raw = Buffer.concat([
        rawMessage({ subject: 'Bytes' }),
        Buffer.from([0x0d, 0x0a, 0xff, 0xfe]),
      ]);

      const received = await service.receive(raw, {
        from: 'bounce@example.com',
        to: ['recipient@example.com', 'hidden@example.com'],
      });

      expect(received).toMatchObject({
        id: 1,
        uid: 1,
        summary: { subject: 'Bytes' },
      });
      expect(Buffer.from(service.getRaw(1) ?? [])).toEqual(raw);
      expect(service.get(1)?.envelope).toEqual({
        from: 'bounce@example.com',
        to: ['recipient@example.com', 'hidden@example.com'],
      });
      expect(inserted).toHaveLength(1);
      expect(inserted[0]).toMatchObject({ id: 1, uid: 1, origin: 'smtp' });
      expect(Object.isFrozen(inserted[0])).toBe(true);
      expect(countAtEvent).toBe(1);
      await store.close();
    });

    it('timestamps in UTC ISO 8601 with milliseconds', async () => {
      const { service, store } = await createTestService();
      const { summary } = await service.receive(rawMessage(), null);
      expect(summary.receivedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
      await store.close();
    });

    it('refuses messages over the size limit', async () => {
      const { service, store } = await createTestService({
        maxMessageBytes: 10,
      });
      await expect(service.receive(rawMessage(), null)).rejects.toBeInstanceOf(
        MessageTooLargeError,
      );
      expect(service.stats().count).toBe(0);
      await store.close();
    });

    it('refuses new mail at the message limit without deleting older mail', async () => {
      const { service, store } = await createTestService({ maxMessages: 2 });
      await service.receive(rawMessage(), null);
      await service.receive(rawMessage(), null);
      const inserted = record(service, 'inserted');

      await expect(service.receive(rawMessage(), null)).rejects.toBeInstanceOf(
        StorageFullError,
      );
      expect(() => service.assertCapacity()).toThrow(StorageFullError);
      expect(service.stats().count).toBe(2);
      expect(inserted).toHaveLength(0);
      await store.close();
    });

    it('refuses new mail at the storage limit', async () => {
      const raw = rawMessage({ text: 'x'.repeat(400) });
      const { service, store } = await createTestService({
        maxStorageBytes: raw.length * 2 + 100,
        maxMessageBytes: raw.length,
      });
      await service.receive(raw, null);
      await expect(service.receive(raw, null)).rejects.toThrow(/storage limit/);
      await store.close();
    });

    it('reserves the highest IMAP number for UIDNEXT without allocating or reusing it', async () => {
      const { service, store } = await createTestService();
      try {
        writeMetadata(store.db, {
          ...store.repository.metadata(),
          uidNext: MAX_IMAP_NUMBER - 1,
        });
        const inserted = record(service, 'inserted');
        expect(() => service.assertCapacity()).not.toThrow();
        const received = await service.receive(rawMessage(), null);
        expect(received.uid).toBe(MAX_IMAP_NUMBER - 1);
        expect(service.imapState().uidNext).toBe(MAX_IMAP_NUMBER);
        const before = store.repository.metadata();
        const stats = service.stats();

        expect(() => service.assertCapacity()).toThrow(StorageFullError);
        await expect(
          service.receive(rawMessage(), null),
        ).rejects.toBeInstanceOf(StorageFullError);
        expect(store.repository.metadata()).toEqual(before);
        expect(service.stats()).toEqual(stats);
        expect(service.get(received.id)).toBeDefined();
        expect(inserted).toHaveLength(1);

        service.clear('rest');
        expect(() => service.assertCapacity()).toThrow(StorageFullError);
        expect(service.imapState().uidNext).toBe(MAX_IMAP_NUMBER);
      } finally {
        await store.close();
      }
    });

    it('refuses mail after stopAccepting', async () => {
      const { service, store } = await createTestService();
      service.stopAccepting();
      await expect(service.receive(rawMessage(), null)).rejects.toBeInstanceOf(
        ShuttingDownError,
      );
      await store.close();
    });
  });

  describe('list', () => {
    it('validates the page window and the filter', async () => {
      const { service, store } = await createTestService();
      expect(() => service.list(undefined, { limit: 0, offset: 0 })).toThrow(
        InvalidArgumentError,
      );
      expect(() => service.list(undefined, { limit: 201, offset: 0 })).toThrow(
        /limit/,
      );
      expect(() => service.list(undefined, { limit: 10, offset: -1 })).toThrow(
        /offset/,
      );
      expect(() => service.list({ since: 'tomorrow' })).toThrow(/since/);
      expect(service.list(undefined)).toEqual({
        data: [],
        total: 0,
        highWatermark: 0,
        mailboxId: service.identity().mailboxId,
      });
      await store.close();
    });

    it('defaults to the first 50 emails', async () => {
      const { service, store } = await createTestService();
      for (let i = 0; i < 52; i++) await service.receive(rawMessage(), null);
      const page = service.list(undefined);
      expect(page.total).toBe(52);
      expect(page.data).toHaveLength(50);
      expect(page.data[0].id).toBe(52);
      await store.close();
    });
  });

  describe('deletion', () => {
    it('deletes one email and announces it once', async () => {
      const { service, store } = await createTestService();
      await service.receive(rawMessage(), null);
      const deleted = record(service, 'deleted');

      expect(service.delete(1, 'rest')).toBe(true);
      expect(service.delete(1, 'rest')).toBe(false);
      expect(deleted).toEqual([
        { emails: [{ id: 1, uid: 1 }], cleared: false, origin: 'rest' },
      ]);
      await store.close();
    });

    it('clears all emails and keeps the high watermark', async () => {
      const { service, store } = await createTestService();
      await service.receive(rawMessage(), null);
      await service.receive(rawMessage(), null);
      const deleted = record(service, 'deleted');

      expect(service.clear('rest')).toBe(2);
      expect(service.clear('rest')).toBe(0);
      expect(deleted).toHaveLength(1);
      expect(deleted[0]).toMatchObject({ cleared: true, origin: 'rest' });
      expect(service.highWatermark()).toBe(2);
      const next = await service.receive(rawMessage(), null);
      expect(next.id).toBe(3);
      await store.close();
    });
  });

  describe('setFlags', () => {
    it('stores flags of existing emails and announces the applied changes', async () => {
      const { service, store } = await createTestService();
      await service.receive(rawMessage(), null);
      const flags = record(service, 'flags');

      const applied = service.setFlags(
        [
          { id: 1, flags: [String.raw`\Seen`] },
          { id: 9, flags: [String.raw`\Seen`] },
        ],
        'imap',
      );

      expect(applied).toEqual([{ id: 1, uid: 1, flags: [String.raw`\Seen`] }]);
      expect(service.getFlags(1)).toEqual([String.raw`\Seen`]);
      expect(flags).toHaveLength(1);
      await store.close();
    });

    it('rejects invalid flags without changing anything', async () => {
      const { service, store } = await createTestService();
      await service.receive(rawMessage(), null);
      expect(() =>
        service.setFlags([{ id: 1, flags: [String.raw`\Recent`] }], 'imap'),
      ).toThrow(InvalidArgumentError);
      expect(() =>
        service.setFlags([{ id: 1, flags: ['x'.repeat(65)] }], 'imap'),
      ).toThrow(InvalidArgumentError);
      expect(service.getFlags(1)).toEqual([]);
      await store.close();
    });
  });

  it('keeps notifying other listeners when one throws', async () => {
    const { service, store } = await createTestService();
    service.events.on('inserted', () => {
      throw new Error('listener failure');
    });
    const inserted = record(service, 'inserted');
    await service.receive(rawMessage(), null);
    expect(inserted).toHaveLength(1);
    expect(service.stats().count).toBe(1);
    await store.close();
  });
});
