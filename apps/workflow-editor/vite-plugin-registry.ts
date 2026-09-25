import type { ViteDevServer } from 'vite';
import { consoleDiscoveryLogger, PluginCatalogProvider } from '@runflux/plugin-system/node';

/**
 * The plugins of the editor's plugin directories, discovered again after a file inside one of them
 * is added, changed or removed, so the catalog and test runs see edited plugins without a restart.
 * One instance serves every Vite plugin of the editor. Rejected plugins are logged, since they would
 * otherwise just be missing from the palette.
 */
export class PluginRegistryCache extends PluginCatalogProvider {
  constructor(directories: readonly string[]) {
    super(directories, { onLog: consoleDiscoveryLogger });
  }

  /** Invalidates the registry whenever the dev server sees a plugin file change. */
  watch(server: ViteDevServer): void {
    this.observe(server.watcher);
  }
}
