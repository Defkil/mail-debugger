import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import { hasTable, newMetadata, writeMetadata } from './metadata.js';
import { migrateFromLegacy } from './migrations.js';
import { firstRow } from './row-mapper.js';
import { CREATE_SCHEMA, SCHEMA_VERSION } from './schema.js';

let sqlJs: Promise<SqlJsStatic> | undefined;

/** Loads the sql.js WebAssembly module once per process. */
export function loadSqlJs(): Promise<SqlJsStatic> {
  sqlJs ??= initSqlJs();
  return sqlJs;
}

/**
 * Registers the SQL functions the queries use. sql.js drops custom functions
 * whenever the database is exported, so this runs after every snapshot too.
 */
export function registerFunctions(db: Database): void {
  db.create_function('md_fold', (value: unknown) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  );
}

export interface OpenedDatabase {
  db: Database;
  /** Set when an older on-disk format was migrated while opening. */
  migration?: { fromVersion: number; messages: number };
}

/**
 * Opens a database from a snapshot (or a new, empty one) and brings its
 * schema to the current version. Migrations run in a transaction, so a
 * failure leaves `bytes` (and the file they came from) untouched.
 */
export async function openDatabase(
  bytes?: Uint8Array,
): Promise<OpenedDatabase> {
  const SQL = await loadSqlJs();
  const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
  try {
    registerFunctions(db);
    const version = Number(
      firstRow(db.exec('PRAGMA user_version'))?.['user_version'],
    );
    if (version === SCHEMA_VERSION) return { db };
    if (version > SCHEMA_VERSION) {
      throw new Error(
        `The data was written by a newer mail-debugger (schema ${version}; this version reads up to ${SCHEMA_VERSION})`,
      );
    }
    if (version !== 0) {
      throw new Error(`Unsupported storage schema version ${version}`);
    }
    if (!hasTable(db, 'emails')) {
      initializeSchema(db);
      return { db };
    }
    const messages = migrateFromLegacy(db);
    return { db, migration: { fromVersion: 1, messages } };
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Creates the current schema with a fresh mailbox identity. */
function initializeSchema(db: Database): void {
  db.run('BEGIN');
  try {
    for (const statement of CREATE_SCHEMA) db.run(statement);
    writeMetadata(db, newMetadata({ lastId: 0 }));
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.run('COMMIT');
  } catch (error) {
    db.run('ROLLBACK');
    throw error;
  }
}
