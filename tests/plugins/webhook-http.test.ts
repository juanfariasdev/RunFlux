import { createServer as createViteServer } from 'vite';
import request from 'supertest';
import { resolve } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { WebhookTestHub } from '@runflux/plugin-system/webhook-test-hub';
import { PluginRegistryCache } from '../../apps/workflow-editor/vite-plugin-registry';
import { runfluxValidationPlugin } from '../../apps/workflow-editor/vite-plugin-validation-runtime';
import { loadConfig } from '../../apps/project-server/src/config';
import { createContainer } from '../../apps/project-server/src/container';
import { createServer } from '../../apps/project-server/src/server';

afterEach(() => {
  WebhookTestHub.shared().cancelAll();
  vi.restoreAllMocks();
});

it.each(['editor', 'server'])('%s delivers test webhooks only to the trigger waiting on that path', async (target) => {
  const vite = target === 'editor' ? await createViteServer({ configFile: false, server: { middlewareMode: true }, plugins: [runfluxValidationPlugin(new PluginRegistryCache([]))] }) : undefined;
  const app = vite?.middlewares ?? createServer(createContainer(loadConfig()));
  if (target === 'server') vi.spyOn(process, 'cwd').mockReturnValue(resolve('apps/project-server'));
  const waiting = WebhookTestHub.shared().waitFor('/orders', new AbortController().signal);
  try {
    const unrelated = await request(app).post('/api/webhooks/test/unrelated').send({ wrong: true });
    expect(unrelated.body).toMatchObject({ success: true, captured: false });
    const matching = await request(app).post('/api/webhooks/test/orders?source=test').send({ id: 42 });
    expect(matching.body).toMatchObject({ success: true, captured: true });
    await expect(waiting).resolves.toMatchObject({ body: { id: 42 }, query: { source: 'test' } });
  } finally {
    await vite?.close();
  }
});

it('lets the editor cancel every waiting test webhook', async () => {
  const vite = await createViteServer({ configFile: false, server: { middlewareMode: true }, plugins: [runfluxValidationPlugin(new PluginRegistryCache([]))] });
  const waiting = WebhookTestHub.shared().waitFor('/orders', new AbortController().signal);
  const observed = waiting.catch((error: Error) => error.message);
  try {
    expect((await request(vite.middlewares).post('/runflux-webhook-cancel')).body).toEqual({ success: true, message: 'Listening cancelled' });
    expect(await observed).toBe('Webhook listener cancelled');
  } finally {
    await vite.close();
  }
});

it('runs a whole workflow whose webhook waits for the test request (editor)', async () => {
  const vite = await createViteServer({ configFile: false, server: { middlewareMode: true }, plugins: [runfluxValidationPlugin(new PluginRegistryCache([resolve('plugins')]))] });
  const definition = {
    id: 'wf', name: 'Waiting webhook', connections: [{ sourceNodeId: 'hook', sourceOutput: 'main', targetNodeId: 'total', targetInput: 'main' }],
    nodes: [
      { id: 'hook', pluginId: 'trigger-webhook', pluginVersion: '1.0.0', parameters: { path: '/checkout' }, position: { x: 0, y: 0 } },
      { id: 'total', pluginId: 'set', pluginVersion: '1.0.0', parameters: { fields: [{ name: 'total', value: '{{ $json.amount * 2 }}', type: 'number' }] }, position: { x: 0, y: 0 } },
    ],
  };
  try {
    const run = request(vite.middlewares).post('/runflux-validate').send({ workflow: definition, mode: 'sandbox' }).then((response) => response.body);
    await vi.waitFor(() => expect(WebhookTestHub.shared().pending).toBe(1), { timeout: 5000 });
    await request(vite.middlewares).post('/runflux-webhook-test/checkout').send({ amount: 21 });
    const result = await run;
    expect(result.status).toBe('success');
    expect(result.nodeResults.find((node: { nodeId: string }) => node.nodeId === 'total')).toMatchObject({ output: { total: 42 } });
  } finally {
    await vite.close();
  }
});
