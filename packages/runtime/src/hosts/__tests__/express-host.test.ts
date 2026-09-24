import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpressHost } from '../express/express-host.js';
import { HttpTriggerAuthenticator } from '../http/http-trigger-authenticator.js';
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

  it('listens on a port and closes, releasing the engine', async () => {
    const engine = hostEngine();
    const dispose = vi.spyOn(engine, 'dispose');
    const host = new ExpressHost(engine);
    const server = await host.listen(0);
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    expect((await fetch(`http://127.0.0.1:${port}/health`)).status).toBe(200);
    await host.close();
    expect(server.listening).toBe(false);
    expect(dispose).toHaveBeenCalledOnce();
  });
});
