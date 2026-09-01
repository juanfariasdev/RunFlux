import { describe, expect, it } from 'vitest';
import { PluginRegistry } from '../../plugin-registry';
import { checkPluginReference, resolveGenerator } from '../resolve-generator';
import type { DiscoveredPlugin } from '../../types';

function registryWithOnePlugin(version = '1.0.0'): PluginRegistry {
  const plugin: DiscoveredPlugin = {
    manifest: {
      id: 'action-example',
      name: 'Example Action',
      category: 'action',
      version,
      parameters: [],
      supportedPlatforms: ['local'],
    },
    generators: { local: () => ({ files: [], infra: [] }) },
    sourcePath: '/plugins/action-example',
  };
  const registry = new PluginRegistry();
  registry.register(plugin);
  return registry;
}

describe('resolveGenerator (api wrapper)', () => {
  it('delegates to the registry and returns the generator', () => {
    const registry = registryWithOnePlugin();
    const generator = resolveGenerator(registry, 'action-example', 'local');
    expect(generator).toBeTypeOf('function');
  });

  it('propagates the registry error for an unsupported platform', () => {
    const registry = registryWithOnePlugin();
    expect(() => resolveGenerator(registry, 'action-example', 'aws')).toThrow(
      /does not support platform "aws"/i,
    );
  });
});

describe('checkPluginReference (RF-08)', () => {
  it('returns "ok" when the referenced version matches the installed one', () => {
    const registry = registryWithOnePlugin('1.2.0');
    expect(checkPluginReference(registry, 'action-example', '1.2.0')).toEqual({ status: 'ok' });
  });

  it('returns "outdated" (warn) when the installed version differs (EC-04)', () => {
    const registry = registryWithOnePlugin('2.0.0');
    const result = checkPluginReference(registry, 'action-example', '1.0.0');
    expect(result).toEqual({
      status: 'outdated',
      installedVersion: '2.0.0',
      referencedVersion: '1.0.0',
    });
  });

  it('returns "missing" (corrupted node) when the plugin id is not registered at all (EC-06)', () => {
    const registry = registryWithOnePlugin();
    const result = checkPluginReference(registry, 'does-not-exist', '1.0.0');
    expect(result).toEqual({ status: 'missing' });
  });
});
