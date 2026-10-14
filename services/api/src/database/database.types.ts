import type { PgDatabase } from 'drizzle-orm/pg-core';
import type { NodePgDatabase, NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type * as schema from './schema';

export type Schema = typeof schema;

/** The application database handle. */
export type Database = NodePgDatabase<Schema>;

/** Either the database handle or an open transaction; repositories accept both. */
export type Executor = PgDatabase<NodePgQueryResultHKT, Schema>;

export const DRIZZLE = Symbol('DRIZZLE');
export const PG_POOL = Symbol('PG_POOL');
