import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpPluginCatalogAdapter } from '../plugin-catalog-adapter';
import type { PluginManifest } from '@runflux/plugin-system/types';

function manifest(id: string, version = '1.0.0'): PluginManifest {
  return { id, name: id, category: 'trigger', version, parameters: [], supportedPlatforms: ['local'] };
}

const catalogResponse = { trigger: [manifest('trigger-manual-example')] };

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: async () => catalogResponse }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HttpPluginCatalogAdapter (browser-safe — no Node APIs, see plugin-catalog-adapter.node.ts for the Node side)', () => {
  it('fetches the catalog from the default URL', async () => {
    const adapter = new HttpPluginCatalogAdapter();
    const result = await adapter.listPlugins();

    expect(fetch).toHaveBeenCalledWith('/runflux-plugins.json');
    expect(result).toEqual(catalogResponse);
  });

  it('accepts a custom URL', async () => {
    const adapter = new HttpPluginCatalogAdapter('/custom-path.json');
    await adapter.listPlugins();
    expect(fetch).toHaveBeenCalledWith('/custom-path.json');
  });

  it('caches the response — a second call does not fetch again', async () => {
    const adapter = new HttpPluginCatalogAdapter();
    await adapter.listPlugins();
    await adapter.listPlugins();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error when the HTTP response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }));
    const adapter = new HttpPluginCatalogAdapter();
    await expect(adapter.listPlugins()).rejects.toThrow(/HTTP 500/);
  });

  describe('checkReference', () => {
    it('reports "ok" when the referenced version matches', async () => {
      const adapter = new HttpPluginCatalogAdapter();
      expect(await adapter.checkReference('trigger-manual-example', '1.0.0')).toEqual({ status: 'ok' });
    });

    it('reports "outdated" when the installed version differs', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ trigger: [manifest('trigger-manual-example', '2.0.0')] }) }));
      const adapter = new HttpPluginCatalogAdapter();
      expect(await adapter.checkReference('trigger-manual-example', '1.0.0')).toEqual({
        status: 'outdated',
        installedVersion: '2.0.0',
        referencedVersion: '1.0.0',
      });
    });

    it('reports "missing" when the plugin id is not in the catalog', async () => {
      const adapter = new HttpPluginCatalogAdapter();
      expect(await adapter.checkReference('does-not-exist', '1.0.0')).toEqual({ status: 'missing' });
    });
  });
});
