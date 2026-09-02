import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateManifest } from '@runflux/plugin-system/manifest-validator';
import { describe, expect, it } from 'vitest';
import { execute, generators, manifest } from '../index';

async function runGenerated(nodeConfig: Record<string, unknown>, input: unknown) {
  const artifact = generators.local(nodeConfig, { workflowId: 'wf-1', nodeId: 'n1' });
  const dir = await mkdtemp(join(tmpdir(), 'runflux-filter-'));
  const file = join(dir, artifact.files[0].path.replace(/\.ts$/, '.mjs'));
  await writeFile(file, artifact.files[0].content);
  const generated = (await import(file)) as { run: (json: unknown) => { value: unknown; activeOutput: string | null } };
  return generated.run(input);
}

describe('filter plugin (004-core-nodes-catalog, RF-03, RN-01, RN-02)', () => {
  it('exports a manifest that satisfies the PluginManifest contract and declares a single gated output', () => {
    const result = validateManifest(manifest);
    expect(result.success).toBe(true);
    expect(manifest.category).toBe('control-flow');
    expect(manifest.outputs).toEqual(['main']);
  });

  it('propagates the input unchanged through "main" when the condition is true', async () => {
    const params = { combinator: 'and', conditions: [{ leftValue: 'a', operator: 'equals', rightValue: 'a' }] };
    const input = { id: 1 };
    const result = (await execute!(params, input, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' })) as {
      value: unknown;
      activeOutput: string | null;
    };
    expect(result.activeOutput).toBe('main');
    expect(result.value).toBe(input);
  });

  it('returns activeOutput null when the condition is false, halting downstream propagation', async () => {
    const params = { combinator: 'and', conditions: [{ leftValue: 'a', operator: 'equals', rightValue: 'b' }] };
    const result = (await execute!(params, { id: 1 }, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' })) as { activeOutput: string | null };
    expect(result.activeOutput).toBeNull();
  });

  it('generators.local reaches the same decision as execute() for the same input (RF-12)', async () => {
    const nodeConfig = { combinator: 'and', conditions: [{ leftValue: '{{ $json.status }}', operator: 'equals', rightValue: 'ok' }] };
    const pass = await runGenerated(nodeConfig, { status: 'ok' });
    expect(pass.activeOutput).toBe('main');
    const blocked = await runGenerated(nodeConfig, { status: 'nope' });
    expect(blocked.activeOutput).toBeNull();
  });

  it('does not throw when "conditions" is not an array (E001)', async () => {
    const params = { combinator: 'and', conditions: { leftValue: 'a', operator: 'equals', rightValue: 'a' } };
    const result = (await execute!(params, { id: 1 }, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' })) as { activeOutput: string | null };
    expect(result.activeOutput).toBe('main'); // zero conditions => vacuously true, per combine()'s convention
  });
});
