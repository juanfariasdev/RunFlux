import { describe, expect, it } from 'vitest';
import { isConnectionCompatible } from '../connection-compatibility';
import type { PluginManifest } from '@runflux/plugin-system/sdk';

function manifest(category: PluginManifest['category']): PluginManifest {
  return { id: `m-${category}`, name: category, category, version: '1.0.0', parameters: [], supportedPlatforms: ['local'] };
}

describe('isConnectionCompatible', () => {
  it('rejects a connection into a trigger (a trigger never receives)', () => {
    expect(isConnectionCompatible(manifest('action'), manifest('trigger'))).toBe(false);
  });

  it('rejects a connection out of an output node (an output never sends further)', () => {
    expect(isConnectionCompatible(manifest('output'), manifest('action'))).toBe(false);
  });

  it('accepts a normal action-to-action connection', () => {
    expect(isConnectionCompatible(manifest('action'), manifest('action'))).toBe(true);
  });

  it('accepts trigger-to-action and action-to-output (the expected happy paths)', () => {
    expect(isConnectionCompatible(manifest('trigger'), manifest('action'))).toBe(true);
    expect(isConnectionCompatible(manifest('action'), manifest('output'))).toBe(true);
  });

  it('does not block when either manifest is unresolved (avoids compounding an already-broken node, EC-01)', () => {
    expect(isConnectionCompatible(undefined, manifest('trigger'))).toBe(true);
    expect(isConnectionCompatible(manifest('output'), undefined)).toBe(true);
    expect(isConnectionCompatible(undefined, undefined)).toBe(true);
  });
});
