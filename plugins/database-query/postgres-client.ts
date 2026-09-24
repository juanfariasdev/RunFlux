import pg from 'pg';
import type { Logger } from '@runflux/runtime';

export type DatabaseRow = Record<string, unknown>;

/** Runs parameterized SQL against the database a connection string points to. */
export interface DatabaseClient {
  query(connectionString: string, sql: string, values: readonly unknown[]): Promise<DatabaseRow[]>;
  close(): Promise<void>;
}

/** The part of a `pg.Pool` the client uses. */
export interface PostgresPool {
  query(sql: string, values: unknown[]): Promise<{ rows: DatabaseRow[] }>;
  end(): Promise<void>;
}

export type PostgresPoolFactory = (connectionString: string, logger: Logger) => PostgresPool;

export const createPostgresPool: PostgresPoolFactory = (connectionString, logger) => {
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 10_000, allowExitOnIdle: true });
  pool.on('error', (error: Error) => logger.error('[database-query] Idle connection error:', error.message));
  return pool;
};

/** PostgreSQL client that keeps one connection pool per connection string. */
export class PostgresClient implements DatabaseClient {
  private readonly pools = new Map<string, PostgresPool>();

  constructor(
    private readonly logger: Logger,
    private readonly createPool: PostgresPoolFactory = createPostgresPool,
  ) {}

  async query(connectionString: string, sql: string, values: readonly unknown[]): Promise<DatabaseRow[]> {
    let pool = this.pools.get(connectionString);
    if (!pool) {
      pool = this.createPool(connectionString, this.logger);
      this.pools.set(connectionString, pool);
    }
    return (await pool.query(sql, [...values])).rows;
  }

  /** Ends every pool. The client can be used again afterwards; it opens new pools on demand. */
  async close(): Promise<void> {
    const pools = [...this.pools.values()];
    this.pools.clear();
    await Promise.all(pools.map((pool) => pool.end()));
  }
}
