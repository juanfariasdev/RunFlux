import { describe, expect, it } from 'vitest';
import { PluginRegistry } from '../../plugin-registry';
import { listPlugins } from '../list-plugins';
import type { DiscoveredPlugin } from '../../types';

function makePlugin(id: string, category: DiscoveredPlugin['manifest']['category']): DiscoveredPlugin {
  return {
    manifest: { id, name: id, category, version: '1.0.0', parameters: [], supportedPlatforms: ['local'] },
    generators: { local: () => ({ files: [], infra: [] }) },
    sourcePath: `/plugins/${id}`,
  };
}

describe('listPlugins', () => {
  it('returns an empty object when the registry has no plugins', () => {
    const registry = new PluginRegistry();
    expect(listPlugins(registry)).toEqual({});
  });

  it('groups plugins by category', () => {
    const registry = new PluginRegistry();
    registry.register(makePlugin('trigger-a', 'trigger'));
    registry.register(makePlugin('action-a', 'action'));
    registry.register(makePlugin('action-b', 'action'));

    const grouped = listPlugins(registry);

    expect(grouped.trigger?.map((m) => m.id)).toEqual(['trigger-a']);
    expect(grouped.action?.map((m) => m.id).sort()).toEqual(['action-a', 'action-b']);
    expect(grouped.output).toBeUndefined();
  });
});
