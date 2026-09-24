import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { consoleDiscoveryLogger, PluginRegistry } from '@runflux/plugin-system/node';

/**
 * The plugins found in the editor's plugin directories. Discovery runs on first use and again
 * after a file inside one of those directories is added, changed or removed, so the catalog and
 * test runs see edited plugins without a restart. One instance serves every Vite plugin of the
 * editor.
 */
export class PluginRegistryCache {
  readonly directories: readonly string[];
  private current?: Promise<PluginRegistry>;
  private readonly watched = new WeakSet<ViteDevServer>();

  constructor(directories: readonly string[]) {
    this.directories = directories.map((directory) => path.resolve(directory));
  }

  registry(): Promise<PluginRegistry> {
    if (!this.current) {
      const discovery = this.discover();
      this.current = discovery;
      // A failed discovery is retried by the next request instead of being cached.
      discovery.catch(() => {
        if (this.current === discovery) this.current = undefined;
      });
    }
    return this.current;
  }

  invalidate(): void {
    this.current = undefined;
  }

  /** Whether `file` lies inside one of the plugin directories. */
  contains(file: string): boolean {
    const resolved = path.resolve(file);
    return this.directories.some((directory) => resolved === directory || resolved.startsWith(`${directory}${path.sep}`));
  }

  /** Invalidates the registry whenever the dev server sees a plugin file change. */
  watch(server: ViteDevServer): void {
    if (this.watched.has(server)) return;
    this.watched.add(server);
    if (this.directories.length > 0) server.watcher.add([...this.directories]);
    server.watcher.on('all', (_event, file) => {
      if (this.contains(file)) this.invalidate();
    });
  }

  private async discover(): Promise<PluginRegistry> {
    const registry = new PluginRegistry();
    // Logs the plugins it rejects, which would otherwise just be missing from the palette.
    await registry.discover({ pluginDirectories: [...this.directories], onLog: consoleDiscoveryLogger });
    return registry;
  }
}
