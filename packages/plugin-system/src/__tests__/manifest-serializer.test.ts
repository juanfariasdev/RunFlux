import { describe, expect, it } from 'vitest';
import { deserializeManifest, serializeManifest } from '../manifest-serializer';
import type { PluginManifest } from '../types';

const manifest: PluginManifest = {
  id: 'action-example',
  name: 'Example Action',
  category: 'action',
  version: '1.0.0',
  parameters: [],
  supportedPlatforms: ['local'],
};

describe('serializeManifest', () => {
  it('produces a JSON string that round-trips back to an equivalent manifest', () => {
    const json = serializeManifest(manifest);
    expect(typeof json).toBe('string');

    const result = deserializeManifest(json);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.manifest).toEqual(manifest);
    }
  });
});

describe('deserializeManifest', () => {
  it('rejects a string that is not valid JSON', () => {
    const result = deserializeManifest('{not valid json');
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/invalid JSON/i);
  });

  it('rejects valid JSON that does not satisfy the manifest schema', () => {
    const result = deserializeManifest(JSON.stringify({ foo: 'bar' }));
    expect(result.success).toBe(false);
  });

  it('accepts a hand-written JSON manifest matching the schema', () => {
    const result = deserializeManifest(JSON.stringify(manifest));
    expect(result.success).toBe(true);
  });
});
