import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportedProject } from '../support/exported-project';
import { compile, edge, node, workflow } from '../support/workflows';

const run = promisify(execFile);
const projects: ExportedProject[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(projects.splice(0).map((project) => project.dispose()));
});

async function exported(...args: Parameters<typeof compile>): Promise<ExportedProject> {
  const project = await ExportedProject.write(await compile(...args));
  projects.push(project);
  return project;
}

/** The Express app of the backend, composed from its vendored runtime like src/server.ts does. */
async function app(project: ExportedProject) {
  const { ExpressHost } = await project.runtime('express');
  return new ExpressHost(await project.engine()).app;
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer().listen(0, () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

describe('exported local backend over HTTP', () => {
  const webhooks = () => workflow(['orders', 'events'].map((id) => node(id, 'trigger-webhook', {
    path: `/${id}`, authentication: 'headerAuth', headerName: 'X-Orders-Key', secretEnvVar: 'ORDERS_KEY',
  })));

  it('requires each webhook secret and starts only the addressed trigger', async () => {
    const backend = await app(await exported(webhooks()));
    expect((await request(backend).post('/orders').send({ id: 42 })).status).toBe(401);
    vi.stubEnv('ORDERS_KEY', 'correct');
    expect((await request(backend).post('/orders').set('X-Orders-Key', 'wrong').send({ id: 42 })).status).toBe(401);
    const response = await request(backend).post('/orders?page=2').set('X-Orders-Key', 'correct').send({ id: 42 });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ success: true, result: { id: 42, _query: { page: '2' } } });
    expect(Object.keys(response.body.nodeOutputs)).toEqual(['orders']);
  });

  it('answers 404, 405 and 400, and offers no bypass endpoint when webhooks exist', async () => {
    vi.stubEnv('ORDERS_KEY', 'correct');
    const backend = await app(await exported(webhooks()));
    expect((await request(backend).post('/missing').send({})).status).toBe(404);
    expect((await request(backend).get('/orders')).status).toBe(405);
    expect((await request(backend).post('/orders').set('X-Orders-Key', 'correct').set('Content-Type', 'application/json').send('{broken')).status).toBe(400);
    expect((await request(backend).post('/api/execute').send({})).status).toBe(404);
  });

  it('passes raw bodies as text', async () => {
    const backend = await app(await exported(workflow([node('events', 'trigger-webhook', { path: '/events', rawBody: true })])));
    const response = await request(backend).post('/events').set('Content-Type', 'text/plain').send('plain text');
    expect(response.body.result).toMatchObject({ data: 'plain text' });
  });

  it('runs workflows without webhooks through /api/execute', async () => {
    const backend = await app(await exported(workflow(
      [node('start', 'trigger-manual-example', { label: 'API' }), node('pick', 'set', { fields: [{ name: 'label', value: '{{ $json.label }}' }] })],
      [edge('start', 'pick')],
    )));
    expect((await request(backend).post('/api/execute').send({ id: 1 })).body).toMatchObject({ success: true, result: { label: 'API' } });
    expect((await request(backend).get('/health')).body).toEqual({ status: 'ok', project: 'Test workflow', workflowId: 'test-workflow', nodeCount: 2 });
  });

  it('answers 500 with the failing node error', async () => {
    const backend = await app(await exported(workflow(
      [node('hook', 'trigger-webhook'), node('code', 'code-javascript', { code: 'throw new Error("rejected order");' })],
      [edge('hook', 'code')],
    )));
    const response = await request(backend).post('/webhook').send({});
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, error: '[code-javascript]: Execution error: rejected order' });
  });
});

describe('exported local backend execution semantics', () => {
  it('waits for every active parent of a merge and keeps connection order', async () => {
    const engine = await (await exported(workflow(
      [node('start', 'trigger-webhook'), node('slow', 'code-javascript', { code: 'await new Promise((resolve) => setTimeout(resolve, 15)); return "slow";' }),
        node('fast', 'code-javascript', { code: 'return "fast";' }), node('merge', 'code-javascript', { code: 'return $json;' })],
      [edge('start', 'slow'), edge('start', 'fast'), edge('slow', 'merge'), edge('fast', 'merge')],
    ))).engine();
    expect((await engine.run({ payload: { body: {} } })).toResponse()).toMatchObject({ success: true, result: ['slow', 'fast'] });
  });

  it('binds each repeated plugin to its own configuration regardless of canvas order', async () => {
    const engine = await (await exported(workflow(
      [node('last', 'set', { fields: [{ name: 'result', value: '{{ $json.count + 1 }}', type: 'number' }] }),
        node('start', 'trigger-webhook'),
        node('first', 'set', { fields: [{ name: 'count', value: '{{ $json.count * 2 }}', type: 'number' }] })],
      [edge('start', 'first'), edge('first', 'last')],
    ))).engine();
    expect((await engine.run({ payload: { body: { count: 3 } } })).toResponse()).toMatchObject({ success: true, result: { result: 7 } });
  });

  it('routes through if, switch and filter outputs and reads earlier nodes by label', async () => {
    const engine = await (await exported(workflow([
      node('hook', 'trigger-webhook', {}, 'Order'),
      node('big', 'condition-if', { conditions: [{ leftValue: '{{ $json.amount }}', operator: 'greaterThan', rightValue: 100 }] }),
      node('tier', 'condition-switch', { rules: [{ conditions: [{ leftValue: '{{ $json.amount }}', operator: 'greaterThan', rightValue: 1000 }] }], fallbackEnabled: true }),
      node('vip', 'set', { fields: [{ name: 'tier', value: 'vip' }, { name: 'order', value: '{{ $node.Order.json.id }}' }] }),
      node('premium', 'set', { fields: [{ name: 'tier', value: 'premium' }] }),
      node('small', 'filter', { conditions: [{ leftValue: '{{ $json.amount }}', operator: 'lessThan', rightValue: 0 }] }),
      node('refund', 'set', { fields: [{ name: 'tier', value: 'refund' }] }),
    ], [edge('hook', 'big'), edge('big', 'tier', 'true'), edge('big', 'small', 'false'), edge('tier', 'vip', 'output1'), edge('tier', 'premium', 'fallback'), edge('small', 'refund')]))).engine();
    const tierOf = async (amount: number, id = 1) => (await engine.run({ payload: { body: { amount, id } } })).result();
    expect(await tierOf(5000, 9)).toEqual({ tier: 'vip', order: 9 });
    expect(await tierOf(500)).toEqual({ tier: 'premium' });
    expect(await tierOf(-5)).toEqual({ tier: 'refund' });
    expect(await tierOf(50)).toMatchObject({ amount: 50 });
  });
});

describe('exported local backend processes', () => {
  it('serves HTTP with node dist/server.mjs and stops on SIGTERM', async () => {
    const project = await (await exported(workflow([node('hook', 'trigger-webhook', { path: '/orders' })]))).build();
    const port = await freePort();
    const server = await project.start('dist/server.mjs', { PORT: String(port) }, /Listening on port/);
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(await health.json()).toMatchObject({ status: 'ok', workflowId: 'test-workflow' });
    const order = await fetch(`http://127.0.0.1:${port}/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"id":5}' });
    expect(await order.json()).toMatchObject({ success: true, result: { id: 5 } });
    const exited = new Promise<number | null>((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    expect(await exited).toBe(0);
  });

  it('runs once from the command line with a JSON payload, exiting 1 when the workflow fails', async () => {
    const ok = await (await exported(workflow([node('start', 'trigger-manual-example'), node('code', 'code-javascript', { code: 'return { doubled: $json.n * 2 };' })], [edge('start', 'code')]))).build();
    const { stdout } = await run(process.execPath, ['dist/run.mjs', '{"n":21}'], { cwd: ok.directory });
    expect(JSON.parse(stdout.slice(stdout.indexOf('{\n')))).toMatchObject({ success: true, result: { doubled: 42 } });

    const failing = await (await exported(workflow([node('start', 'trigger-manual-example'), node('code', 'code-javascript', { code: 'throw new Error("nope");' })], [edge('start', 'code')]))).build();
    await expect(run(process.execPath, ['dist/run.mjs'], { cwd: failing.directory })).rejects.toMatchObject({ code: 1 });
  });

  it('starts each cron schedule through its own trigger', async () => {
    const project = await exported(workflow(['first', 'second'].map((id, index) => node(id, 'trigger-cron', {
      expression: index ? '0 9 * * 1-5' : '*/15 * * * *', timezone: 'America/Sao_Paulo',
    }))));
    expect(project.paths()).toContain('src/run-cron.ts');
    const { CronHost } = await project.runtime('cron');
    const tasks: Array<{ expression: string; timezone: string; fire: () => Promise<void> }> = [];
    const engine = await project.engine();
    const runSpy = vi.spyOn(engine, 'run');
    await new CronHost(engine, { scheduler: { schedule: (expression: string, timezone: string, fire: () => Promise<void>) => { tasks.push({ expression, timezone, fire }); return { stop() {} }; } } }).start();
    expect(tasks.map(({ expression, timezone }) => [expression, timezone])).toEqual([['*/15 * * * *', 'America/Sao_Paulo'], ['0 9 * * 1-5', 'America/Sao_Paulo']]);
    for (const task of tasks) await task.fire();
    expect(runSpy.mock.calls.map(([runRequest]) => (runRequest as { triggerId?: string }).triggerId)).toEqual(['first', 'second']);
  });
});
