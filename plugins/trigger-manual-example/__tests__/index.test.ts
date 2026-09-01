import { describe, expect, it } from 'vitest';
import { validateManifest } from '@runflux/plugin-system/manifest-validator';
import { execute, generators, manifest } from '../index';

describe('trigger-manual-example plugin', () => {
  it('exports a manifest that satisfies the PluginManifest contract', () => {
    const result = validateManifest(manifest);
    expect(result.success).toBe(true);
  });

  it('generates the expected artifact for the "local" platform with a custom label', () => {
    const artifact = generators.local({ label: 'hello' }, { workflowId: 'wf-1', nodeId: 'n1' });
    expect(artifact.files).toHaveLength(1);
    expect(artifact.files[0].content).toContain('"hello"');
  });

  it('falls back to the default label when none is provided', () => {
    const artifact = generators.local({}, { workflowId: 'wf-1', nodeId: 'n1' });
    expect(artifact.files[0].content).toContain('Manual run');
  });

  it('declares support only for the "local" platform', () => {
    expect(Object.keys(generators)).toEqual(['local']);
    expect(manifest.supportedPlatforms).toEqual(['local']);
  });

  it('execute() runs the trigger with a custom label (003-validation-runtime, D-05)', async () => {
    const result = (await execute!({ label: 'hello' }, undefined, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' })) as {
      label: string;
      triggeredAt: string;
    };
    expect(result.label).toBe('hello');
    expect(() => new Date(result.triggeredAt).toISOString()).not.toThrow();
  });

  it('execute() falls back to the default label when none is provided', async () => {
    const result = (await execute!({}, undefined, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' })) as { label: string };
    expect(result.label).toBe('Manual run');
  });
});
