import { validateManifest } from '@runflux/plugin-system/sdk';
import { ExpressionEvaluator, type NodeContext } from '@runflux/runtime';
import { executeNode } from '@runflux/runtime/testing';
import { describe, expect, it } from 'vitest';
import { manifest } from '../index';
import mapFields, { MapFieldsNode } from '../runtime';

// Like the engine, keep verbatim the parameters the manifest does not let it resolve.
const literalParameters = manifest.parameters.filter((parameter) => parameter.expressions === false || parameter.expressions === 'perElement').map((parameter) => parameter.name);

const run = (parameters: Record<string, unknown>, input?: unknown, extra: { nodes?: Record<string, unknown>; env?: Record<string, string> } = {}) =>
  executeNode(mapFields, { parameters, input, literalParameters, pluginId: 'map-fields', ...extra });

describe('map-fields', () => {
  it('declares a valid manifest whose mapped parameters are evaluated per element', () => {
    expect(validateManifest(manifest).success).toBe(true);
    expect(manifest.outputs).toBeUndefined();
    expect(literalParameters).toEqual(['fields', 'value']);
  });

  it('evaluates each field once per element, keeping the input order (RF-01)', async () => {
    const record = await run({ fields: [{ name: 'b', value: '{{ $json.a * 2 }}' }] }, [{ a: 1 }, { a: 2 }]);
    expect(record).toMatchObject({ error: null, activeOutput: 'main', output: [{ b: 2 }, { b: 4 }] });
  });

  it('gives every element the same $node and $env as any node', async () => {
    const record = await run(
      { fields: [{ name: 't', value: "{{ $node['stats'].json.total }}-{{ $env.REGION }}-{{ $json.a }}" }] },
      [{ a: 1 }, { a: 2 }],
      { nodes: { stats: { total: 3 } }, env: { REGION: 'eu' } },
    );
    expect(record.output).toEqual([{ t: '3-eu-1' }, { t: '3-eu-2' }]);
  });

  it('keeps the other fields of each element only when asked to (RF-02)', async () => {
    const fields = [{ name: 'b', value: '{{ $json.a }}' }];
    expect((await run({ fields, includeOtherFields: true }, [{ a: 1, c: 'x' }, 'text'])).output).toEqual([{ a: 1, c: 'x', b: 1 }, { b: undefined }]);
    expect((await run({ fields, includeOtherFields: false }, [{ a: 1, c: 'x' }])).output).toEqual([{ b: 1 }]);
  });

  it('maps each element to one value in value mode (RF-09)', async () => {
    const record = await run({ mode: 'value', value: '{{ $json.tag }}' }, [{ tag: 'hardware' }, { tag: 'wireless' }]);
    expect(record.output).toEqual(['hardware', 'wireless']);
  });

  it('maps an input that is not a list as one element and keeps its shape (RF-11)', async () => {
    expect((await run({ fields: [{ name: 'b', value: '{{ $json.a }}' }] }, { a: 1 })).output).toEqual({ b: 1 });
    expect((await run({ mode: 'value', value: '{{ $json.a }}' }, { a: 1 })).output).toBe(1);
  });

  it('outputs an empty list for an empty list (RN-06)', async () => {
    expect(await run({ fields: [{ name: 'b', value: '{{ $json.a }}' }] }, [])).toMatchObject({ error: null, activeOutput: 'main', output: [] });
  });

  it('applies the Set field types to each element (RN-07)', async () => {
    const text = await run({ fields: [{ name: 't', value: '{{ $json.name }}', type: 'string' }] }, [{ name: 'Ana' }, { id: 2 }]);
    expect(text.output).toEqual([{ t: 'Ana' }, { t: '' }]);
    const number = await run({ fields: [{ name: 'n', value: '{{ $json.count }}', type: 'number' }] }, [{ count: 1 }, { id: 2 }]);
    expect(number.error).toBe('map-fields: field "n" failed for element 2 (FieldTypeError)');
  });

  it('fails the node by default, naming the field and the position but not the content (RF-08)', async () => {
    const record = await run({ fields: [{ name: 'b', value: '{{ $json.a.x }}' }] }, [{ a: { x: 1 } }, null]);
    expect(record).toMatchObject({ output: null, error: 'map-fields: field "b" failed for element 2 (TypeError)' });
  });

  it('never quotes the element in a failure, even when the cause would', async () => {
    const record = await run({ fields: [{ name: 'parsed', value: '{{ JSON.parse($json.raw) }}' }] }, [{ raw: 'secret-token-123' }]);
    expect(record.error).toBe('map-fields: field "parsed" failed for element 1 (SyntaxError)');
    expect(record.error).not.toContain('secret');
  });

  it('skips failing elements when asked to and reports each skip without its content (RF-10)', async () => {
    const record = await run({ onElementError: 'skip', fields: [{ name: 'b', value: '{{ $json.a.x }}' }] }, [{ a: { x: 1 } }, null, { a: { x: 3 } }]);
    expect(record).toMatchObject({ error: null, activeOutput: 'main', output: [{ b: 1 }, { b: 3 }], notices: ['field "b" skipped element 2 (TypeError)'] });
    const value = await run({ mode: 'value', value: '{{ $json.tag.length }}', onElementError: 'skip' }, [{ tag: 'ab' }, {}]);
    expect(value).toMatchObject({ output: [2], notices: ['value skipped element 2 (TypeError)'] });
  });

  it('outputs null for a single element that is skipped', async () => {
    const record = await run({ onElementError: 'skip', fields: [{ name: 'b', value: '{{ $json.a.x }}' }] }, null);
    expect(record).toMatchObject({ error: null, activeOutput: 'main', output: null, notices: ['field "b" skipped element 1 (TypeError)'] });
  });

  it('compiles each distinct expression once, whatever the number of elements', async () => {
    const evaluator = new ExpressionEvaluator();
    const handler = new MapFieldsNode(evaluator);
    const rows = Array.from({ length: 1000 }, (_, index) => ({ a: index, b: index, c: index, d: index, e: index }));
    const fields = ['a', 'b', 'c', 'd', 'e'].map((key) => ({ name: key, value: `{{ $json.${key} + 1 }}` }));
    const context = { workflowId: 'w', nodeId: 'map', mode: 'sandbox', nodes: {}, env: {}, signal: new AbortController().signal } as NodeContext;
    const output = handler.execute({ parameters: { mode: 'fields', fields, includeOtherFields: false, value: undefined, onElementError: 'fail' }, input: rows, context });
    expect((output.value as unknown[])[999]).toEqual({ a: 1000, b: 1000, c: 1000, d: 1000, e: 1000 });
    // The evaluator's cache of compiled texts; private, read here only to count compilations.
    expect((evaluator as unknown as { compiled: Map<string, unknown> }).compiled.size).toBe(5);
  });

  it.each([
    [{ mode: 'rows' }, 'map-fields: parameter "mode" must be one of "fields", "value"'],
    [{ onElementError: 'retry' }, 'map-fields: parameter "onElementError" must be one of "fail", "skip"'],
    [{ fields: 'b' }, 'map-fields: parameter "fields" must be a list'],
    [{ fields: [{ name: 'x', type: 'date' }] }, 'map-fields: parameter "fields" row 1 has unknown type "date"'],
  ])('reports invalid configuration %j', async (parameters, message) => {
    expect((await run(parameters, [{}])).error).toBe(message);
  });
});
