import * as fs from 'node:fs';
import initSqlJs, { type Database } from 'sql.js';
import type { Config } from '../types.js';
import { CREATE_EMAILS_TABLE, CREATE_INDEXES } from './schema.js';

const PERSIST_FILE = 'mail-debugger.sqlite';

export async function createDatabase(config: Config): Promise<Database> {
  const SQL = await initSqlJs();

  let db: Database;
  if (config.persist && fs.existsSync(PERSIST_FILE)) {
    const buffer = fs.readFileSync(PERSIST_FILE);
    db = new SQL.Database(new Uint8Array(buffer));
  } else {
    db = new SQL.Database();
    db.exec(CREATE_EMAILS_TABLE);
    for (const idx of CREATE_INDEXES) {
      db.exec(idx);
    }
  }

  return db;
}

export function persistDatabase(db: Database): void {
  const data = db.export();
  fs.writeFileSync(PERSIST_FILE, data);
}
