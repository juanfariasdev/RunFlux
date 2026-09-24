import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runWorkflow } from '@runflux/validation-runtime';
import { ExportedProject } from '../support/exported-project';
import { compile, edge, editorRegistry, node, workflow } from '../support/workflows';

// The editor's copy of the plugin talks to this mocked driver; exported backends load the fake
// package in tests/support/fake-pg instead. PostgreSQL is only replaced at the driver boundary.
const driver = vi.hoisted(() => ({ query: vi.fn(async () => ({ rows: [{ id: 7 }] })) }));
vi.mock('pg', () => ({ default: { Pool: class { query = driver.query; end = async () => {}; on() { return this; } } } }));

type FakePg = { queries: Array<{ sql: string; values: unknown[] }>; rows: unknown[]; pools: Array<{ connectionString: string }> };
const fakePg = () => (globalThis as { __fakePg?: FakePg }).__fakePg;

afterEach(() => {
  vi.unstubAllEnvs();
  driver.query.mockClear();
  delete (globalThis as { __fakePg?: FakePg }).__fakePg;
});

const lookup = (parameters: Record<string, unknown>) => workflow(
  [node('start', 'trigger-manual-example'), node('seed', 'set', { fields: [{ name: 'name', value: "O'Reilly" }] }), node('db', 'database-query', parameters)],
  [edge('start', 'seed'), edge('seed', 'db')],
);

describe('database-query', () => {
  const parameters = { query: "SELECT id FROM users WHERE name = $1 AND note = '{{ literal }}'", queryParams: ['{{ $json.name }}'], connectionEnvVar: 'CONTRACT_DATABASE_URL', outputMode: 'first' };

  it('binds workflow data to the literal SQL in the editor production mode', async () => {
    vi.stubEnv('CONTRACT_DATABASE_URL', 'postgres://localhost/contract');
    const run = await runWorkflow(lookup(parameters), await editorRegistry(), { mode: 'production' });
    expect(run.nodeResults.find((result) => result.nodeId === 'db')).toMatchObject({ output: { id: 7 }, error: null });
    expect(driver.query).toHaveBeenCalledWith(parameters.query, ["O'Reilly"]);
  });

  it('simulates rows in the editor sandbox without touching the driver', async () => {
    const run = await runWorkflow(lookup(parameters), await editorRegistry(), { mode: 'sandbox' });
    expect(run.nodeResults.find((result) => result.nodeId === 'db')?.output).toMatchObject({ name: "O'Reilly", query_executed: parameters.query, success: true });
    expect(driver.query).not.toHaveBeenCalled();
  });

  it('runs the same query from an exported backend, which always uses the database', async () => {
    const project = await ExportedProject.write(await compile(lookup(parameters)), { packages: { pg: resolve('tests/support/fake-pg') } });
    try {
      vi.stubEnv('CONTRACT_DATABASE_URL', 'postgres://localhost/contract');
      const execution = await (await project.engine()).run();
      expect(execution.record('db')).toMatchObject({ output: { id: 7 }, error: null });
      expect(fakePg()?.queries).toEqual([{ sql: parameters.query, values: ["O'Reilly"] }]);
      expect(fakePg()?.pools).toMatchObject([{ connectionString: 'postgres://localhost/contract' }]);
      expect(project.json('package.json').dependencies.pg).toBe('^8.13.0');
      expect(project.text('.env.example')).toContain('CONTRACT_DATABASE_URL=');
    } finally {
      await project.dispose();
    }
  });

  it('never queries another database when its connection variable is missing', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://unrelated/database');
    const run = await runWorkflow(lookup({ connectionEnvVar: 'MISSING_CONTRACT_URL' }), await editorRegistry(), { mode: 'production' });
    expect(run.nodeResults.find((result) => result.nodeId === 'db')?.error).toBe('database-query: environment variable "MISSING_CONTRACT_URL" is required');
    expect(driver.query).not.toHaveBeenCalled();
  });

  it('rejects unsupported engines before connecting', async () => {
    const run = await runWorkflow(lookup({ databaseType: 'sqlite' }), await editorRegistry(), { mode: 'production' });
    expect(run.nodeResults.find((result) => result.nodeId === 'db')?.error).toBe('database-query: parameter "databaseType" must be one of "postgres"');
  });
});
