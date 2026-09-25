import { validateManifest } from '@runflux/plugin-system/sdk';
import { executeNode } from '@runflux/runtime/testing';
import { describe, expect, it } from 'vitest';
import { manifest } from '../index';
import filter from '../runtime';

const run = (parameters: Record<string, unknown>, input: unknown = {}) =>
  executeNode(filter, { parameters, input, outputs: manifest.outputs, pluginId: 'filter' });

describe('filter', () => {
  it('declares a valid manifest with a main output', () => {
    expect(validateManifest(manifest).success).toBe(true);
    expect(manifest.outputs).toEqual(['main']);
  });

  it('passes a matching input through main and ends the branch otherwise, without an error', async () => {
    const conditions = [{ leftValue: '{{ $json.status }}', operator: 'equals', rightValue: 'paid' }];
    expect(await run({ conditions }, { status: 'paid' })).toMatchObject({ activeOutput: 'main', output: { status: 'paid' }, error: null });
    expect(await run({ conditions }, { status: 'open' })).toMatchObject({ activeOutput: null, output: { status: 'open' }, error: null });
  });

  it('supports the or combinator and passes everything without conditions', async () => {
    const conditions = [{ leftValue: '{{ $json.a }}', operator: 'isEmpty' }, { leftValue: '{{ $json.b }}', operator: 'isEmpty' }];
    expect((await run({ conditions, combinator: 'or' }, { a: 'x' })).activeOutput).toBe('main');
    expect((await run({})).activeOutput).toBe('main');
  });

  it('reports an unknown operator', async () => {
    expect((await run({ conditions: [{ operator: 'nearly' }] })).error).toBe('filter: parameter "conditions" row 1 uses unknown operator "nearly"');
  });
});
