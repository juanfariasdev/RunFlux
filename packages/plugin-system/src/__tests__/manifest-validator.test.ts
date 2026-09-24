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

  it('accepts and preserves a manifest declaring named outputs (004-core-nodes-catalog, RF-06)', () => {
    const result = validateManifest({ ...validManifest, outputs: ['true', 'false'] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.manifest.outputs).toEqual(['true', 'false']);
    }
  });

  it('accepts a manifest without "outputs" (legacy single implicit output)', () => {
    const result = validateManifest(validManifest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.manifest.outputs).toBeUndefined();
    }
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

describe('validateManifest — parameter options', () => {
  const withParameter = (parameter: Record<string, unknown>) => validateManifest({
    ...validManifest,
    parameters: [{ name: 'mode', label: 'Mode', type: 'string', required: false, ...parameter }],
  });
  const options = [{ value: 'fast', label: 'Fast' }, { value: 'safe', label: 'Safe' }];

  it('accepts choices whose default is one of them', () => {
    const result = withParameter({ options, default: 'safe' });
    expect(result.success && result.manifest.parameters[0].options).toEqual(options);
  });

  it('accepts any default when the choices are only suggestions', () => {
    expect(withParameter({ options, allowCustomOptions: true, default: 'custom' }).success).toBe(true);
  });

  it.each([
    [{ options, default: 'other' }, 'parameters.0.default: default "other" is not one of the options'],
    [{ options, type: 'number' }, 'parameters.0.options: options are only supported on string parameters'],
    [{ options: [] }, 'parameters.0.options: Array must contain at least 1 element(s)'],
    [{ options: [{ value: 1, label: 'One' }] }, 'parameters.0.options.0.value: Expected string, received number'],
  ])('rejects %j', (parameter, error) => {
    expect(withParameter(parameter)).toEqual({ success: false, error });
  });
});

describe('validateManifest — conditional and code parameters', () => {
  const parameters = (...extra: Record<string, unknown>[]) => validateManifest({
    ...validManifest,
    parameters: [{ name: 'mode', label: 'Mode', type: 'string', required: false }, ...extra.map((parameter) => ({ label: 'X', type: 'string', required: false, ...parameter }))],
  });

  it('accepts a parameter shown while another one holds some values, and a code parameter', () => {
    expect(parameters({ name: 'secret', showWhen: { parameter: 'mode', oneOf: ['header'] } }, { name: 'source', language: 'sql' }).success).toBe(true);
  });

  it.each([
    [{ name: 'secret', showWhen: { parameter: 'missing', oneOf: ['x'] } }, 'parameters.1.showWhen.parameter: showWhen refers to unknown parameter "missing"'],
    [{ name: 'secret', showWhen: { parameter: 'secret', oneOf: ['x'] } }, 'parameters.1.showWhen.parameter: showWhen refers to unknown parameter "secret"'],
    [{ name: 'secret', showWhen: { parameter: 'mode', oneOf: [] } }, 'parameters.1.showWhen.oneOf: Array must contain at least 1 element(s)'],
    [{ name: 'mode' }, 'parameters.1.name: parameter "mode" is declared twice'],
    [{ name: 'script', type: 'json', language: 'javascript' }, 'parameters.1.language: language is only supported on string parameters'],
    [{ name: 'script', language: 'python' }, "parameters.1.language: Invalid enum value. Expected 'javascript' | 'sql', received 'python'"],
  ])('rejects %j', (parameter, error) => {
    expect(parameters(parameter)).toEqual({ success: false, error });
  });
});
