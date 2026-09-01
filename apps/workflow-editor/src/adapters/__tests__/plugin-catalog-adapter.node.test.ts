import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NodePluginCatalogAdapter } from '../plugin-catalog-adapter.node';
import { PluginRegistry } from '@runflux/plugin-system';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Reuse the real trigger-manual-example plugin package (001-plugin-system) as fixture.
const pluginsDir = path.join(__dirname, '..', '..', '..', '..', '..', 'plugins');

describe('NodePluginCatalogAdapter (Node-only — used by vite-plugin-plugin-catalog.ts, never bundled for the browser)', () => {
  it('discovers plugins on first call and caches the result for subsequent calls', async () => {
    const registry = new PluginRegistry();
    const adapter = new NodePluginCatalogAdapter(registry, [pluginsDir]);

    const first = await adapter.listPlugins();
    expect(first.trigger?.map((m) => m.id)).toContain('trigger-manual-example');

    // second call must not re-run discovery (no duplicate-id error thrown)
    const second = await adapter.listPlugins();
    expect(second).toEqual(first);
  });

  it('reports "ok" for a plugin referenced at its currently installed version', async () => {
    const registry = new PluginRegistry();
    const adapter = new NodePluginCatalogAdapter(registry, [pluginsDir]);
    await adapter.listPlugins();

    expect(await adapter.checkReference('trigger-manual-example', '1.0.0')).toEqual({
      status: 'ok',
    });
  });

  it('reports "missing" for a plugin id that does not exist', async () => {
    const registry = new PluginRegistry();
    const adapter = new NodePluginCatalogAdapter(registry, [pluginsDir]);
    await adapter.listPlugins();

    expect(await adapter.checkReference('does-not-exist', '1.0.0')).toEqual({ status: 'missing' });
  });
});
