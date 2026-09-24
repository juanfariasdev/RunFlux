import { afterEach, expect, it, vi } from 'vitest';
import { compiledRun, context, loadPlugin } from './helpers';

const query = vi.hoisted(() => vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ id: 7 }] })));
const end = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('pg', () => ({ default: { Pool: class { query = query; end = end; on() { return this; } } } }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

it('database-query executes parameterized SQL in production and in generated backends', async () => {
  vi.stubEnv('CONTRACT_DATABASE_URL', 'postgres://localhost/contract');
  const plugin = await loadPlugin('database-query');
  const params = { query: 'SELECT id FROM users WHERE name = $1', queryParams: ["O'Reilly"], connectionEnvVar: 'CONTRACT_DATABASE_URL', outputMode: 'first' };
  expect(await plugin.execute!(params, {}, { ...context, mode: 'production' })).toEqual({ id: 7 });
  const pg = { Pool: class { query = query; end = end; on() { return this; } } };
  for (const platform of plugin.manifest.supportedPlatforms) {
    expect(await compiledRun(plugin, platform, params, { pg })({}, context)).toEqual({ id: 7 });
  }
  expect(query.mock.calls).toEqual(Array.from({ length: 3 }, () => ['SELECT id FROM users WHERE name = $1', ["O'Reilly"]]));
});

it('database-query rejects unsupported engines and missing credentials without querying a different database', async () => {
  const plugin = await loadPlugin('database-query');
  await expect(plugin.execute!({ databaseType: 'sqlite' }, {}, { ...context, mode: 'production' })).rejects.toThrow('unsupported database engine');
  vi.stubEnv('DATABASE_URL', 'postgres://unrelated/database');
  await expect(plugin.execute!({ connectionEnvVar: 'MISSING_CONTRACT_URL' }, {}, { ...context, mode: 'production' })).rejects.toThrow('MISSING_CONTRACT_URL');
  expect(query).not.toHaveBeenCalled();
});

it('database-query preserves SQL literals and resolves bound values from workflow data', async () => {
  vi.stubEnv('CONTRACT_DATABASE_URL', 'postgres://localhost/contract');
  const plugin = await loadPlugin('database-query');
  const params = { query: "SELECT '{{ literal }}', $1", queryParams: ['{{ $json.id }}'], connectionEnvVar: 'CONTRACT_DATABASE_URL' };
  for (const platform of plugin.manifest.supportedPlatforms) {
    const pg = { Pool: class { query = query; end = end; on() { return this; } } };
    expect(await compiledRun(plugin, platform, params, { pg })({ id: 7 }, context)).toEqual([{ id: 7 }]);
  }
  expect(query).toHaveBeenCalledWith("SELECT '{{ literal }}', $1", [7]);
});
