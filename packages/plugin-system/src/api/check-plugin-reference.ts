import type { PluginRegistry } from '../plugin-registry.js';

export type PluginReferenceStatus =
  | { status: 'ok' }
  | { status: 'outdated'; installedVersion: string; referencedVersion: string }
  | { status: 'missing' };

/**
 * Checks a workflow's reference to a specific plugin version against what is currently installed
 * (RF-07, RF-08).
 *
 * - "outdated": the plugin exists at a different version; the editor warns and proceeds (EC-04).
 * - "missing": the plugin id is not registered; the editor marks the node as corrupted (EC-06).
 */
export function checkPluginReference(registry: PluginRegistry, pluginId: string, referencedVersion: string): PluginReferenceStatus {
  const manifest = registry.getManifest(pluginId);
  if (!manifest) return { status: 'missing' };
  if (manifest.version !== referencedVersion) return { status: 'outdated', installedVersion: manifest.version, referencedVersion };
  return { status: 'ok' };
}
