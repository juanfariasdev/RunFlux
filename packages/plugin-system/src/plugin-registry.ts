import type { DiscoveredPlugin, ExecutorFn, GeneratorFn, PluginManifest } from './types';
import { scanDirectory, type ScanError } from './discovery/directory-scanner';
import { scanPackages } from './discovery/package-scanner';

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
 * In-memory registry of discovered plugins (D-05: no persistence of its own —
 * rebuilt on every discover() call, e.g. at boot).
 */
export class PluginRegistry {
  private plugins = new Map<string, DiscoveredPlugin>();

  /** Registers a discovered plugin. Rejects (EC-02) rather than silently overwriting a duplicate id. */
  register(plugin: DiscoveredPlugin): void {
    const existing = this.plugins.get(plugin.manifest.id);
    if (existing) {
      throw new DuplicatePluginIdError(plugin.manifest.id, existing.sourcePath, plugin.sourcePath);
    }
    this.plugins.set(plugin.manifest.id, plugin);
  }

  /** Runs directory + npm-package discovery and registers every valid plugin found (RF-01). */
  async discover(options: DiscoverOptions = {}): Promise<DiscoverSummary> {
    const log = options.onLog ?? (() => {});
    const errors: ScanError[] = [];
    let discovered = 0;
    let rejected = 0;

    const directoryResults = await Promise.all(
      (options.pluginDirectories ?? []).map((dir) => scanDirectory(dir)),
    );
    const packageResults = await Promise.all(
      (options.nodeModulesDirectories ?? []).map((dir) => scanPackages(dir)),
    );

    for (const result of [...directoryResults, ...packageResults]) {
      errors.push(...result.errors);
      for (const plugin of result.plugins) {
        try {
          this.register(plugin);
          discovered += 1;
        } catch (err) {
          rejected += 1;
          errors.push({ path: plugin.sourcePath, error: (err as Error).message });
        }
      }
    }

    log(
      `Plugin discovery: ${discovered} plugin(s) registered, ${errors.length} rejected/malformed.`,
    );
    for (const error of errors) {
      log(`  - ${error.path}: ${error.error}`);
    }

    return { discovered, rejected, errors };
  }

  /** Lists all registered plugin manifests (backs RF-05, the editor's palette). */
  listManifests(): PluginManifest[] {
    return [...this.plugins.values()].map((p) => p.manifest);
  }

  /** Resolves the generator for a (pluginId, platform) pair (RF-06). Throws a clear error otherwise. */
  resolveGenerator(pluginId: string, platform: string): GeneratorFn {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Unknown plugin "${pluginId}"`);
    }
    const generator = plugin.generators[platform];
    if (!generator) {
      throw new Error(`Plugin "${pluginId}" does not support platform "${platform}"`);
    }
    return generator;
  }

  /** Returns the manifest for a plugin id, or undefined if not registered (used by RF-08 fallback checks). */
  getManifest(pluginId: string): PluginManifest | undefined {
    return this.plugins.get(pluginId)?.manifest;
  }

  /**
   * Returns the local executor for a plugin id, or undefined if the plugin
   * is not registered or does not declare one (003-validation-runtime, D-04).
   * Unlike `resolveGenerator`, this never throws — the caller (the
   * validation engine) turns "no executor" into a per-node result, not an
   * exception that would abort the whole run.
   */
  getExecutor(pluginId: string): ExecutorFn | undefined {
    return this.plugins.get(pluginId)?.execute;
  }
}
