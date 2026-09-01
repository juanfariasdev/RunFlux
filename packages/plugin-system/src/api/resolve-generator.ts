import type { PluginRegistry } from '../plugin-registry';
import type { GeneratorFn } from '../types';

/** Resolves the generator for a (pluginId, platform) pair (RF-06). Thin, testable wrapper over the registry. */
export function resolveGenerator(
  registry: PluginRegistry,
  pluginId: string,
  platform: string,
): GeneratorFn {
  return registry.resolveGenerator(pluginId, platform);
}

export type PluginReferenceStatus =
  | { status: 'ok' }
  | { status: 'outdated'; installedVersion: string; referencedVersion: string }
  | { status: 'missing' };

/**
 * Checks a workflow's reference to a specific plugin version against what's
 * currently installed (RF-07, RF-08).
 *
 * - "outdated": the plugin exists but at a different version — the caller
 *   (e.g. the editor) should warn the user and proceed (EC-04).
 * - "missing": the plugin id is not registered at all — the caller should
 *   surface the corresponding node as corrupted and prompt for replacement (EC-06).
 */
export function checkPluginReference(
  registry: PluginRegistry,
  pluginId: string,
  referencedVersion: string,
): PluginReferenceStatus {
  const manifest = registry.getManifest(pluginId);
  if (!manifest) {
    return { status: 'missing' };
  }
  if (manifest.version !== referencedVersion) {
    return { status: 'outdated', installedVersion: manifest.version, referencedVersion };
  }
  return { status: 'ok' };
}
