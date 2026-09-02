import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateManifest } from '@runflux/plugin-system/manifest-validator';
import { describe, expect, it } from 'vitest';
import { execute, generators, manifest } from '../index';

async function runGenerated(nodeConfig: Record<string, unknown>, input: unknown) {
  const artifact = generators.local(nodeConfig, { workflowId: 'wf-1', nodeId: 'n1' });
  const dir = await mkdtemp(join(tmpdir(), 'runflux-condition-switch-'));
  const file = join(dir, artifact.files[0].path.replace(/\.ts$/, '.mjs'));
  await writeFile(file, artifact.files[0].content);
  const generated = (await import(file)) as { run: (json: unknown) => { value: unknown; activeOutput: string | null } };
  return generated.run(input);
}

describe('condition-switch plugin (004-core-nodes-catalog, RF-02, RN-01)', () => {
  it('exports a manifest that satisfies the PluginManifest contract and declares fixed rule-slot outputs plus fallback', () => {
    const result = validateManifest(manifest);
    expect(result.success).toBe(true);
    expect(manifest.category).toBe('control-flow');
    expect(manifest.outputs).toContain('fallback');
    expect(manifest.outputs!.length).toBeGreaterThan(1);
  });

  it('routes to the first matching rule (in declared order), by position', async () => {
    const params = {
      rules: [
        { combinator: 'and', conditions: [{ leftValue: 'x', operator: 'equals', rightValue: 'y' }] }, // rule 1: no match
        { combinator: 'and', conditions: [{ leftValue: 'a', operator: 'equals', rightValue: 'a' }] }, // rule 2: match
        { combinator: 'and', conditions: [{ leftValue: 'a', operator: 'equals', rightValue: 'a' }] }, // rule 3: would also match, ignored
      ],
      fallbackEnabled: false,
    };
    const result = (await execute!(params, {}, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' })) as { activeOutput: string | null };
    expect(result.activeOutput).toBe(manifest.outputs![1]);
  });

  it('routes to "fallback" when no rule matches and fallback is enabled', async () => {
    const params = {
      rules: [{ combinator: 'and', conditions: [{ leftValue: 'x', operator: 'equals', rightValue: 'y' }] }],
      fallbackEnabled: true,
    };
    const result = (await execute!(params, {}, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' })) as { activeOutput: string | null };
    expect(result.activeOutput).toBe('fallback');
  });

  it('activates nothing when no rule matches and fallback is disabled', async () => {
    const params = {
      rules: [{ combinator: 'and', conditions: [{ leftValue: 'x', operator: 'equals', rightValue: 'y' }] }],
      fallbackEnabled: false,
    };
    const result = (await execute!(params, {}, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' })) as { activeOutput: string | null };
    expect(result.activeOutput).toBeNull();
  });

  it('generators.local reaches the same decision as execute() for the same input (RF-12)', async () => {
    const nodeConfig = {
      rules: [{ combinator: 'and', conditions: [{ leftValue: '{{ $json.role }}', operator: 'equals', rightValue: 'admin' }] }],
      fallbackEnabled: true,
    };
    const generatedMatch = await runGenerated(nodeConfig, { role: 'admin' });
    expect(generatedMatch.activeOutput).toBe(manifest.outputs![0]);

    const generatedFallback = await runGenerated(nodeConfig, { role: 'guest' });
    expect(generatedFallback.activeOutput).toBe('fallback');
  });

  it('does not throw when "rules" is not an array (E001)', async () => {
    const params = { rules: { combinator: 'and', conditions: [] }, fallbackEnabled: true };
    const result = (await execute!(params, {}, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' })) as { activeOutput: string | null };
    expect(result.activeOutput).toBe('fallback'); // zero rules => none match => falls through to fallback
  });

  it('does not throw when a rule\'s own "conditions" is not an array (E001)', async () => {
    const params = { rules: [{ combinator: 'and', conditions: { leftValue: 'a', operator: 'equals', rightValue: 'a' } }], fallbackEnabled: false };
    const result = (await execute!(params, {}, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' })) as { activeOutput: string | null };
    expect(result.activeOutput).toBe(manifest.outputs![0]); // zero conditions in the rule => vacuously matches
  });
});
