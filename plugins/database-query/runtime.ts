import pg from 'pg';

const pools = new Map<string, pg.Pool>();

export async function queryDatabase(params: Record<string, unknown>, env: Record<string, string | undefined>): Promise<unknown> {
  const databaseType = params.databaseType ?? 'postgres';
  if (databaseType !== 'postgres') throw new Error(`database-query: unsupported database engine "${databaseType}"`);
  const outputMode = params.outputMode ?? 'all';
  if (outputMode !== 'all' && outputMode !== 'first') throw new Error('database-query: outputMode must be "all" or "first"');
  const query = typeof params.query === 'string' && params.query.trim() ? params.query.trim() : 'SELECT 1;';
  const values = params.queryParams ?? [];
  if (!Array.isArray(values)) throw new Error('database-query: queryParams must be an array');
  const envKey = typeof params.connectionEnvVar === 'string' && params.connectionEnvVar ? params.connectionEnvVar : 'DATABASE_URL';
  const connectionString = env[envKey];
  if (!connectionString) throw new Error(`database-query: environment variable "${envKey}" is required`);
  let pool = pools.get(connectionString);
  if (!pool) {
    pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 10000, allowExitOnIdle: true });
    pool.on('error', (error: Error) => console.error('[database-query] Idle connection error:', error.message));
    pools.set(connectionString, pool);
  }
  const { rows } = await pool.query(query, values);
  return outputMode === 'first' ? rows[0] ?? null : rows;
}

/** Release pools during server shutdown or when replacing the plugin. */
export async function closeDatabasePools(): Promise<void> {
  const active = [...pools.values()];
  pools.clear();
  await Promise.all(active.map((pool) => pool.end()));
}
