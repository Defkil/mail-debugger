import Database from 'better-sqlite3';
import type { Config } from '../types.js';
import { CREATE_EMAILS_TABLE, CREATE_INDEXES } from './schema.js';

export function createDatabase(config: Config): Database.Database {
  const db = config.persist
    ? new Database('mail-debugger.sqlite')
    : new Database(':memory:');

  if (config.persist) {
    db.pragma('journal_mode = WAL');
  }

  db.exec(CREATE_EMAILS_TABLE);
  for (const idx of CREATE_INDEXES) {
    db.exec(idx);
  }

  return db;
}
