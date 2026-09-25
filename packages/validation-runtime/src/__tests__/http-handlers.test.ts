import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebhookTestHub } from '@runflux/plugin-system/webhook-test-hub';
import { afterEach, describe, expect, it } from 'vitest';
import { createValidationHttpHandlers } from '../http-handlers.js';
import { behaviourPlugin, registryWith } from './support.js';

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

/** Mounts the handlers on a plain node:http server, as any host other than Vite would. */
async function serve() {
  const webhooks = new WebhookTestHub(5_000);
  const catalog = registryWith(behaviourPlugin({ id: 'echo', category: 'trigger' }, (_parameters, input) => input ?? { echoed: true }));
  const handlers = createValidationHttpHandlers({ catalog: async () => catalog, webhooks, environment: () => ({}) });
  const server = createServer((request, response) => {
    if (request.url === '/runflux-validate') return handlers.validate(request, response);
    if (request.url === '/runflux-webhook-cancel') return handlers.cancelWebhooks(request, response);
    if (!handlers.deliverWebhook(request, response)) response.writeHead(404).end();
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, webhooks };
}

describe('validation HTTP handlers without Vite', () => {
  it('runs a workflow posted to the validate endpoint', async () => {
    const { url } = await serve();
    const workflow = { id: 'w', name: 'W', nodes: [{ id: 'start', pluginId: 'echo' }], connections: [] };
    const response = await fetch(`${url}/runflux-validate`, { method: 'POST', body: JSON.stringify({ workflow, mode: 'sandbox' }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ workflowId: 'w', status: 'success', nodeResults: [{ nodeId: 'start', output: { echoed: true } }] });
  });

  it('answers 400 to a body that is not JSON and 405 to other methods', async () => {
    const { url } = await serve();
    expect((await fetch(`${url}/runflux-validate`, { method: 'POST', body: 'nope' })).status).toBe(400);
    expect((await fetch(`${url}/runflux-validate`)).status).toBe(405);
  });

  it('delivers webhook test requests by path and cancels every wait', async () => {
    const { url, webhooks } = await serve();
    const waiting = webhooks.waitFor('POST /orders', new AbortController().signal);
    const delivered = await fetch(`${url}/api/webhooks/test/orders?source=test`, { method: 'POST', body: '{"id":42}' });
    expect(await delivered.json()).toMatchObject({ success: true, captured: true, data: { id: 42 } });
    await expect(waiting).resolves.toMatchObject({ body: { id: 42 }, query: { source: 'test' } });
    const cancelled = expect(webhooks.waitFor('POST /orders', new AbortController().signal)).rejects.toThrow('Webhook listener cancelled');
    expect(await (await fetch(`${url}/runflux-webhook-cancel`, { method: 'POST' })).json()).toEqual({ success: true, message: 'Listening cancelled' });
    await cancelled;
    expect((await fetch(`${url}/elsewhere`)).status).toBe(404);
  });
});
