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

/** Values, access and body size of the test endpoints (feature 015, RN-04, RN-12, RN-14, RF-13, RF-16, RF-17). */
describe('validation HTTP handlers of the platform', () => {
  const reader = behaviourPlugin({ id: 'env-reader', category: 'trigger' }, (parameters, _input, context) =>
    Object.fromEntries((parameters.names as string[]).map((name) => [name, context.env[name] ?? null])));

  async function serveWith(options: Partial<Parameters<typeof createValidationHttpHandlers>[0]>) {
    const webhooks = new WebhookTestHub(5_000);
    const handlers = createValidationHttpHandlers({ catalog: async () => registryWith(reader), webhooks, ...options });
    const server = createServer((request, response) => {
      if (request.url === '/runflux-validate') return handlers.validate(request, response);
      if (request.url === '/runflux-webhook-cancel') return handlers.cancelWebhooks(request, response);
      if (!handlers.deliverWebhook(request, response)) response.writeHead(404).end();
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, webhooks };
  }

  const reading = (...names: string[]) => ({ id: 'w', name: 'W', nodes: [{ id: 'read', pluginId: 'env-reader', parameters: { names } }], connections: [] });
  const validate = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${url}/runflux-validate`, { method: 'POST', headers, body: JSON.stringify(body) });
  const outputOf = async (response: Response) => ((await response.json()) as { nodeResults: Array<{ output: unknown; error: string | null }> }).nodeResults[0];

  it('layers the process environment, the project values and the request environment, in that order', async () => {
    const calls: Array<[string, AbortSignal]> = [];
    const { url } = await serveWith({
      environment: () => ({ DB_URL: 'process', SHARED: 'process', ONLY_PROCESS: 'p' }),
      projectEnvironment: async (projectId, signal) => {
        calls.push([projectId, signal]);
        return { values: { DB_URL: 'project', SHARED: 'project' }, unreadable: [] };
      },
    });
    const response = await validate(url, { workflow: reading('DB_URL', 'SHARED', 'ONLY_PROCESS'), mode: 'sandbox', projectId: 'p1', environment: { SHARED: 'body' } });
    expect((await outputOf(response)).output).toEqual({ DB_URL: 'project', SHARED: 'body', ONLY_PROCESS: 'p' });
    expect(calls.map(([id, signal]) => [id, signal instanceof AbortSignal])).toEqual([['p1', true]]);
  });

  it('asks for no project values without a project id', async () => {
    let asked = false;
    const { url } = await serveWith({ environment: () => ({}), projectEnvironment: async () => { asked = true; return { values: {} }; } });
    await validate(url, { workflow: reading('X'), mode: 'sandbox' });
    expect(asked).toBe(false);
  });

  it('keeps the platform secrets out of the default environment', async () => {
    process.env.RUNFLUX_API_TOKEN = 'platform-token';
    process.env.RUNFLUX_SECRET_KEY = 'platform-key';
    process.env.RUNFLUX_TEST_VISIBLE = 'visible';
    try {
      const { url } = await serveWith({});
      const response = await validate(url, { workflow: reading('RUNFLUX_API_TOKEN', 'RUNFLUX_SECRET_KEY', 'RUNFLUX_TEST_VISIBLE'), mode: 'sandbox' });
      expect((await outputOf(response)).output).toEqual({ RUNFLUX_API_TOKEN: null, RUNFLUX_SECRET_KEY: null, RUNFLUX_TEST_VISIBLE: 'visible' });
    } finally {
      delete process.env.RUNFLUX_API_TOKEN;
      delete process.env.RUNFLUX_SECRET_KEY;
      delete process.env.RUNFLUX_TEST_VISIBLE;
    }
  });

  it('fails only a node that reads an unreadable value, naming the variable', async () => {
    const { url } = await serveWith({ environment: () => ({}), projectEnvironment: async () => ({ values: { DB_URL: 'ok' }, unreadable: ['OLD_SECRET'] }) });
    const fine = await outputOf(await validate(url, { workflow: reading('DB_URL'), mode: 'sandbox', projectId: 'p1' }));
    expect(fine).toMatchObject({ output: { DB_URL: 'ok' }, error: null });
    const failed = await outputOf(await validate(url, { workflow: reading('OLD_SECRET'), mode: 'sandbox', projectId: 'p1' }));
    expect(failed.error).toContain('Variable "OLD_SECRET" cannot be decrypted; set its value again');
  });

  it('never falls back to the process variable of an unreadable name', async () => {
    const { url } = await serveWith({ environment: () => ({ OLD_SECRET: 'from-the-process' }), projectEnvironment: async () => ({ values: {}, unreadable: ['OLD_SECRET'] }) });
    const failed = await outputOf(await validate(url, { workflow: reading('OLD_SECRET'), mode: 'sandbox', projectId: 'p1' }));
    expect(failed.error).toContain('Variable "OLD_SECRET" cannot be decrypted');
    const given = await outputOf(await validate(url, { workflow: reading('OLD_SECRET'), mode: 'sandbox', projectId: 'p1', environment: { OLD_SECRET: 'from-the-request' } }));
    expect(given.output).toEqual({ OLD_SECRET: 'from-the-request' });
  });

  it('answers 500 with the reason when the project values cannot be fetched', async () => {
    const { url } = await serveWith({ projectEnvironment: async () => { throw new Error('Project server is not running on http://127.0.0.1:3001'); } });
    const response = await validate(url, { workflow: reading('X'), mode: 'sandbox', projectId: 'p1' });
    expect([response.status, await response.json()]).toEqual([500, { error: 'Project server is not running on http://127.0.0.1:3001' }]);
  });

  it('asks validate and cancel for authorization, but not webhook deliveries, and hides the platform credential from triggers', async () => {
    const { url, webhooks } = await serveWith({ environment: () => ({}), authorize: (request) => request.headers.authorization === 'Bearer good' });
    for (const response of [await validate(url, { workflow: reading('X'), mode: 'sandbox' }), await fetch(`${url}/runflux-webhook-cancel`, { method: 'POST' })]) {
      expect([response.status, await response.json()]).toEqual([401, { error: 'Authentication required' }]);
    }
    expect((await validate(url, { workflow: reading('X'), mode: 'sandbox' }, { Authorization: 'Bearer good' })).status).toBe(200);

    const open = webhooks.waitFor('POST /orders', new AbortController().signal);
    expect(await (await fetch(`${url}/runflux-webhook-test/orders`, { method: 'POST', body: '{}' })).json()).toMatchObject({ captured: true });
    await open;
    const withCredential = webhooks.waitFor('POST /orders', new AbortController().signal);
    await fetch(`${url}/runflux-webhook-test/orders`, { method: 'POST', headers: { Authorization: 'Bearer good', 'X-Custom': 'kept' }, body: '{}' });
    const captured = (await withCredential) as { headers: Record<string, string> };
    expect(captured.headers.authorization).toBeUndefined();
    expect(captured.headers['x-custom']).toBe('kept');
    const foreign = webhooks.waitFor('POST /orders', new AbortController().signal);
    await fetch(`${url}/runflux-webhook-test/orders`, { method: 'POST', headers: { Authorization: 'Bearer third-party' }, body: '{}' });
    expect(((await foreign) as { headers: Record<string, string> }).headers.authorization).toBe('Bearer third-party');
  });

  it('answers 413 to a body over the limit', async () => {
    const { url } = await serveWith({ environment: () => ({}), maxBodyBytes: 1_000 });
    const response = await fetch(`${url}/runflux-validate`, { method: 'POST', body: 'x'.repeat(2_000) });
    expect([response.status, await response.json()]).toEqual([413, { error: 'Request body exceeds 1000 bytes' }]);
  });

  it('limits bodies to 5 MB by default', async () => {
    const { url } = await serveWith({ environment: () => ({}) });
    const response = await fetch(`${url}/runflux-validate`, { method: 'POST', body: 'x'.repeat(6 * 1024 * 1024) });
    expect([response.status, await response.json()]).toEqual([413, { error: 'Request body exceeds 5 MB' }]);
  });
});
