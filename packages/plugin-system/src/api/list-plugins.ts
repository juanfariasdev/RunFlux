import type { PluginRegistry } from '../plugin-registry';
import type { PluginManifest } from '../types';

/** Lists every registered plugin, grouped by category — consumed by the workflow-editor palette (RF-05). */
export function listPlugins(registry: PluginRegistry): Record<string, PluginManifest[]> {
  const grouped: Record<string, PluginManifest[]> = {};
  for (const manifest of registry.listManifests()) {
    (grouped[manifest.category] ??= []).push(manifest);
  }
  return grouped;
}
