import { describe, expect, it } from 'vitest';
import { PluginRegistry } from '../../plugin-registry';
import { testPlugin } from '../../testing';
import { checkPluginReference } from '../check-plugin-reference';

function registryWithOnePlugin(version = '1.0.0'): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register(testPlugin({ id: 'action-example', version }));
  return registry;
}

describe('checkPluginReference (RF-08)', () => {
  it('returns "ok" when the referenced version matches the installed one', () => {
    expect(checkPluginReference(registryWithOnePlugin('1.2.0'), 'action-example', '1.2.0')).toEqual({ status: 'ok' });
  });

  it('returns "outdated" (warn) when the installed version differs (EC-04)', () => {
    expect(checkPluginReference(registryWithOnePlugin('2.0.0'), 'action-example', '1.0.0')).toEqual({
      status: 'outdated',
      installedVersion: '2.0.0',
      referencedVersion: '1.0.0',
    });
  });

  it('returns "missing" (corrupted node) when the plugin id is not registered at all (EC-06)', () => {
    expect(checkPluginReference(registryWithOnePlugin(), 'does-not-exist', '1.0.0')).toEqual({ status: 'missing' });
  });
});
