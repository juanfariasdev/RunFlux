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
