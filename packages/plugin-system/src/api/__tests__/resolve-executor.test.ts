import { describe, expect, it } from 'vitest';
import { PluginRegistry } from '../../plugin-registry';
import { resolveExecutor } from '../resolve-executor';
import type { DiscoveredPlugin } from '../../types';

function registryWith(plugin: Partial<DiscoveredPlugin> & { manifest: DiscoveredPlugin['manifest'] }): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register({
    generators: { local: () => ({ files: [], infra: [] }) },
    sourcePath: '/plugins/example',
    ...plugin,
  });
  return registry;
}

const manifest: DiscoveredPlugin['manifest'] = {
  id: 'action-example',
  name: 'Example Action',
  category: 'action',
  version: '1.0.0',
  parameters: [],
  supportedPlatforms: ['local'],
};

describe('resolveExecutor (D-04)', () => {
  it('returns the execute function when the plugin declares one', () => {
    const execute = () => 'result';
    const registry = registryWith({ manifest, execute });
    expect(resolveExecutor(registry, 'action-example')).toBe(execute);
  });

  it('returns undefined (does not throw) when the plugin has no execute function', () => {
    const registry = registryWith({ manifest });
    expect(resolveExecutor(registry, 'action-example')).toBeUndefined();
  });

  it('returns undefined (does not throw) when the plugin id is not registered at all', () => {
    const registry = new PluginRegistry();
    expect(resolveExecutor(registry, 'does-not-exist')).toBeUndefined();
  });
});
