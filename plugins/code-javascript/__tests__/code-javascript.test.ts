import { validateManifest } from '@runflux/plugin-system/sdk';
import { executeNode } from '@runflux/runtime/testing';
import { describe, expect, it } from 'vitest';
import { manifest } from '../index';
import code from '../runtime';

const run = (source: unknown, input?: unknown, extra: Parameters<typeof executeNode>[1] = {}) =>
  executeNode(code, { parameters: { code: source }, literalParameters: ['code'], input, ...extra });

describe('code-javascript', () => {
  it('declares its source as a literal parameter', () => {
    expect(validateManifest(manifest).success).toBe(true);
    expect(manifest.parameters.find((parameter) => parameter.name === 'code')?.expressions).toBe(false);
  });

  it('runs async user code with $json, $node and $env', async () => {
    const record = await run('return { doubled: await Promise.resolve($json.count * 2), previous: $node.start.json.label, env: $env.TOKEN };', { count: 4 }, {
      nodes: { start: { label: 'Source' } },
      env: { TOKEN: 'secret' },
    });
    expect(record).toMatchObject({ error: null, output: { doubled: 8, previous: 'Source', env: 'secret' } });
  });

  it('reads missing nodes as { json: undefined } instead of throwing', async () => {
    expect((await run('return $node["absent"].json;')).output).toBeUndefined();
  });

  it('never interpolates {{ }} inside the source', async () => {
    expect((await run('return "{{ $json.secret }}";', { secret: 'leaked' })).output).toBe('{{ $json.secret }}');
  });

  it('returns its input by default', async () => {
    expect((await run(undefined, { id: 1 })).output).toEqual({ id: 1 });
    expect((await run('   ', { id: 2 })).output).toEqual({ id: 2 });
  });

  it.each([
    ['throw new Error("broken");', '[code-javascript]: Execution error: broken'],
    ['return $json.missing.field;', '[code-javascript]: Execution error: Cannot read properties of undefined'],
    ['return {', '[code-javascript]: Execution error: Unexpected'],
    ['throw "plain";', '[code-javascript]: Execution error: plain'],
  ])('reports failures of %j', async (source, message) => {
    expect((await run(source, {})).error).toContain(message);
  });
});
