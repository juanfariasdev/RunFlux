import path from 'node:path';
import { PluginRegistry } from './plugin-registry.js';

/** What the provider needs from a file watcher; the watcher of Vite's dev server (chokidar) is one. */
export interface PluginFileWatcher {
  add(paths: string[]): unknown;
  on(event: 'all', listener: (event: string, file: string) => void): unknown;
}

export interface PluginCatalogProviderOptions {
  /** Receives the discovery report, including the plugins it rejected. */
  readonly onLog?: (message: string) => void;
}

/**
 * The plugins found in a set of directories. Discovery runs on first use and again after a file
 * inside one of those directories changes, when a watcher reports it; a failed discovery is retried
 * by the next call instead of being cached. The editor's catalog, its test runs and the compiler use
 * this one implementation, so they agree on which plugins exist.
 */
export class PluginCatalogProvider {
  readonly directories: readonly string[];
  private readonly onLog?: (message: string) => void;
  private current?: Promise<PluginRegistry>;
  private readonly watchers = new WeakSet<PluginFileWatcher>();

  constructor(directories: readonly string[], options: PluginCatalogProviderOptions = {}) {
    this.directories = directories.map((directory) => path.resolve(directory));
    this.onLog = options.onLog;
  }

  registry(): Promise<PluginRegistry> {
    if (!this.current) {
      const discovery = this.discover();
      this.current = discovery;
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

  /** Invalidates the registry whenever `watcher` sees a plugin file change. */
  observe(watcher: PluginFileWatcher): void {
    if (this.watchers.has(watcher)) return;
    this.watchers.add(watcher);
    if (this.directories.length > 0) watcher.add([...this.directories]);
    watcher.on('all', (_event, file) => {
      if (this.contains(file)) this.invalidate();
    });
  }

  private async discover(): Promise<PluginRegistry> {
    const registry = new PluginRegistry();
    await registry.discover({ pluginDirectories: [...this.directories], onLog: this.onLog });
    return registry;
  }
}
