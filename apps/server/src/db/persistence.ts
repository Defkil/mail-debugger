import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import type { Database } from 'sql.js';

export const DATABASE_FILE = 'mail-debugger.sqlite';
export const LOCK_FILE = 'mail-debugger.lock';

/** Thrown when an existing lock prevents opening the data directory. */
export class DataDirectoryInUseError extends Error {
  constructor(
    readonly lockFile: string,
    readonly pid: number | undefined,
  ) {
    super(
      `The data directory is locked${pid === undefined ? '' : ` by process ${pid}`}. Stop that mail-debugger. If it stopped without releasing its lock, delete ${lockFile} only after checking that no process uses this directory.`,
    );
    this.name = 'DataDirectoryInUseError';
  }
}

export interface DataDirectoryLock {
  release(): void;
}

/**
 * Takes the exclusive lock of a data directory. sql.js keeps the database in
 * memory and writes snapshots, so two processes on the same file would
 * overwrite each other's mail. Existing locks are never removed here: an
 * incomplete PID write can belong to a live process, and concurrent stale
 * lock reclamations can otherwise remove a new owner's lock.
 */
export function lockDataDirectory(dir: string): DataDirectoryLock {
  fs.mkdirSync(dir, { recursive: true });
  const lockFile = path.join(dir, LOCK_FILE);
  try {
    fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid }), {
      flag: 'wx',
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new DataDirectoryInUseError(lockFile, readLockPid(lockFile));
  }
  return {
    release() {
      try {
        if (readLockPid(lockFile) === process.pid) fs.unlinkSync(lockFile);
      } catch {
        // Already gone.
      }
    },
  };
}

function readLockPid(lockFile: string): number | undefined {
  try {
    const { pid } = JSON.parse(fs.readFileSync(lockFile, 'utf8')) as {
      pid?: unknown;
    };
    return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0
      ? pid
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Writes `data` to `file` through a temporary file in the same directory and
 * a rename, so a crash never leaves a half-written database behind.
 */
export async function writeFileAtomic(
  file: string,
  data: Uint8Array,
): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    const handle = await fs.promises.open(temporary, 'w');
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // Windows refuses the rename while a virus scanner or indexer holds the
    // target open; such locks are brief.
    for (let attempt = 0; ; attempt++) {
      try {
        await fs.promises.rename(temporary, file);
        return;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY')) {
          throw error;
        }
        await sleep(50 * (attempt + 1));
      }
    }
  } catch (error) {
    await fs.promises.rm(temporary, { force: true });
    throw error;
  }
}

export interface SnapshotWriterOptions {
  /** Delay between a change and the snapshot that contains it. */
  delayMs: number;
  /** Runs after every export; sql.js drops custom SQL functions on export. */
  afterExport(): void;
  /** Reports a failed background snapshot; the next change retries. */
  onError(error: unknown): void;
}

/**
 * Persists an in-memory sql.js database: snapshots are coalesced after
 * changes, never overlap, and {@link SnapshotWriter.close} writes the final
 * state. Durability is limited to the last snapshot.
 */
export class SnapshotWriter {
  private timer: NodeJS.Timeout | undefined;
  private writing: Promise<void> | undefined;
  private dirty = false;
  private closed = false;

  constructor(
    private readonly db: Database,
    private readonly file: string,
    private readonly options: SnapshotWriterOptions,
  ) {}

  /** Schedules a snapshot after the configured delay. */
  schedule(): void {
    if (this.closed) return;
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flushReportingErrors();
    }, this.options.delayMs);
  }

  /** Writes pending changes now and waits for the write. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    while (this.writing) {
      try {
        await this.writing;
      } catch {
        // The flush that started this write reports its failure.
      }
    }
    if (!this.dirty) return;
    this.dirty = false;
    this.writing = this.write();
    try {
      await this.writing;
    } finally {
      this.writing = undefined;
    }
  }

  private async flushReportingErrors(): Promise<void> {
    try {
      await this.flush();
    } catch (error) {
      this.options.onError(error);
    }
  }

  /** Writes the final snapshot; later changes are no longer persisted. */
  async close(): Promise<void> {
    this.closed = true;
    await this.flush();
  }

  private async write(): Promise<void> {
    try {
      let data: Uint8Array;
      try {
        data = this.db.export();
      } finally {
        this.options.afterExport();
      }
      await writeFileAtomic(this.file, data);
    } catch (error) {
      this.dirty = true;
      throw error;
    }
  }
}
