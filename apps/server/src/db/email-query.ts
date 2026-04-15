import type { SqlValue } from 'sql.js';
import type { EmailFilter } from '@mail-debugger/types';

export interface FilterClause {
  where: string;
  params: SqlValue[];
}

/**
 * Builds a SQL WHERE clause (including the `WHERE` keyword, or empty string)
 * and the matching positional parameter list from an optional EmailFilter.
 */
export function buildFilterClause(filter?: EmailFilter): FilterClause {
  const conditions: string[] = [];
  const params: SqlValue[] = [];

  if (filter?.from) {
    conditions.push('from_addr LIKE ?');
    params.push(`%${filter.from}%`);
  }
  if (filter?.to) {
    conditions.push('to_addr LIKE ?');
    params.push(`%${filter.to}%`);
  }
  if (filter?.subject) {
    conditions.push('subject LIKE ?');
    params.push(`%${filter.subject}%`);
  }
  if (filter?.since) {
    conditions.push('received_at >= ?');
    params.push(filter.since);
  }
  if (filter?.until) {
    conditions.push('received_at <= ?');
    params.push(filter.until);
  }

  return {
    where: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}
