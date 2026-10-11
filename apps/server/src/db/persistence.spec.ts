import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, registerFunctions } from './database.js';
import { SnapshotWriter, writeFileAtomic } from './persistence.js';

describe('snapshot failure recovery', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-debugger-sol-review-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('preserves the previous snapshot and removes a partial temporary file', async () => {
    const file = path.join(dir, 'mail.sqlite');
    fs.writeFileSync(file, 'previous');
    const open = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, 'open').mockImplementationOnce(async (...args) => {
      const handle = await open(...args);
      vi.spyOn(handle, 'writeFile').mockRejectedValueOnce(
        Object.assign(new Error('Disk full'), { code: 'ENOSPC' }),
      );
      return handle;
    });

    await expect(writeFileAtomic(file, Buffer.from('next'))).rejects.toThrow(
      'Disk full',
    );
    expect(fs.readFileSync(file, 'utf8')).toBe('previous');
    expect(fs.readdirSync(dir)).toEqual(['mail.sqlite']);
  });

  it('retries an export failure when closing instead of forgetting dirty data', async () => {
    const { db } = await openDatabase();
    const file = path.join(dir, 'mail.sqlite');
    const writer = new SnapshotWriter(db, file, {
      delayMs: 10_000,
      afterExport: () => registerFunctions(db),
      onError: vi.fn(),
    });
    try {
      db.run("UPDATE meta SET value = '42' WHERE key = 'last_id'");
      writer.schedule();
      vi.spyOn(db, 'export').mockImplementationOnce(() => {
        throw new Error('Export failed');
      });
      await expect(writer.flush()).rejects.toThrow('Export failed');
      await writer.close();
      const reopened = await openDatabase(fs.readFileSync(file));
      try {
        expect(
          reopened.db.exec("SELECT value FROM meta WHERE key = 'last_id'")[0]
            .values[0][0],
        ).toBe('42');
      } finally {
        reopened.db.close();
      }
    } finally {
      await writer.close();
      db.close();
    }
  });
});
