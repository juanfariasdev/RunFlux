import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpressHost } from '../express/express-host.js';
import { HttpTriggerAuthenticator } from '../http/http-trigger-authenticator.js';
import { defineNode, NodeOutput } from '../../contracts/node.js';
import { StaticNodeCatalog } from '../../engine/node-catalog.js';
import { WorkflowEngine } from '../../engine/workflow-engine.js';
import { ExecutableWorkflowBuilder } from '../../workflow/workflow-builder.js';
import { hostEngine, httpTrigger } from './fixtures.js';

afterEach(() => vi.unstubAllEnvs());

describe('ExpressHost', () => {
  const secured = httpTrigger('orders', { authentication: { type: 'header', headerName: 'X-Orders-Key', secretEnvVar: 'ORDERS_KEY' } });

  it('reports its health', async () => {
    const response = await request(new ExpressHost(hostEngine(), { projectName: 'Backend' }).app).get('/health');
    expect(response.body).toEqual({ status: 'ok', project: 'Backend', workflowId: 'hosted', nodeCount: 1 });
  });

  it('starts only the addressed trigger with the request body, headers and query', async () => {
    const app = new ExpressHost(hostEngine({ http: [httpTrigger('orders'), httpTrigger('events')] })).app;
    const response = await request(app).post('/orders?page=2').set('X-Custom', 'yes').send({ id: 42 });
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(Object.keys(response.body.nodeOutputs)).toEqual(['orders']);
    expect(response.body.result).toMatchObject({ body: { id: 42 }, query: { page: '2' }, headers: { 'x-custom': 'yes' } });
  });

  it('requires the configured secret, rejecting every request when it is not configured', async () => {
    const app = new ExpressHost(hostEngine({ http: [secured] })).app;
    expect((await request(app).post('/orders').send({})).status).toBe(401);
    expect((await request(app).post('/orders').set('X-Orders-Key', 'anything').send({})).status).toBe(401);
    vi.stubEnv('ORDERS_KEY', 'correct');
    expect((await request(app).post('/orders').set('X-Orders-Key', 'wrong').send({})).status).toBe(401);
    expect((await request(app).post('/orders').set('X-Orders-Key', 'correct').send({})).status).toBe(200);
  });

  it('accepts an injected authenticator', async () => {
    const app = new ExpressHost(hostEngine({ http: [secured] }), { authenticator: new HttpTriggerAuthenticator(() => ({ ORDERS_KEY: 'injected' })) }).app;
    expect((await request(app).post('/orders').set('X-Orders-Key', 'injected').send({})).status).toBe(200);
  });

  it('passes raw bodies as text', async () => {
    const app = new ExpressHost(hostEngine({ http: [httpTrigger('events', { rawBody: true })] })).app;
    const response = await request(app).post('/events').set('Content-Type', 'text/plain').send('plain text');
    expect(response.body.result.body).toBe('plain text');
  });

  it('answers 404 for unknown paths, 405 for other methods and 400 for invalid JSON', async () => {
    const app = new ExpressHost(hostEngine({ http: [httpTrigger('orders')] })).app;
    expect((await request(app).post('/missing').send({})).status).toBe(404);
    expect((await request(app).get('/orders')).status).toBe(405);
    const invalid = await request(app).post('/orders').set('Content-Type', 'application/json').send('{broken');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBeTypeOf('string');
  });

  it('offers /api/execute only when the workflow has no HTTP triggers', async () => {
    const withoutTriggers = new ExpressHost(hostEngine()).app;
    const response = await request(withoutTriggers).post('/api/execute').send({ id: 1 });
    expect(response.body).toEqual({ success: true, result: { id: 1 }, nodeOutputs: { manual: { id: 1 } } });
    expect((await request(new ExpressHost(hostEngine({ http: [httpTrigger('orders')] })).app).post('/api/execute').send({})).status).toBe(404);
  });

  it('answers 500 with the execution when a node fails', async () => {
    const response = await request(new ExpressHost(hostEngine({ http: [httpTrigger('orders')], failing: ['orders'] })).app).post('/orders').send({});
    expect(response.status).toBe(500);
    expect(response.body).toMatchObject({ success: false, error: 'node failed' });
  });

  it('listens on a port and closes without disposing the engine it does not own', async () => {
    const engine = hostEngine();
    const dispose = vi.spyOn(engine, 'dispose');
    const host = new ExpressHost(engine);
    const server = await host.listen(0);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    await host.close();
    expect(server.listening).toBe(false);
    expect(dispose).not.toHaveBeenCalled();
  });

  it('never passes the secret header to the workflow', async () => {
    vi.stubEnv('ORDERS_KEY', 'correct');
    const response = await request(new ExpressHost(hostEngine({ http: [secured] })).app).post('/orders').set('X-Orders-Key', 'correct').set('X-Other', 'kept').send({});
    expect(response.body.result.headers).toMatchObject({ 'x-other': 'kept' });
    expect(response.body.result.headers['x-orders-key']).toBeUndefined();
  });

  it('parses any body as JSON like the Lambda host, answers 404 as JSON and HEAD like GET', async () => {
    const app = new ExpressHost(hostEngine({ http: [httpTrigger('orders'), httpTrigger('status', { method: 'GET' })] })).app;
    expect((await request(app).post('/orders').set('Content-Type', 'text/plain').send('{"id":1}')).body.result.body).toEqual({ id: 1 });
    expect((await request(app).post('/orders').set('Content-Type', 'text/plain').send('not json')).status).toBe(400);
    const missing = await request(app).get('/missing');
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Not found' });
    expect((await request(app).head('/status')).status).toBe(200);
    expect((await request(app).post('//orders/').send({})).status).toBe(200);
  });

  it('cancels the run of a client that disconnects', async () => {
    let aborted!: () => void;
    const sawAbort = new Promise<void>((resolve) => { aborted = resolve; });
    const engine = new WorkflowEngine(new ExecutableWorkflowBuilder(() => ({ category: 'trigger', parameters: [] })).build(
      { id: 'w', name: 'W', nodes: [{ id: 'hook', pluginId: 'waiting' }], connections: [] },
      { http: [httpTrigger('hook')], schedules: [] },
    ), new StaticNodeCatalog({ waiting: defineNode({ parseParameters: () => ({}), createHandler: () => ({
      execute: ({ context }) => new Promise<NodeOutput>((resolve) => context.signal.addEventListener('abort', () => { aborted(); resolve(NodeOutput.main('aborted')); })),
    }) }) }));
    const host = new ExpressHost(engine);
    const server = await host.listen(0);
    const { port } = server.address() as { port: number };
    const client = new AbortController();
    const call = fetch(`http://127.0.0.1:${port}/hook`, { method: 'POST', body: '{}', signal: client.signal }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 50));
    client.abort();
    await call;
    await sawAbort;
    await host.close();
  });
});
