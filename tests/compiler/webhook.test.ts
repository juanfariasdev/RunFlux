import { afterEach, expect, it, vi } from 'vitest';
import { compileWorkflow } from '../../packages/compiler/src/compiler';
import { loadPlugin, loadProject } from '../plugins/helpers';

afterEach(() => vi.unstubAllEnvs());

async function handler() {
  const plugin = await loadPlugin('trigger-webhook');
  const result = await compileWorkflow({ projectName: 'Webhooks', targetPlatform: 'aws', workflow: {
    id: 'webhooks', name: 'Webhooks', nodes: [
      { id: 'orders', pluginId: 'trigger-webhook', pluginVersion: '1.0.0', position: { x: 0, y: 0 }, parameters: {
        path: '/orders', authentication: 'headerAuth', headerName: 'X-Orders-Key', secretEnvVar: 'ORDERS_KEY',
      } },
      { id: 'events', pluginId: 'trigger-webhook', pluginVersion: '1.0.0', position: { x: 0, y: 0 }, parameters: { path: '/events', rawBody: true } },
    ], connections: [],
  } }, () => plugin);
  if (result.status !== 'success') throw new Error('Compilation failed');
  return loadProject(result.files, 'src/handler.ts').handler;
}

it('requires the configured secret even when its environment variable is absent', async () => {
  vi.stubEnv('ORDERS_KEY', '');
  const run = await handler();
  const response = await run({ rawPath: '/orders', requestContext: { http: { method: 'POST' } }, headers: {}, body: '{}' });
  expect(response.statusCode).toBe(401);
});

it('matches the endpoint, respects custom authentication headers and only executes that trigger', async () => {
  vi.stubEnv('ORDERS_KEY', 'correct');
  const run = await handler();
  const response = await run({ rawPath: '/orders', requestContext: { http: { method: 'POST' } }, headers: { 'x-orders-key': 'correct' }, queryStringParameters: { page: '2' }, body: '{"id":42}' });
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body)).toMatchObject({ success: true, nodeOutputs: { orders: { id: 42, _query: { page: '2' } } } });
  expect(Object.keys(JSON.parse(response.body).nodeOutputs)).toEqual(['orders']);
});

it('handles raw base64 bodies and rejects unknown paths and methods', async () => {
  const run = await handler();
  const event = { rawPath: '/events', requestContext: { http: { method: 'POST' } }, body: Buffer.from('plain text').toString('base64'), isBase64Encoded: true };
  const response = await run(event);
  expect(response.statusCode).toBe(200);
  expect(JSON.parse(response.body).result.data).toBe('plain text');
  expect((await run({ ...event, rawPath: '/missing' })).statusCode).toBe(404);
  expect((await run({ ...event, requestContext: { http: { method: 'GET' } } })).statusCode).toBe(405);
});
