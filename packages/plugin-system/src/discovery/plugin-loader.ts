import { pathToFileURL } from 'node:url';
import type { NodeDefinition } from '@runflux/runtime';
import { validateManifest } from '../manifest-validator.js';
import type { DiscoveredPlugin, PluginModule } from '../types.js';
import { importPlugin } from './import-plugin.js';

export class PluginLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginLoadError';
  }
}

/**
 * Validates a plugin module and imports its runtime definition. A plugin edited while the editor
 * runs is loaded again on the next discovery (see importPlugin).
 */
export async function loadPlugin(module: Partial<PluginModule>, sourcePath: string): Promise<DiscoveredPlugin> {
  if (!module.manifest || !module.runtimeModule) throw new PluginLoadError('module must export "manifest" and "runtimeModule"');
  const validation = validateManifest(module.manifest);
  if (!validation.success) throw new PluginLoadError(validation.error);
  const runtime = await importPlugin<{ default?: unknown }>(toUrl(module.runtimeModule));
  const definition = runtime.default;
  if (!isNodeDefinition(definition)) {
    throw new PluginLoadError('runtime module must export a node definition (parseParameters and createHandler) as default');
  }
  return { manifest: validation.manifest, runtimeModule: module.runtimeModule, deployment: module.deployment, definition, sourcePath };
}

/** Imports a plugin entry file and loads the plugin it exports. */
export async function loadPluginFile(entryFile: string, sourcePath: string): Promise<DiscoveredPlugin> {
  return loadPlugin(await importPlugin<Partial<PluginModule>>(pathToFileURL(entryFile)), sourcePath);
}

function toUrl(location: URL | string): URL {
  return location instanceof URL ? location : location.includes('://') ? new URL(location) : pathToFileURL(location);
}

function isNodeDefinition(value: unknown): value is NodeDefinition {
  return value !== null && typeof value === 'object'
    && typeof (value as NodeDefinition).parseParameters === 'function'
    && typeof (value as NodeDefinition).createHandler === 'function';
}
