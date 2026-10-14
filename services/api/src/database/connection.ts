import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Database } from './database.types';
import * as schema from './schema';

export function createPool(connectionString: string): Pool {
  // The pool connects lazily, so building the app (e.g. to emit OpenAPI) needs no database.
  return new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}

export function createDatabase(pool: Pool): Database {
  return drizzle({ client: pool, schema });
}

/** Replaces the password in a connection string so it can be printed. */
export function redactDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '<invalid DATABASE_URL>';
  }
}
