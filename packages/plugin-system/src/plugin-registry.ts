import type { NodeCatalog, NodeDefinition, NodeTypeDescription } from '@runflux/runtime';
import { scanDirectory, type ScanError } from './discovery/directory-scanner.js';
import { scanPackages } from './discovery/package-scanner.js';
import { loadPlugin } from './discovery/plugin-loader.js';
import type { DiscoveredPlugin, PluginManifest, PluginModule } from './types.js';

export class DuplicatePluginIdError extends Error {
  constructor(id: string, existingPath: string, conflictingPath: string) {
    super(
      `Duplicate plugin id "${id}": already registered from "${existingPath}", ` +
        `rejected the one from "${conflictingPath}"`,
    );
    this.name = 'DuplicatePluginIdError';
  }
}

export interface DiscoverOptions {
  pluginDirectories?: string[];
  nodeModulesDirectories?: string[];
  onLog?: (message: string) => void;
}

export interface DiscoverSummary {
  discovered: number;
  rejected: number;
  errors: ScanError[];
}

/**
 * In-memory registry of loaded plugins (D-05: no persistence of its own — rebuilt on every
 * discover() call). It is also the node catalog the editor's engine runs nodes from.
 */
export class PluginRegistry implements NodeCatalog {
  private readonly plugins = new Map<string, DiscoveredPlugin>();

  /** Registers a loaded plugin. Rejects (EC-02) rather than silently overwriting a duplicate id. */
  register(plugin: DiscoveredPlugin): void {
    const existing = this.plugins.get(plugin.manifest.id);
    if (existing) throw new DuplicatePluginIdError(plugin.manifest.id, existing.sourcePath, plugin.sourcePath);
    this.plugins.set(plugin.manifest.id, plugin);
  }

  /** Loads a plugin module that is already imported, such as one bundled with a test. */
  async registerModule(module: PluginModule, sourcePath: string): Promise<DiscoveredPlugin> {
    const plugin = await loadPlugin(module, sourcePath);
    this.register(plugin);
    return plugin;
  }

  /** Runs directory + npm-package discovery and registers every valid plugin found (RF-01). */
  async discover(options: DiscoverOptions = {}): Promise<DiscoverSummary> {
    const log = options.onLog ?? (() => {});
    const results = await Promise.all([
      ...(options.pluginDirectories ?? []).map((dir) => scanDirectory(dir)),
      ...(options.nodeModulesDirectories ?? []).map((dir) => scanPackages(dir)),
    ]);
    const errors: ScanError[] = [];
    let discovered = 0;
    let rejected = 0;
    for (const result of results) {
      errors.push(...result.errors);
      for (const plugin of result.plugins) {
        try {
          this.register(plugin);
          discovered += 1;
        } catch (error) {
          rejected += 1;
          errors.push({ path: plugin.sourcePath, error: (error as Error).message });
        }
      }
    }
    log(`Plugin discovery: ${discovered} plugin(s) registered, ${errors.length} rejected/malformed.`);
    for (const error of errors) log(`  - ${error.path}: ${error.error}`);
    return { discovered, rejected, errors };
  }

  /** Lists all registered plugin manifests (backs RF-05, the editor's palette). */
  listManifests(): PluginManifest[] {
    return [...this.plugins.values()].map((plugin) => plugin.manifest);
  }

  list(): DiscoveredPlugin[] {
    return [...this.plugins.values()];
  }

  get(pluginId: string): DiscoveredPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  getManifest(pluginId: string): PluginManifest | undefined {
    return this.plugins.get(pluginId)?.manifest;
  }

  /** The node definition of a registered plugin (NodeCatalog). */
  resolve(pluginId: string): NodeDefinition | undefined {
    return this.plugins.get(pluginId)?.definition;
  }

  /** What the workflow builder needs to know about a node type. */
  readonly describe = (pluginId: string): NodeTypeDescription | undefined => this.getManifest(pluginId);
}
