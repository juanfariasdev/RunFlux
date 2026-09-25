import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { createServer as createViteServer, type Plugin, type ViteDevServer } from 'vite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginRegistry } from '@runflux/plugin-system/node';
import { WebhookTestHub } from '@runflux/plugin-system/webhook-test-hub';
import { runfluxPluginCatalogPlugin } from '../../apps/workflow-editor/vite-plugin-plugin-catalog';
import { PluginRegistryCache } from '../../apps/workflow-editor/vite-plugin-registry';
import { runfluxValidationPlugin } from '../../apps/workflow-editor/vite-plugin-validation-runtime';

const webhooks = new WebhookTestHub();

let directory: string;

async function writePlugin(name: string): Promise<string> {
  const plugin = path.join(directory, 'greeter');
  await fs.mkdir(plugin, { recursive: true });
  await fs.writeFile(path.join(plugin, 'package.json'), '{ "type": "module" }');
  await fs.writeFile(path.join(plugin, 'index.ts'), `export const manifest = { id: 'greeter', name: ${JSON.stringify(name)}, category: 'action', version: '1.0.0', parameters: [], supportedPlatforms: ['local'] };
export const runtimeModule = new URL('./runtime.ts', import.meta.url);`);
  await fs.writeFile(path.join(plugin, 'runtime.ts'), `export default {
  parseParameters: () => ({}),
  createHandler: () => ({ execute: () => ({ value: 'hi', activeOutput: 'main' }) }),
};`);
  return path.join(plugin, 'index.ts');
}

async function devServer(...plugins: Plugin[]): Promise<ViteDevServer> {
  return createViteServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, watch: null }, plugins });
}

beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'runflux-editor-plugins-'));
});

afterEach(async () => {
  webhooks.cancelAll();
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('PluginRegistryCache', () => {
  it('discovers once, and again after a file inside a plugin directory changes', async () => {
    const entry = await writePlugin('Greeter');
    const cache = new PluginRegistryCache([directory]);
    const first = await cache.registry();
    expect(await cache.registry()).toBe(first);
    expect(first.getManifest('greeter')?.name).toBe('Greeter');

    const watcher = Object.assign(new EventEmitter(), { add: vi.fn() });
    cache.watch({ watcher } as unknown as ViteDevServer);
    expect(watcher.add).toHaveBeenCalledWith([path.resolve(directory)]);
    watcher.emit('all', 'change', path.join(os.tmpdir(), 'elsewhere.ts'));
    expect(await cache.registry()).toBe(first);

    await writePlugin('Greeter v2');
    watcher.emit('all', 'change', entry);
    const second = await cache.registry();
    expect(second).not.toBe(first);
    expect(second.getManifest('greeter')?.name).toBe('Greeter v2');
  });

  it('tells plugin files from others, also for directories given as relative paths', () => {
    const cache = new PluginRegistryCache([path.relative(process.cwd(), directory)]);
    expect(cache.contains(path.join(directory, 'greeter', 'runtime.ts'))).toBe(true);
    expect(cache.contains(directory)).toBe(true);
    expect(cache.contains(`${directory}-sibling/index.ts`)).toBe(false);
  });

  it('retries a discovery that failed instead of caching the failure', async () => {
    vi.spyOn(PluginRegistry.prototype, 'discover').mockRejectedValueOnce(new Error('disk unavailable'));
    const cache = new PluginRegistryCache([directory]);
    await expect(cache.registry()).rejects.toThrow('disk unavailable');
    await expect(cache.registry()).resolves.toBeInstanceOf(PluginRegistry);
  });
});

describe('editor dev server', () => {
  it('serves the catalog from the shared registry, refreshed when a plugin changes', async () => {
    const entry = await writePlugin('Greeter');
    const cache = new PluginRegistryCache([directory]);
    const discover = vi.spyOn(PluginRegistry.prototype, 'discover');
    const vite = await devServer(runfluxPluginCatalogPlugin(cache), runfluxValidationPlugin(cache, webhooks));
    try {
      const names = async () => (await request(vite.middlewares).get('/runflux-plugins.json')).body.action.map((plugin: { name: string }) => plugin.name);
      expect(await names()).toEqual(['Greeter']);
      expect(await names()).toEqual(['Greeter']);
      expect(discover).toHaveBeenCalledOnce();
      await writePlugin('Greeter v2');
      vite.watcher.emit('all', 'change', entry);
      expect(await names()).toEqual(['Greeter v2']);
    } finally {
      await vite.close();
    }
  });

  it('answers 400 for a validation request that is not JSON and 405 for other methods', async () => {
    const vite = await devServer(runfluxValidationPlugin(new PluginRegistryCache([]), webhooks));
    try {
      const malformed = await request(vite.middlewares).post('/runflux-validate').set('Content-Type', 'application/json').send('{broken');
      expect(malformed.status).toBe(400);
      expect(malformed.body).toEqual({ error: 'Request body must be JSON' });
      expect((await request(vite.middlewares).get('/runflux-validate')).status).toBe(405);
    } finally {
      await vite.close();
    }
  });

  it('runs with the project variables the editor sends as $env, before its own environment', async () => {
    vi.stubEnv('RUNFLUX_SHARED', 'from the dev server');
    vi.stubEnv('RUNFLUX_SERVER_ONLY', 'server');
    const vite = await devServer(runfluxValidationPlugin(new PluginRegistryCache([path.resolve('plugins')]), webhooks));
    const workflow = {
      id: 'wf', name: 'Variables', connections: [{ sourceNodeId: 'start', sourceOutput: 'main', targetNodeId: 'read', targetInput: 'main' }],
      nodes: [
        { id: 'start', pluginId: 'trigger-manual-example', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
        { id: 'read', pluginId: 'code-javascript', pluginVersion: '1.0.0', parameters: { code: 'return { shared: $env.RUNFLUX_SHARED, project: $env.RUNFLUX_PROJECT, server: $env.RUNFLUX_SERVER_ONLY };' }, position: { x: 0, y: 0 } },
      ],
    };
    try {
      const response = await request(vite.middlewares).post('/runflux-validate').send({
        workflow, mode: 'sandbox', environment: { RUNFLUX_SHARED: 'from the project', RUNFLUX_PROJECT: 'project', IGNORED: 42 },
      });
      expect(response.body.nodeResults.find((result: { nodeId: string }) => result.nodeId === 'read').output)
        .toEqual({ shared: 'from the project', project: 'project', server: 'server' });
    } finally {
      await vite.close();
      vi.unstubAllEnvs();
    }
  });

  it('cancels the test run of a client that disconnects', async () => {
    const vite = await devServer(runfluxValidationPlugin(new PluginRegistryCache([path.resolve('plugins')]), webhooks));
    const server = http.createServer(vite.middlewares);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const workflow = {
      id: 'wf', name: 'Waiting webhook', connections: [],
      nodes: [{ id: 'hook', pluginId: 'trigger-webhook', pluginVersion: '1.0.0', parameters: { path: '/never' }, position: { x: 0, y: 0 } }],
    };
    try {
      const client = new AbortController();
      const run = fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/runflux-validate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workflow, mode: 'sandbox' }), signal: client.signal,
      }).catch((error: Error) => error.name);
      await vi.waitFor(() => expect(webhooks.pending).toBe(1), { timeout: 5000 });
      client.abort();
      expect(await run).toBe('AbortError');
      await vi.waitFor(() => expect(webhooks.pending).toBe(0), { timeout: 5000 });
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await vite.close();
    }
  });
});
