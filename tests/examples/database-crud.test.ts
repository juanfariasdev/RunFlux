import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runWorkflow } from '@runflux/validation-runtime';
import { WebhookTestHub } from '@runflux/plugin-system/webhook-test-hub';
import { EditorClient, ExpressClient, LambdaClient, ServerProcessClient, type BackendClient } from '../support/backend-clients';
import { buildExample, loadExample, nodeIds, workflowOf, type ExampleProject } from '../support/examples';
import type { ExportedProject } from '../support/exported-project';
import { TestPostgres } from '../support/postgres';
import { scenariosFor, verify, type Scenario } from '../support/scenarios';
import { editorRegistry } from '../support/workflows';

const ADMIN_KEY = 'admin-test-key';
const ADMIN = { 'X-Admin-Key': ADMIN_KEY };
const INJECTION = "Bobby'); DROP TABLE products;--";

/** One story, run in order against an empty database by every backend. */
const STORY: Scenario[] = [
  { name: 'setup requires the admin key', request: { method: 'POST', path: '/setup' }, status: 401 },
  {
    name: 'setup creates the schema',
    request: { method: 'POST', path: '/setup', headers: ADMIN },
    respondedBy: 'schema-ready',
    result: { ready: true, table: 'products' },
  },
  { name: 'setup can run again', request: { method: 'POST', path: '/setup', headers: ADMIN }, respondedBy: 'schema-ready', result: { ready: true } },
  {
    name: 'create inserts a product and returns the stored row',
    request: { method: 'POST', path: '/products', body: { sku: 'KB-1', name: 'Keyboard', price: 49.9, tags: ['hardware', 'usb'] } },
    respondedBy: 'insert-product',
    result: { id: 1, sku: 'KB-1', name: 'Keyboard', price: '49.90', tags: ['hardware', 'usb'], active: true, updated_at: null },
    check: ({ body }) => expect(Number.isNaN(Date.parse(body.nodeOutputs['insert-product'].created_at))).toBe(false),
  },
  {
    name: 'create reads a price sent as text',
    request: { method: 'POST', path: '/products', body: { sku: 'MS-1', name: 'Mouse', price: '19.9', tags: ['hardware'] } },
    respondedBy: 'insert-product',
    result: { id: 2, price: '19.90' },
  },
  {
    name: 'create binds values as parameters, never as SQL',
    request: { method: 'POST', path: '/products', body: { sku: 'BK-1', name: INJECTION, price: 0 } },
    respondedBy: 'insert-product',
    result: { id: 3, name: INJECTION, price: '0.00', tags: [] },
  },
  {
    name: 'create reports the unique violation of a duplicate sku',
    request: { method: 'POST', path: '/products', body: { sku: 'KB-1', name: 'Again', price: 1 } },
    error: 'duplicate key value violates unique constraint "products_sku_key"',
  },
  {
    name: 'create rejects a product without sku before querying',
    request: { method: 'POST', path: '/products', body: { name: 'Nameless', price: 5 } },
    respondedBy: 'invalid-product',
    result: { error: 'sku, name and a price of zero or more are required' },
    skipped: ['insert-product'],
  },
  {
    name: 'create rejects a negative price before querying',
    request: { method: 'POST', path: '/products', body: { sku: 'NEG', name: 'Negative', price: -1 } },
    respondedBy: 'invalid-product',
  },
  {
    name: 'list returns every product in id order',
    request: { method: 'GET', path: '/products' },
    respondedBy: 'list-products',
    result: [{ id: 1 }, { id: 2 }, { id: 3 }],
    skipped: ['find-product'],
  },
  { name: 'list searches names without case', request: { method: 'GET', path: '/products?search=MOU' }, respondedBy: 'list-products', result: [{ sku: 'MS-1' }] },
  { name: 'list limits the rows', request: { method: 'GET', path: '/products?limit=2' }, respondedBy: 'list-products', result: [{ id: 1 }, { id: 2 }] },
  {
    name: 'get returns one product by id',
    request: { method: 'GET', path: '/products?id=2' },
    respondedBy: 'find-product',
    result: { id: 2, name: 'Mouse' },
    skipped: ['list-products'],
  },
  { name: 'get answers null for an unknown id', request: { method: 'GET', path: '/products?id=999' }, respondedBy: 'find-product', result: null },
  {
    name: 'update changes only the fields sent',
    request: { method: 'PUT', path: '/products?id=2', body: { price: 24.5, active: false } },
    respondedBy: 'product-updated',
    result: { status: 'updated', product: { id: 2, name: 'Mouse', price: '24.50', active: false, tags: ['hardware'] } },
    check: ({ body }) => expect(body.nodeOutputs['product-updated'].product.updated_at).not.toBeNull(),
  },
  {
    name: 'update replaces the jsonb tags',
    request: { method: 'PUT', path: '/products?id=1', body: { tags: ['hardware', 'wireless'] } },
    respondedBy: 'product-updated',
    result: { product: { id: 1, name: 'Keyboard', tags: ['hardware', 'wireless'] } },
  },
  {
    name: 'update of an unknown id answers not found',
    request: { method: 'PUT', path: '/products?id=999', body: { name: 'Ghost' } },
    respondedBy: 'update-missing',
    result: { error: 'product not found' },
    skipped: ['product-updated'],
  },
  { name: 'list filters by active', request: { method: 'GET', path: '/products?active=true' }, respondedBy: 'list-products', result: [{ id: 1 }, { id: 3 }] },
  { name: 'reprice requires the admin key', request: { method: 'POST', path: '/products/reprice', body: { percent: 10 } }, status: 401 },
  {
    name: 'reprice updates every active product in one statement',
    request: { method: 'POST', path: '/products/reprice', headers: ADMIN, body: { percent: 10 } },
    respondedBy: 'reprice-summary',
    result: { updated: 2, products: [{ id: 1, sku: 'KB-1', price: '54.89' }, { id: 3, sku: 'BK-1', price: '0.00' }] },
  },
  {
    name: 'stats combine two queries through $node',
    request: { method: 'GET', path: '/products/stats' },
    respondedBy: 'stats-response',
    result: { total: 3, active: 2, stock_value: '54.89', tags: ['hardware', 'wireless'] },
    ran: ['product-stats', 'tag-list'],
  },
  {
    name: 'delete removes a product and returns its id and sku',
    request: { method: 'DELETE', path: '/products?id=3' },
    respondedBy: 'product-deleted',
    result: { status: 'deleted', id: 3, sku: 'BK-1' },
  },
  {
    name: 'delete of a removed product answers not found',
    request: { method: 'DELETE', path: '/products?id=3' },
    respondedBy: 'delete-missing',
    result: { error: 'product not found' },
  },
  { name: 'reset requires the admin key', request: { method: 'POST', path: '/setup/reset' }, status: 401 },
  { name: 'reset empties the table', request: { method: 'POST', path: '/setup/reset', headers: ADMIN }, respondedBy: 'reset-done', result: { reset: true } },
  { name: 'list is empty after the reset', request: { method: 'GET', path: '/products' }, respondedBy: 'list-products', result: [] },
  {
    name: 'ids start again after the reset',
    request: { method: 'POST', path: '/products', body: { sku: 'NEW-1', name: 'Fresh', price: 1 } },
    respondedBy: 'insert-product',
    result: { id: 1, sku: 'NEW-1' },
  },
];

const HOSTS = ['editor', 'express', 'process', 'lambda'] as const;
type Host = (typeof HOSTS)[number];
const TITLES: Record<Host, string> = { editor: 'editor test run', express: 'exported Express app', process: 'exported server process', lambda: 'exported Lambda handler' };
const HTTP: Record<Host, boolean> = { editor: false, express: true, process: true, lambda: true };

let example: ExampleProject;
let postgres: TestPostgres;
let local: ExportedProject;
const projects: ExportedProject[] = [];
const clients = new Map<Host, BackendClient>();
const env = () => ({ DATABASE_URL: postgres.url, ADMIN_KEY });

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  postgres = await TestPostgres.start();
  for (const [name, value] of Object.entries(env())) vi.stubEnv(name, value);
  example = await loadExample('database-crud');
  let aws: ExportedProject;
  [local, aws] = await Promise.all([buildExample(example, 'local'), buildExample(example, 'aws')]);
  projects.push(local, aws);
  clients.set('editor', new EditorClient(workflowOf(example), await editorRegistry(), env()));
  clients.set('express', await ExpressClient.create(local));
  clients.set('process', await ServerProcessClient.start(local, env()));
  clients.set('lambda', await LambdaClient.create(aws));
}, 120_000);

afterAll(async () => {
  for (const client of clients.values()) await client.close();
  await Promise.all(projects.map((project) => project.dispose()));
  await postgres?.stop();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe.each(HOSTS.map((host) => [TITLES[host], host] as const))('PostgreSQL CRUD example through the %s', (_title, host) => {
  beforeAll(() => postgres.exec('DROP TABLE IF EXISTS products'));

  it.each(scenariosFor(HTTP[host], STORY))('%s', async (_name, scenario) => {
    await verify(clients.get(host)!, scenario);
  });

  it('left the database as the story describes', async () => {
    expect(await postgres.rows('SELECT id, sku, name FROM products ORDER BY id')).toEqual([{ id: 1, sku: 'NEW-1', name: 'Fresh' }]);
  });
});

describe('PostgreSQL CRUD example data', () => {
  beforeAll(async () => {
    await postgres.exec('DROP TABLE IF EXISTS products');
    await clients.get('express')!.send({ method: 'POST', path: '/setup', headers: ADMIN });
  });

  it('stores an injection attempt as plain text and keeps the table', async () => {
    await clients.get('express')!.send({ method: 'POST', path: '/products', body: { sku: 'SAFE', name: INJECTION, price: 2 } });
    expect(await postgres.rows('SELECT name FROM products WHERE sku = $1', ['SAFE'])).toEqual([{ name: INJECTION }]);
  });

  it('enforces the check constraint of the table, not only the workflow validation', async () => {
    await expect(postgres.rows("INSERT INTO products (sku, name, price) VALUES ('BAD', 'Bad', -1)")).rejects.toThrow(/products_price_check/);
  });
});

describe('PostgreSQL CRUD example hourly report', () => {
  beforeAll(async () => {
    await postgres.exec('TRUNCATE products RESTART IDENTITY');
    await postgres.exec("INSERT INTO products (sku, name, price, active) VALUES ('A', 'Active', 1, true), ('B', 'Inactive', 2, false), ('C', 'Active too', 3, true)");
  });

  it('counts the active products when the exported cron host fires the schedule', async () => {
    const express = clients.get('express') as ExpressClient;
    const { CronHost } = await local.runtime('cron');
    const fired: Array<() => Promise<void>> = [];
    await new CronHost(express.engine, { scheduler: { schedule: (_expression: string, _timezone: string, task: () => Promise<void>) => { fired.push(task); return { stop() {} }; } } }).start();
    expect(fired).toHaveLength(1);
    await fired[0]();
    expect(express.lastExecution!.toResponse()).toMatchObject({ success: true, result: { active: 2 }, nodeOutputs: { 'count-active': { active: 2 } } });
  });

  it('counts the active products when EventBridge invokes the Lambda handler', async () => {
    const response = await (clients.get('lambda') as LambdaClient).schedule('hourly-report');
    expect(response).toMatchObject({ status: 200, body: { success: true, result: { active: 2 } } });
  });

  it('runs the schedule in the exported cron worker until it is stopped', async () => {
    const { child } = await local.start('dist/run-cron.mjs', env(), /1 schedule\(s\) started/);
    const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    expect(await exited).toBe(0);
  });
});

describe('PostgreSQL CRUD example edge cases', () => {
  it('fails every query of a backend started without DATABASE_URL, naming the variable', async () => {
    // Empty, not omitted: the process would otherwise inherit the variable of this test run.
    const server = await ServerProcessClient.start(local, { ...env(), DATABASE_URL: '' });
    try {
      const response = await server.send({ method: 'GET', path: '/products' });
      expect(response).toMatchObject({ status: 500, body: { success: false, error: 'database-query: environment variable "DATABASE_URL" is required' } });
    } finally {
      await server.close();
    }
  });

  it('simulates the rows in a sandbox test run of the editor, touching no database', async () => {
    await postgres.exec('DROP TABLE IF EXISTS products');
    const hub = new WebhookTestHub(10_000);
    const running = runWorkflow(workflowOf(example), await editorRegistry(), { mode: 'sandbox', services: { triggerEvents: hub, logger: { info() {}, error() {} } } });
    await vi.waitFor(() => expect(hub.pending).toBe(nodeIds(example, 'trigger-webhook').length));
    hub.deliver('/products', { method: 'GET', query: { id: '5' } });
    const run = await running;
    expect(run.nodeResults.find((result) => result.nodeId === 'find-product')).toMatchObject({
      error: null,
      output: { id: 1, query_executed: 'SELECT * FROM products WHERE id = $1::int', success: true },
    });
    expect(await postgres.rows("SELECT to_regclass('products') AS table")).toEqual([{ table: null }]);
  });

  it('reached every node of the workflow in the exported backend', () => {
    const express = clients.get('express') as ExpressClient;
    expect(nodeIds(example).filter((id) => !express.executed.has(id))).toEqual([]);
  });
});
