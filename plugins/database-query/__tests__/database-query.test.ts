import { validateManifest } from '@runflux/plugin-system/sdk';
import { ObjectParameterReader, ServiceRegistry } from '@runflux/runtime';
import { executeNode } from '@runflux/runtime/testing';
import { describe, expect, it, vi } from 'vitest';
import { deployment, manifest } from '../index';
import { PostgresClient, type PostgresPool } from '../postgres-client';
import database, { DATABASE_CLIENT, DatabaseQueryNode, type DatabaseClient } from '../runtime';

function fakeClient(rows: Record<string, unknown>[] = [{ id: 7 }, { id: 8 }]) {
  return { query: vi.fn(async () => rows), close: vi.fn(async () => {}) } satisfies DatabaseClient & { close: unknown };
}

const run = (parameters: Record<string, unknown>, options: { client?: DatabaseClient; mode?: 'sandbox' | 'production'; env?: Record<string, string>; input?: unknown } = {}) =>
  executeNode(database, {
    parameters: { query: 'SELECT 1;', ...parameters },
    literalParameters: ['query', 'connectionEnvVar'],
    mode: options.mode ?? 'production',
    env: options.env ?? { DATABASE_URL: 'postgres://localhost/app' },
    input: options.input ?? { id: 7 },
    services: { extensions: new ServiceRegistry().set(DATABASE_CLIENT, options.client ?? fakeClient()) },
    pluginId: 'database-query',
  });

describe('database-query in production', () => {
  it('declares a literal SQL parameter', () => {
    expect(validateManifest(manifest).success).toBe(true);
    expect(manifest.parameters.find((parameter) => parameter.name === 'query')?.expressions).toBe(false);
    expect(manifest.parameters.find((parameter) => parameter.name === 'connectionEnvVar')).toMatchObject({
      default: '{{$env.DATABASE_URL}}',
      expressions: false,
    });
  });

  it('binds resolved values to a literal query on the configured connection', async () => {
    const client = fakeClient();
    const record = await run({ query: " SELECT '{{ literal }}', $1 ", queryParams: ['{{ $json.id }}'], connectionEnvVar: '{{$env.ORDERS_URL}}' }, { client, env: { ORDERS_URL: 'postgres://orders' } });
    expect(record.output).toEqual([{ id: 7 }, { id: 8 }]);
    expect(client.query).toHaveBeenCalledWith('postgres://orders', "SELECT '{{ literal }}', $1", [7]);
  });

  it('outputs the first row, or null, in first mode', async () => {
    expect((await run({ outputMode: 'first' })).output).toEqual({ id: 7 });
    expect((await run({ outputMode: 'first' }, { client: fakeClient([]) })).output).toBeNull();
  });

  it('never falls back to another connection when its variable is missing', async () => {
    const client = fakeClient();
    const record = await run({ connectionEnvVar: '{{$env.MISSING_URL}}' }, { client, env: { DATABASE_URL: 'postgres://unrelated' } });
    expect(record.error).toBe('database-query: environment variable "MISSING_URL" is required');
    expect(client.query).not.toHaveBeenCalled();
  });

  it('reports query failures', async () => {
    const client = { query: vi.fn(async () => { throw new Error('relation "users" does not exist'); }) };
    expect((await run({ query: 'SELECT * FROM users' }, { client })).error).toBe('relation "users" does not exist');
  });

  it.each([
    [{ databaseType: 'sqlite' }, 'database-query: parameter "databaseType" must be one of "postgres"'],
    [{ outputMode: 'many' }, 'database-query: parameter "outputMode" must be one of "all", "first"'],
    [{ queryParams: '7' }, 'database-query: parameter "queryParams" must be a list'],
    [{ query: '   ' }, 'database-query: parameter "query" is required'],
    [{ connectionEnvVar: 'ORDERS-URL' }, 'database-query: parameter "connectionEnvVar" "ORDERS-URL" is not an environment variable name'],
  ])('rejects %j before querying', async (parameters, message) => {
    const client = fakeClient();
    expect((await run(parameters, { client })).error).toBe(message);
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('database-query in the sandbox', () => {
  it('checks database connectivity before simulating a safe row', async () => {
    const client = fakeClient();
    const record = await run({ query: 'SELECT * FROM orders WHERE id = $1' }, { client, mode: 'sandbox', input: { orderId: 'ord-1', amount: 150 } });
    expect(record.output).toEqual([{ id: 1, query_executed: 'SELECT * FROM orders WHERE id = $1', success: true, orderId: 'ord-1', amount: 150 }]);
    expect((await run({ outputMode: 'first' }, { client, mode: 'sandbox', input: 'raw' })).output).toEqual({ id: 1, query_executed: 'SELECT 1;', success: true, input: 'raw' });
    expect(client.query).toHaveBeenCalledWith('postgres://localhost/app', 'SELECT 1', []);
  });

  it('fails the sandbox test when the database cannot be reached', async () => {
    const client = { query: vi.fn(async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:5432'); }) };
    const record = await run({}, { client, mode: 'sandbox' });
    expect(record.error).toContain('ECONNREFUSED');
  });
});

describe('PostgresClient', () => {
  const pool = (rows: Record<string, unknown>[]) => ({ query: vi.fn(async () => ({ rows })), end: vi.fn(async () => {}) }) satisfies PostgresPool;
  const logger = { info: vi.fn(), error: vi.fn() };

  it('reuses one pool per connection string and ends them all on close', async () => {
    const pools = new Map<string, ReturnType<typeof pool>>();
    const client = new PostgresClient(logger, (connectionString) => {
      const created = pool([{ connectionString }]);
      pools.set(connectionString, created);
      return created;
    });
    expect(await client.query('postgres://a', 'SELECT 1', [1])).toEqual([{ connectionString: 'postgres://a' }]);
    await client.query('postgres://a', 'SELECT 2', []);
    await client.query('postgres://b', 'SELECT 3', []);
    expect([...pools.keys()]).toEqual(['postgres://a', 'postgres://b']);
    expect(pools.get('postgres://a')!.query.mock.calls).toEqual([['SELECT 1', [1]], ['SELECT 2', []]]);
    await client.close();
    expect([...pools.values()].every((created) => created.end.mock.calls.length === 1)).toBe(true);
  });

  it('leaves an injected client to its owner when the engine disposes the node', async () => {
    const client = fakeClient();
    const handler = database.createHandler({ extensions: new ServiceRegistry().set(DATABASE_CLIENT, client), logger } as never);
    await handler.dispose?.();
    expect(client.close).not.toHaveBeenCalled();
  });

  it('releases what the node owns when it is disposed', async () => {
    const release = vi.fn(async () => {});
    await new DatabaseQueryNode(fakeClient(), release).dispose();
    expect(release).toHaveBeenCalledOnce();
  });

  it('creates its own PostgreSQL client when none is injected', () => {
    const handler = database.createHandler({ extensions: new ServiceRegistry(), logger } as never);
    expect(handler).toBeInstanceOf(DatabaseQueryNode);
  });
});

describe('database-query deployment', () => {
  const reader = (values: Record<string, unknown>) => new ObjectParameterReader(values, 'database-query');

  it('declares the driver, its connection variable and a local PostgreSQL service', () => {
    expect(deployment?.dependencies).toEqual({ pg: '^8.13.0' });
    expect(deployment?.environment?.(reader({ connectionEnvVar: '{{$env.ORDERS_URL}}' }))).toEqual([{ key: 'ORDERS_URL', description: 'PostgreSQL connection string' }]);
    expect(deployment?.environment?.(reader({}))).toEqual([{ key: 'DATABASE_URL', description: 'PostgreSQL connection string' }]);
    expect(Object.keys(deployment?.compose?.services ?? {})).toEqual(['postgres']);
    expect(deployment?.compose?.volumes).toEqual(['pgdata']);
  });
});
