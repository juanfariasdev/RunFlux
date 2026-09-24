import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
 * Validates a plugin module and imports its runtime definition. Every import carries the file's
 * modification stamp, so a plugin edited while the editor runs is loaded again.
 */
export async function loadPlugin(module: Partial<PluginModule>, sourcePath: string): Promise<DiscoveredPlugin> {
  if (!module.manifest || !module.runtimeModule) throw new PluginLoadError('module must export "manifest" and "runtimeModule"');
  const validation = validateManifest(module.manifest);
  if (!validation.success) throw new PluginLoadError(validation.error);
  const runtime = await importPlugin<{ default?: unknown }>(await versioned(toUrl(module.runtimeModule)));
  const definition = runtime.default;
  if (!isNodeDefinition(definition)) {
    throw new PluginLoadError('runtime module must export a node definition (parseParameters and createHandler) as default');
  }
  return { manifest: validation.manifest, runtimeModule: module.runtimeModule, deployment: module.deployment, definition, sourcePath };
}

/** Imports a plugin entry file and loads the plugin it exports. */
export async function loadPluginFile(entryFile: string, sourcePath: string): Promise<DiscoveredPlugin> {
  return loadPlugin(await importPlugin<Partial<PluginModule>>(await versioned(pathToFileURL(entryFile))), sourcePath);
}

async function versioned(url: URL): Promise<URL> {
  if (url.protocol !== 'file:') return url;
  const { mtimeNs, size } = await fs.stat(fileURLToPath(url), { bigint: true });
  const stamped = new URL(url);
  stamped.searchParams.set('runflux-version', `${mtimeNs}-${size}`);
  return stamped;
}

function toUrl(location: URL | string): URL {
  return location instanceof URL ? location : location.includes('://') ? new URL(location) : pathToFileURL(location);
}

function isNodeDefinition(value: unknown): value is NodeDefinition {
  return value !== null && typeof value === 'object'
    && typeof (value as NodeDefinition).parseParameters === 'function'
    && typeof (value as NodeDefinition).createHandler === 'function';
}
