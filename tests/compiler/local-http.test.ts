import request from 'supertest';
import { afterEach, expect, it, vi } from 'vitest';
import { compileWorkflow } from '../../packages/compiler/src/compiler';
import { loadPlugin, loadProject } from '../plugins/helpers';

afterEach(() => vi.unstubAllEnvs());

it('serves authenticated local webhook requests without running other triggers or bypass endpoints', async () => {
  vi.stubEnv('ORDERS_KEY', 'correct');
  const plugin = await loadPlugin('trigger-webhook');
  const result = await compileWorkflow({ targetPlatform: 'local', projectName: "Customer's backend", workflow: {
    id: 'webhooks', name: 'Webhooks', nodes: ['orders', 'events'].map((id) => ({
      id, pluginId: 'trigger-webhook', pluginVersion: '1.0.0', position: { x: 0, y: 0 },
      parameters: { path: `/${id}`, authentication: 'headerAuth', headerName: 'X-Orders-Key', secretEnvVar: 'ORDERS_KEY' },
    })), connections: [],
  } }, () => plugin);
  if (result.status !== 'success') throw new Error('Compilation failed');
  const { app } = loadProject(result.files, 'src/app.ts');
  expect((await request(app).post('/orders').send({ id: 42 })).status).toBe(401);
  const response = await request(app).post('/orders').set('X-Orders-Key', 'correct').send({ id: 42 });
  expect(response.status).toBe(200);
  expect(response.body.result.id).toBe(42);
  expect(Object.keys(response.body.nodeOutputs)).toEqual(['orders']);
  expect((await request(app).post('/api/execute').send({ id: 42 })).status).toBe(404);
});
