import { PluginRegistry } from '@runflux/plugin-system/plugin-registry';
import type { DiscoveredPlugin, ExecutorFn } from '@runflux/plugin-system/types';
import { describe, expect, it } from 'vitest';
import { runWorkflow } from '../engine';
import type { WorkflowDefinition } from '@runflux/workflow-model/types';

function plugin(id: string, execute?: ExecutorFn): DiscoveredPlugin {
  return {
    manifest: { id, name: id, category: 'action', version: '1.0.0', parameters: [], supportedPlatforms: ['local'] },
    generators: { local: () => ({ files: [], infra: [] }) },
    execute,
    sourcePath: `/plugins/${id}`,
  };
}

function registryWith(...plugins: DiscoveredPlugin[]): PluginRegistry {
  const registry = new PluginRegistry();
  for (const p of plugins) registry.register(p);
  return registry;
}

function workflow(overrides: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return { id: 'wf-1', name: 'Test workflow', nodes: [], connections: [], ...overrides };
}

describe('runWorkflow (RF-01, RF-02)', () => {
  it('executes a linear two-node workflow and records input/output for each node', async () => {
    const registry = registryWith(
      plugin('trigger', () => ({ triggered: true })),
      plugin('action', (_params, input) => ({ received: input })),
    );
    const wf = workflow({
      nodes: [
        { id: 'n1', pluginId: 'trigger', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
        { id: 'n2', pluginId: 'action', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
      ],
      connections: [{ sourceNodeId: 'n1', sourceOutput: 'main', targetNodeId: 'n2', targetInput: 'main' }],
    });

    const run = await runWorkflow(wf, registry, { mode: 'sandbox' });

    expect(run.status).toBe('success');
    expect(run.nodeResults).toHaveLength(2);
    expect(run.nodeResults[0]).toMatchObject({ nodeId: 'n1', input: undefined, output: { triggered: true }, error: null });
    expect(run.nodeResults[1]).toMatchObject({ nodeId: 'n2', input: { triggered: true }, output: { received: { triggered: true } }, error: null });
  });

  it('marks the run "partial" and preserves the earlier successful result when a downstream node fails (RN-02)', async () => {
    const registry = registryWith(
      plugin('trigger', () => 'ok'),
      plugin('broken', () => {
        throw new Error('boom');
      }),
    );
    const wf = workflow({
      nodes: [
        { id: 'n1', pluginId: 'trigger', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
        { id: 'n2', pluginId: 'broken', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
      ],
      connections: [{ sourceNodeId: 'n1', sourceOutput: 'main', targetNodeId: 'n2', targetInput: 'main' }],
    });

    const run = await runWorkflow(wf, registry, { mode: 'sandbox' });

    expect(run.status).toBe('partial');
    const n1Result = run.nodeResults.find((r) => r.nodeId === 'n1');
    expect(n1Result).toMatchObject({ output: 'ok', error: null });
    const n2Result = run.nodeResults.find((r) => r.nodeId === 'n2');
    expect(n2Result?.error).toMatch(/boom/);
  });

  it('marks the run "error" when the very first node fails', async () => {
    const registry = registryWith(
      plugin('trigger', () => {
        throw new Error('cannot start');
      }),
    );
    const wf = workflow({
      nodes: [{ id: 'n1', pluginId: 'trigger', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } }],
    });

    const run = await runWorkflow(wf, registry, { mode: 'sandbox' });

    expect(run.status).toBe('error');
    expect(run.nodeResults).toHaveLength(1);
  });

  it('does not execute nodes downstream of a failed node (RN-02, propagation stops)', async () => {
    let downstreamCalled = false;
    const registry = registryWith(
      plugin('trigger', () => {
        throw new Error('boom');
      }),
      plugin('downstream', () => {
        downstreamCalled = true;
        return 'should not run';
      }),
    );
    const wf = workflow({
      nodes: [
        { id: 'n1', pluginId: 'trigger', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
        { id: 'n2', pluginId: 'downstream', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
      ],
      connections: [{ sourceNodeId: 'n1', sourceOutput: 'main', targetNodeId: 'n2', targetInput: 'main' }],
    });

    const run = await runWorkflow(wf, registry, { mode: 'sandbox' });

    expect(downstreamCalled).toBe(false);
    expect(run.nodeResults.map((r) => r.nodeId)).toEqual(['n1']);
  });

  it('records a clear error for a node whose plugin has no execute function, without throwing', async () => {
    const registry = registryWith(plugin('no-executor')); // no execute passed
    const wf = workflow({
      nodes: [{ id: 'n1', pluginId: 'no-executor', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } }],
    });

    const run = await runWorkflow(wf, registry, { mode: 'sandbox' });

    expect(run.status).toBe('error');
    expect(run.nodeResults[0].error).toMatch(/does not support local execution/i);
  });
});
