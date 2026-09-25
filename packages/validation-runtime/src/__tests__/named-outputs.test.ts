import type { PluginManifest } from '@runflux/plugin-system/sdk';
import { describe, expect, it } from 'vitest';
import { runWorkflow } from '../engine';
import type { WorkflowDefinition } from '@runflux/workflow-model/types';
import { behaviourPlugin, registryWith, type TestBehaviour } from './support';

const plugin = (id: string, manifest: Partial<PluginManifest>, behaviour: TestBehaviour) => behaviourPlugin({ id, ...manifest }, behaviour);

describe('named-output propagation (004-core-nodes-catalog, D-03, D-04, RN-02, RN-05, RF-07)', () => {
  it('propagates only through the output the executor activated, and skips the other named branch', async () => {
    const registry = registryWith(
      plugin('branch', { category: 'trigger', outputs: ['true', 'false'] }, () => ({ value: { decided: true }, activeOutput: 'true' })),
      plugin('on-true', {}, (_p, input) => ({ sawTrue: input })),
      plugin('on-false', {}, (_p, input) => ({ sawFalse: input })),
    );
    const wf: WorkflowDefinition = {
      id: 'wf-branch',
      name: 'Branch workflow',
      nodes: [
        { id: 'n1', pluginId: 'branch', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
        { id: 'n2', pluginId: 'on-true', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
        { id: 'n3', pluginId: 'on-false', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
      ],
      connections: [
        { sourceNodeId: 'n1', sourceOutput: 'true', targetNodeId: 'n2', targetInput: 'main' },
        { sourceNodeId: 'n1', sourceOutput: 'false', targetNodeId: 'n3', targetInput: 'main' },
      ],
    };

    const run = await runWorkflow(wf, registry, { mode: 'sandbox' });

    expect(run.nodeResults.find((r) => r.nodeId === 'n1')).toMatchObject({ output: { decided: true }, error: null });
    expect(run.nodeResults.find((r) => r.nodeId === 'n2')).toMatchObject({ output: { sawTrue: { decided: true } }, error: null });
    expect(run.nodeResults.find((r) => r.nodeId === 'n3')).toBeUndefined();
  });

  it('halts every downstream connection when activeOutput is null, without producing an error', async () => {
    const registry = registryWith(
      plugin('filter', { category: 'trigger', outputs: ['main'] }, () => ({ value: { data: 1 }, activeOutput: null })),
      plugin('downstream', {}, (_p, input) => ({ received: input })),
    );
    const wf: WorkflowDefinition = {
      id: 'wf-filter',
      name: 'Filter workflow',
      nodes: [
        { id: 'n1', pluginId: 'filter', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
        { id: 'n2', pluginId: 'downstream', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
      ],
      connections: [{ sourceNodeId: 'n1', sourceOutput: 'main', targetNodeId: 'n2', targetInput: 'main' }],
    };

    const run = await runWorkflow(wf, registry, { mode: 'sandbox' });

    expect(run.status).toBe('success');
    expect(run.nodeResults.map((r) => r.nodeId)).toEqual(['n1']);
  });

  it('still executes a node with one active and one inactive incoming connection (fan-in preserved)', async () => {
    const registry = registryWith(
      plugin('branch', { category: 'trigger', outputs: ['true', 'false'] }, () => ({ value: 'branch-a', activeOutput: 'true' })),
      plugin('other', { category: 'trigger' }, () => 'branch-b'),
      plugin('merge', {}, (_p, input) => ({ merged: input })),
    );
    const wf: WorkflowDefinition = {
      id: 'wf-fanin',
      name: 'Fan-in workflow',
      nodes: [
        { id: 'n1', pluginId: 'branch', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
        { id: 'n2', pluginId: 'other', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
        { id: 'n3', pluginId: 'merge', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
      ],
      connections: [
        { sourceNodeId: 'n1', sourceOutput: 'false', targetNodeId: 'n3', targetInput: 'main' },
        { sourceNodeId: 'n2', sourceOutput: 'main', targetNodeId: 'n3', targetInput: 'main' },
      ],
    };

    const run = await runWorkflow(wf, registry, { mode: 'sandbox' });

    const n3 = run.nodeResults.find((r) => r.nodeId === 'n3');
    expect(n3).toBeDefined();
    expect(n3?.error).toBeNull();
  });

  it('keeps the plain (unwrapped) executor result for a plugin without manifest.outputs (legacy behavior unchanged)', async () => {
    const registry = registryWith(plugin('legacy', { category: 'trigger' }, () => ({ raw: true })));
    const wf: WorkflowDefinition = {
      id: 'wf-legacy',
      name: 'Legacy workflow',
      nodes: [{ id: 'n1', pluginId: 'legacy', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } }],
      connections: [],
    };

    const run = await runWorkflow(wf, registry, { mode: 'sandbox' });

    expect(run.nodeResults[0]).toMatchObject({ output: { raw: true }, error: null });
  });
});
