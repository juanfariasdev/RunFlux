import { validateManifest } from '@runflux/plugin-system/manifest-validator';
import { executeNode } from '@runflux/runtime/testing';
import { describe, expect, it } from 'vitest';
import { manifest } from '../index';
import set from '../runtime';

const run = (parameters: Record<string, unknown>, input?: unknown) => executeNode(set, { parameters, input, pluginId: 'set' });

describe('set', () => {
  it('declares a valid manifest with a single implicit output', () => {
    expect(validateManifest(manifest).success).toBe(true);
    expect(manifest.outputs).toBeUndefined();
  });

  it('composes typed fields, resolving their expressions from the input', async () => {
    const input = { first: 'Ada', last: 'Lovelace', id: '42' };
    const record = await run({ fields: [
      { name: 'name', value: '{{ $json.first }} {{ $json.last }}', type: 'string' },
      { name: 'optional', value: '{{ $json.missing }}', type: 'string' },
      { name: 'id', value: '{{ $json.id }}', type: 'number' },
      { name: 'active', value: 'true', type: 'boolean' },
    ] }, input);
    expect(record).toMatchObject({ error: null, activeOutput: 'main', output: { name: 'Ada Lovelace', optional: '', id: 42, active: true } });
    expect(input).toEqual({ first: 'Ada', last: 'Lovelace', id: '42' });
  });

  it('keeps the other input fields only when asked to', async () => {
    const input = { id: 42, other: 'kept' };
    expect((await run({ fields: [{ name: 'status', value: 'active' }], includeOtherFields: true }, input)).output).toEqual({ id: 42, other: 'kept', status: 'active' });
    expect((await run({ fields: [{ name: 'status', value: 'active' }], includeOtherFields: false }, input)).output).toEqual({ status: 'active' });
    expect((await run({ fields: [], includeOtherFields: true }, ['not', 'an', 'object'])).output).toEqual({});
  });

  it('outputs an empty object without fields', async () => {
    expect((await run({})).output).toEqual({});
  });

  it.each([
    [{ fields: { name: 'status' } }, 'set: parameter "fields" must be a list'],
    [{ fields: [{ name: 'count', value: 'many', type: 'number' }] }, 'Field "count" must be a number'],
    [{ fields: [{ name: 'x', type: 'date' }] }, 'set: parameter "fields" row 1 has unknown type "date"'],
    [{ fields: [], includeOtherFields: 'sometimes' }, 'set: parameter "includeOtherFields" must be true or false'],
  ])('reports invalid configuration %j', async (parameters, message) => {
    expect((await run(parameters)).error).toBe(message);
  });
});
