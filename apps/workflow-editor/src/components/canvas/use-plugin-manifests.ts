import { useEffect, useState } from 'react';
import type { PluginManifest } from '@runflux/plugin-system/sdk';
import type { WorkflowNode } from '@runflux/workflow-model/types';
import type { PluginCatalogAdapter } from '../../adapters/plugin-catalog-adapter';

/**
 * The manifests of the catalog, by plugin id. Loaded once, and again while a node of the workflow
 * refers to a plugin not loaded yet (a plugin added or renamed since); manifests already known win.
 */
export function usePluginManifests(catalog: PluginCatalogAdapter, nodes: readonly WorkflowNode[]): Record<string, PluginManifest> {
  const [manifests, setManifests] = useState<Record<string, PluginManifest>>({});

  useEffect(() => {
    let cancelled = false;
    catalog.listPlugins().then((grouped) => {
      if (cancelled) return;
      const resolved = Object.fromEntries(Object.values(grouped).flat().map((manifest) => [manifest.id, manifest]));
      setManifests((previous) => ({ ...resolved, ...previous }));
    });
    return () => { cancelled = true; };
  }, [catalog]);

  useEffect(() => {
    const pluginIds = nodes
      .filter((node) => node.appearance?.shape !== 'subflow')
      .map((node) => node.pluginId)
      .filter((pluginId) => !manifests[pluginId]);
    if (pluginIds.length === 0) return;

    let cancelled = false;
    catalog.listPlugins().then((grouped) => {
      if (cancelled) return;
      const resolved = Object.fromEntries(Object.values(grouped).flat().map((manifest) => [manifest.id, manifest]));
      setManifests((previous) => ({ ...resolved, ...previous }));
    });
    return () => { cancelled = true; };
  }, [catalog, manifests, nodes]);

  return manifests;
}
