import type { PluginManifest } from '@runflux/plugin-system/sdk';
import type { PluginReferenceStatus } from '@runflux/plugin-system/sdk';

/**
 * Seam between the editor's UI (browser) and the Plugin System's discovery
 * mechanism (Node.js `fs`-based, `001-plugin-system`). Browser-safe: this
 * file and its implementation below use only `fetch`, never a Node API —
 * discovery runs in `vite-plugin-plugin-catalog.ts`, in Vite's Node process.
 */
export interface PluginCatalogAdapter {
  listPlugins(): Promise<Record<string, PluginManifest[]>>;
  checkReference(pluginId: string, referencedVersion: string): Promise<PluginReferenceStatus>;
}

/**
 * Production/browser implementation (resolves the gap from roadmap.md D-09/D-10):
 * fetches the plugin catalog from a URL served by `vite-plugin-plugin-catalog.ts`
 * (a dev-server middleware in development, a static JSON asset in a production
 * build) instead of running filesystem-based discovery itself.
 *
 * `checkReference` is pure computation over the fetched manifest list — it
 * never needed Node access in the first place, only `listPlugins()` did.
 */
export class HttpPluginCatalogAdapter implements PluginCatalogAdapter {
  private cache: Record<string, PluginManifest[]> | undefined;
  private readonly url: string;

  constructor(url: string = '/runflux-plugins.json') {
    this.url = url;
  }

  async listPlugins(): Promise<Record<string, PluginManifest[]>> {
    if (!this.cache) {
      const response = await fetch(this.url);
      if (!response.ok) {
        throw new Error(`Failed to load plugin catalog from ${this.url}: HTTP ${response.status}`);
      }
      this.cache = (await response.json()) as Record<string, PluginManifest[]>;
    }
    return this.cache;
  }

  async checkReference(pluginId: string, referencedVersion: string): Promise<PluginReferenceStatus> {
    const grouped = await this.listPlugins();
    const manifest = Object.values(grouped)
      .flat()
      .find((m) => m.id === pluginId);

    if (!manifest) {
      return { status: 'missing' };
    }
    if (manifest.version !== referencedVersion) {
      return { status: 'outdated', installedVersion: manifest.version, referencedVersion };
    }
    return { status: 'ok' };
  }
}
