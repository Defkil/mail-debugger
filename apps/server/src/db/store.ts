import fs from 'node:fs';
import path from 'node:path';
import type { Database } from 'sql.js';
import type { Logger } from '../logger.js';
import { openDatabase, registerFunctions } from './database.js';
import { EmailRepository } from './email-repository.js';
import {
  DATABASE_FILE,
  lockDataDirectory,
  SnapshotWriter,
  writeFileAtomic,
  type DataDirectoryLock,
} from './persistence.js';

/** Debounce between a change and the snapshot that persists it. */
export const SNAPSHOT_DELAY_MS = 250;

export interface StoreOptions {
  /** Directory of the persistent database; omit for an in-memory store. */
  dataDir?: string;
  logger: Logger;
  snapshotDelayMs?: number;
}

/** The opened canonical store: one sql.js database, optionally persisted. */
export interface MailStore {
  readonly db: Database;
  readonly repository: EmailRepository;
  readonly persistent: boolean;
  /** Path of the database file, for persistent stores. */
  readonly file?: string;
  /** Schedules a snapshot after a change (no-op in memory). */
  changed(): void;
  /** Writes pending changes now (no-op in memory). */
  flush(): Promise<void>;
  /** Writes the final snapshot, closes the database and releases the lock. */
  close(): Promise<void>;
}

/**
 * Opens the mailbox. A persistent store locks its data directory, loads the
 * database file and migrates an older format; before writing the migrated
 * data it copies the original file next to it, and a failed migration
 * leaves the original untouched.
 */
export async function openStore(options: StoreOptions): Promise<MailStore> {
  if (!options.dataDir) {
    const { db } = await openDatabase();
    return {
      db,
      repository: new EmailRepository(db),
      persistent: false,
      changed() {
        // Nothing to persist.
      },
      async flush() {
        // Nothing to persist.
      },
      async close() {
        db.close();
      },
    };
  }

  const dir = path.resolve(options.dataDir);
  const file = path.join(dir, DATABASE_FILE);
  const lock = lockDataDirectory(dir);
  try {
    const bytes = fs.existsSync(file) ? fs.readFileSync(file) : undefined;
    // sql.js may write into the buffer it opens; keep the original for the backup.
    const opened = await openDatabase(bytes && new Uint8Array(bytes));
    const { db } = opened;
    try {
      if (bytes && opened.migration) {
        const backup = backupFile(file, opened.migration.fromVersion);
        fs.writeFileSync(backup, bytes, { flag: 'wx' });
        options.logger.warn(
          {
            messages: opened.migration.messages,
            backup,
          },
          'Migrated the stored mail to the current format. Messages from mail-debugger 0.3 keep their source as 0.3 stored it: bytes that were not valid UTF-8 were already replaced then and cannot be restored.',
        );
      }
      if (!bytes || opened.migration) {
        await writeFileAtomic(file, db.export());
        registerFunctions(db);
      }
      return persistentStore(db, file, lock, options);
    } catch (error) {
      db.close();
      throw error;
    }
  } catch (error) {
    lock.release();
    throw error;
  }
}

function persistentStore(
  db: Database,
  file: string,
  lock: DataDirectoryLock,
  options: StoreOptions,
): MailStore {
  const writer = new SnapshotWriter(db, file, {
    delayMs: options.snapshotDelayMs ?? SNAPSHOT_DELAY_MS,
    afterExport: () => registerFunctions(db),
    onError: (error) =>
      options.logger.error({ err: error }, 'Could not save the mailbox'),
  });
  let closing: Promise<void> | undefined;
  return {
    db,
    repository: new EmailRepository(db),
    persistent: true,
    file,
    changed: () => writer.schedule(),
    flush: () => writer.flush(),
    close() {
      closing ??= (async () => {
        try {
          await writer.close();
        } finally {
          db.close();
          lock.release();
        }
      })();
      return closing;
    },
  };
}

function backupFile(file: string, fromVersion: number): string {
  const base = `${file}.schema${fromVersion}.bak`;
  return fs.existsSync(base)
    ? `${base}.${new Date().toISOString().replaceAll(/[:.]/g, '-')}`
    : base;
}
