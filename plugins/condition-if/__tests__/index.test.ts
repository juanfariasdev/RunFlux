import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateManifest } from '@runflux/plugin-system/manifest-validator';
import { describe, expect, it } from 'vitest';
import { execute, generators, manifest } from '../index';

async function runGenerated(nodeConfig: Record<string, unknown>, input: unknown) {
  const artifact = generators.local(nodeConfig, { workflowId: 'wf-1', nodeId: 'n1' });
  const dir = await mkdtemp(join(tmpdir(), 'runflux-condition-if-'));
  const file = join(dir, artifact.files[0].path.replace(/\.ts$/, '.mjs'));
  await writeFile(file, artifact.files[0].content);
  const generated = (await import(file)) as { run: (json: unknown) => { value: unknown; activeOutput: string | null } };
  return generated.run(input);
}

describe('condition-if plugin (004-core-nodes-catalog, RF-01, RN-01)', () => {
  it('exports a manifest that satisfies the PluginManifest contract and declares two outputs', () => {
    const result = validateManifest(manifest);
    expect(result.success).toBe(true);
    expect(manifest.category).toBe('control-flow');
    expect(manifest.outputs).toEqual(['true', 'false']);
  });

  const cases: Array<{ operator: string; left: unknown; right: unknown; expected: boolean }> = [
    { operator: 'equals', left: 'a', right: 'a', expected: true },
    { operator: 'equals', left: 'a', right: 'b', expected: false },
    { operator: 'notEquals', left: 'a', right: 'b', expected: true },
    { operator: 'contains', left: 'hello world', right: 'world', expected: true },
    { operator: 'greaterThan', left: 10, right: 5, expected: true },
    { operator: 'lessThan', left: 3, right: 5, expected: true },
    { operator: 'isEmpty', left: '', right: '', expected: true },
    { operator: 'isEmpty', left: 'x', right: '', expected: false },
  ];

  for (const { operator, left, right, expected } of cases) {
    it(`execute() resolves "${operator}" (${JSON.stringify(left)} vs ${JSON.stringify(right)}) to ${expected}`, async () => {
      const params = { combinator: 'and', conditions: [{ leftValue: left, operator, rightValue: right }] };
      const result = (await execute!(params, { some: 'data' }, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' })) as {
        value: unknown;
        activeOutput: string | null;
      };
      expect(result.activeOutput).toBe(expected ? 'true' : 'false');
      expect(result.value).toEqual({ some: 'data' });
    });
  }

  it('strictly separates types: "1" (string) is NOT equal to 1 (number)', async () => {
    const params = { combinator: 'and', conditions: [{ leftValue: '1', operator: 'equals', rightValue: 1 }] };
    const result = (await execute!(params, { test: true }, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' })) as {
      activeOutput: string | null;
    };
    expect(result.activeOutput).toBe('false');
  });

  it('combines multiple conditions with "and"', async () => {
    const params = {
      combinator: 'and',
      conditions: [
        { leftValue: 'a', operator: 'equals', rightValue: 'a' },
        { leftValue: 'b', operator: 'equals', rightValue: 'c' },
      ],
    };
    const result = (await execute!(params, {}, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' })) as { activeOutput: string | null };
    expect(result.activeOutput).toBe('false');
  });

  it('combines multiple conditions with "or"', async () => {
    const params = {
      combinator: 'or',
      conditions: [
        { leftValue: 'a', operator: 'equals', rightValue: 'z' },
        { leftValue: 'b', operator: 'equals', rightValue: 'b' },
      ],
    };
    const result = (await execute!(params, {}, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' })) as { activeOutput: string | null };
    expect(result.activeOutput).toBe('true');
  });

  it('generators.local reaches the same decision as execute() for the same input (RF-12)', async () => {
    const nodeConfig = { combinator: 'and', conditions: [{ leftValue: '{{ $json.status }}', operator: 'equals', rightValue: 'ok' }] };
    const executed = (await execute!(
      { combinator: 'and', conditions: [{ leftValue: 'ok', operator: 'equals', rightValue: 'ok' }] },
      { status: 'ok' },
      { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' },
    )) as { activeOutput: string | null };
    const generated = await runGenerated(nodeConfig, { status: 'ok' });
    expect(generated.activeOutput).toBe(executed.activeOutput);
    expect(generated.activeOutput).toBe('true');
  });

  it('generators.local resolves the "false" branch for non-matching input', async () => {
    const nodeConfig = { combinator: 'and', conditions: [{ leftValue: '{{ $json.status }}', operator: 'equals', rightValue: 'ok' }] };
    const generated = await runGenerated(nodeConfig, { status: 'nope' });
    expect(generated.activeOutput).toBe('false');
  });

  it('does not throw when "conditions" is not an array (E001)', async () => {
    const params = { combinator: 'and', conditions: { leftValue: 'a', operator: 'equals', rightValue: 'a' } };
    const result = (await execute!(params, {}, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' })) as { activeOutput: string | null };
    expect(result.activeOutput).toBe('true'); // zero conditions => vacuously true, per combine()'s convention
  });
});
