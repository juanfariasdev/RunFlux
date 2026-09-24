import { PluginRegistry } from '@runflux/plugin-system';
import { listPlugins } from '@runflux/plugin-system/api/list-plugins';
import { checkPluginReference } from '@runflux/plugin-system/api/check-plugin-reference';
import type { PluginManifest } from '@runflux/plugin-system/types';
import type { PluginReferenceStatus } from '@runflux/plugin-system/api/check-plugin-reference';
import type { PluginCatalogAdapter } from './plugin-catalog-adapter';

/**
 * Node-only implementation of PluginCatalogAdapter, backed directly by
 * PluginRegistry.discover() (which uses `node:fs`). NEVER imported by
 * App.tsx or any other browser-bundled module — see plugin-catalog-adapter.ts
 * for the browser-safe (`fetch`-based) implementation the app actually uses.
 *
 * This exists for: (a) `vite-plugin-plugin-catalog.ts`, which runs in Vite's
 * own Node process and serves this adapter's data to the browser over HTTP,
 * and (b) tests that want to exercise discovery directly without a server.
 */
export class NodePluginCatalogAdapter implements PluginCatalogAdapter {
  private discovered = false;
  private registry: PluginRegistry;
  private pluginDirectories: string[];

  constructor(registry: PluginRegistry, pluginDirectories: string[] = []) {
    this.registry = registry;
    this.pluginDirectories = pluginDirectories;
  }

  async listPlugins(): Promise<Record<string, PluginManifest[]>> {
    await this.ensureDiscovered();
    return listPlugins(this.registry);
  }

  async checkReference(pluginId: string, referencedVersion: string): Promise<PluginReferenceStatus> {
    await this.ensureDiscovered();
    return checkPluginReference(this.registry, pluginId, referencedVersion);
  }

  private async ensureDiscovered(): Promise<void> {
    if (this.discovered) return;
    await this.registry.discover({ pluginDirectories: this.pluginDirectories });
    this.discovered = true;
  }
}

export function createDefaultPluginCatalogAdapter(pluginDirectories: string[] = []): PluginCatalogAdapter {
  return new NodePluginCatalogAdapter(new PluginRegistry(), pluginDirectories);
}
