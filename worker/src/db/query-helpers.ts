import type { SqlStorage } from '@cloudflare/workers-types';

export function firstRow<T>(sql: SqlStorage, query: string, ...params: unknown[]): T | null {
  const rows = [...sql.exec(query, ...params).toArray()];
  return rows.length ? (rows[0] as T) : null;
}
