import { validateManifest } from '@runflux/plugin-system/manifest-validator';
import { describe, expect, it, vi } from 'vitest';
import { execute, generators, manifest } from '../index';

describe('log-output plugin (004-core-nodes-catalog, RF-05)', () => {
  it('exports a manifest that satisfies the PluginManifest contract (category output)', () => {
    const result = validateManifest(manifest);
    expect(result.success).toBe(true);
    expect(manifest.category).toBe('output');
  });

  it('returns the input unchanged, deterministically, without any network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const input = { anything: 'goes', nested: { a: 1 } };
    const result = await execute!({}, input, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' });

    expect(result).toEqual(input);
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('generators.local produces a file whose generated logic returns the same input unchanged (RF-12)', () => {
    const artifact = generators.local({}, { workflowId: 'wf-1', nodeId: 'n1' });
    expect(artifact.files).toHaveLength(1);
    expect(artifact.files[0].content).toContain('export function run');
  });
});
