import { describe, expect, it } from 'vitest';
import { validateManifest } from '../manifest-validator';

const validManifest = {
  id: 'trigger-cron',
  name: 'Cron Trigger',
  category: 'trigger',
  version: '1.0.0',
  parameters: [{ name: 'schedule', label: 'Schedule', type: 'string', required: true }],
  supportedPlatforms: ['aws', 'local'],
};

describe('validateManifest — happy path', () => {
  it('accepts a well-formed manifest', () => {
    const result = validateManifest(validManifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.manifest.id).toBe('trigger-cron');
      expect(result.manifest.supportedPlatforms).toEqual(['aws', 'local']);
    }
  });

  it('accepts a parameter with a default value and the sensitive flag', () => {
    const result = validateManifest({
      ...validManifest,
      parameters: [
        {
          name: 'apiKey',
          label: 'API Key',
          type: 'string',
          required: true,
          default: '',
          sensitive: true,
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts every category value declared by PluginCategory', () => {
    for (const category of ['trigger', 'action', 'output', 'control-flow', 'subworkflow']) {
      const result = validateManifest({ ...validManifest, category });
      expect(result.success, `category "${category}" should be valid`).toBe(true);
    }
  });

  it('accepts an empty parameters array (a node with no configurable parameters)', () => {
    const result = validateManifest({ ...validManifest, parameters: [] });
    expect(result.success).toBe(true);
  });
});

describe('validateManifest — rejections (RF-04)', () => {
  it('rejects a manifest missing the required "id" field', () => {
    const { id: _id, ...withoutId } = validManifest;
    const result = validateManifest(withoutId);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toMatch(/id/i);
  });

  it('rejects an empty string "id"', () => {
    const result = validateManifest({ ...validManifest, id: '' });
    expect(result.success).toBe(false);
  });

  it('rejects a manifest with an invalid category', () => {
    const result = validateManifest({ ...validManifest, category: 'not-a-real-category' });
    expect(result.success).toBe(false);
  });

  it('rejects a manifest with an empty supportedPlatforms array', () => {
    const result = validateManifest({ ...validManifest, supportedPlatforms: [] });
    expect(result.success).toBe(false);
  });

  it('rejects a parameter with an invalid type', () => {
    const result = validateManifest({
      ...validManifest,
      parameters: [{ name: 'x', label: 'X', type: 'not-a-type', required: true }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a completely malformed candidate (not an object)', () => {
    const result = validateManifest('not-a-manifest');
    expect(result.success).toBe(false);
  });

  it('rejects null and undefined', () => {
    expect(validateManifest(null).success).toBe(false);
    expect(validateManifest(undefined).success).toBe(false);
  });
});
