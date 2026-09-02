import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateManifest } from '@runflux/plugin-system/manifest-validator';
import { describe, expect, it } from 'vitest';
import { execute, generators, manifest } from '../index';

async function runGenerated(nodeConfig: Record<string, unknown>, input: unknown) {
  const artifact = generators.local(nodeConfig, { workflowId: 'wf-1', nodeId: 'n1' });
  const dir = await mkdtemp(join(tmpdir(), 'runflux-set-'));
  const file = join(dir, artifact.files[0].path.replace(/\.ts$/, '.mjs'));
  await writeFile(file, artifact.files[0].content);
  const generated = (await import(file)) as { run: (json: unknown) => unknown };
  return generated.run(input);
}

describe('set plugin (004-core-nodes-catalog, RF-11)', () => {
  it('exports a manifest that satisfies the PluginManifest contract (action, legacy single output)', () => {
    const result = validateManifest(manifest);
    expect(result.success).toBe(true);
    expect(manifest.category).toBe('action');
    expect(manifest.outputs).toBeUndefined();
  });

  it('composes a literal field and an already-resolved expression field (engine resolves {{ }} before execute())', async () => {
    const params = {
      fields: [
        { name: 'status', value: 'active' },
        { name: 'userId', value: 42 }, // stands in for a resolved "{{ $json.id }}"
      ],
      includeOtherFields: false,
    };
    const result = await execute!(params, { id: 42, secret: 'hidden' }, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' });
    expect(result).toEqual({ status: 'active', userId: 42 });
  });

  it('keeps the other input fields when includeOtherFields is true', async () => {
    const params = { fields: [{ name: 'status', value: 'active' }], includeOtherFields: true };
    const result = await execute!(params, { id: 42, other: 'kept' }, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' });
    expect(result).toEqual({ id: 42, other: 'kept', status: 'active' });
  });

  it('discards the other input fields when includeOtherFields is false', async () => {
    const params = { fields: [{ name: 'status', value: 'active' }], includeOtherFields: false };
    const result = await execute!(params, { id: 42, other: 'dropped' }, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' });
    expect(result).toEqual({ status: 'active' });
  });

  it('generators.local reaches the same result as execute() for the same input, resolving {{ }} itself (RF-12)', async () => {
    const nodeConfig = { fields: [{ name: 'status', value: '{{ $json.label }}' }], includeOtherFields: false };
    const generated = await runGenerated(nodeConfig, { label: 'ready' });
    expect(generated).toEqual({ status: 'ready' });
  });

  it('does not throw when "fields" is not an array (E001: malformed JSON typed by the user, e.g. an object instead of a list)', async () => {
    const params = { fields: { name: 'status', value: 'active' }, includeOtherFields: false };
    const result = await execute!(params, {}, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' });
    expect(result).toEqual({});
  });

  it('generators.local does not throw when "fields" is not an array either (E001)', async () => {
    const generated = await runGenerated({ fields: { name: 'status', value: 'active' } }, {});
    expect(generated).toEqual({});
  });
});
