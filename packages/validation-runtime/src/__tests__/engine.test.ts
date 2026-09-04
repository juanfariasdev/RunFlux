import { PluginRegistry } from '@runflux/plugin-system/plugin-registry';
import type { DiscoveredPlugin, ExecutorFn } from '@runflux/plugin-system/types';
import { describe, expect, it } from 'vitest';
import { runWorkflow } from '../engine';
import type { WorkflowDefinition } from '@runflux/workflow-model/types';

function plugin(id: string, execute?: ExecutorFn, category: DiscoveredPlugin['manifest']['category'] = 'action'): DiscoveredPlugin {
  return {
    manifest: { id, name: id, category, version: '1.0.0', parameters: [], supportedPlatforms: ['local'] },
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
      plugin('trigger', () => ({ triggered: true }), 'trigger'),
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
      plugin('trigger', () => 'ok', 'trigger'),
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
      }, 'trigger'),
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
      }, 'trigger'),
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
    const registry = registryWith(plugin('no-executor', undefined, 'trigger')); // no execute passed
    const wf = workflow({
      nodes: [{ id: 'n1', pluginId: 'no-executor', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } }],
    });

    const run = await runWorkflow(wf, registry, { mode: 'sandbox' });

    expect(run.status).toBe('error');
    expect(run.nodeResults[0].error).toMatch(/does not support local execution/i);
  });

  it('never executes a node with no incoming connection unless it is an actual trigger (RN-07)', async () => {
    let orphanCalled = false;
    const registry = registryWith(
      plugin('trigger', () => 'ok', 'trigger'),
      plugin('orphan-action', () => {
        orphanCalled = true;
        return 'should not run';
      }), // category defaults to 'action' — no incoming connection, not a trigger either
    );
    const wf = workflow({
      nodes: [
        { id: 'n1', pluginId: 'trigger', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
        // Dropped on the canvas but never wired to anything — must not be treated as a second entry point.
        { id: 'n2', pluginId: 'orphan-action', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
      ],
    });

    const run = await runWorkflow(wf, registry, { mode: 'sandbox' });

    expect(orphanCalled).toBe(false);
    expect(run.nodeResults.map((r) => r.nodeId)).toEqual(['n1']);
  });

  // Before this, `runWorkflow` walked one global topological order with a single
  // sequential `for` loop — two independent triggers (e.g. two unrelated Webhook
  // Triggers, each waiting up to 120s for a real HTTP request) executed one after
  // the other, so the second one never even started listening until the first
  // resolved. Each node must wait only on its OWN upstream, not its turn in line.
  it('runs two independent triggers concurrently — a slow one never blocks an unrelated fast one from finishing (RN-08)', async () => {
    let resolveSlow!: (value: unknown) => void;
    let fastRan = false;
    const registry = registryWith(
      plugin('slow', () => new Promise((resolve) => { resolveSlow = resolve; }), 'trigger'),
      plugin('fast', () => {
        fastRan = true;
        return 'done';
      }, 'trigger'),
    );
    const wf = workflow({
      nodes: [
        { id: 'slow-node', pluginId: 'slow', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
        { id: 'fast-node', pluginId: 'fast', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
      ],
    });

    const runPromise = runWorkflow(wf, registry, { mode: 'sandbox' });

    // Let microtasks flush while `slow` is still deliberately unresolved.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fastRan).toBe(true);

    resolveSlow('unblocked');
    const run = await runPromise;

    expect(run.nodeResults.find((r) => r.nodeId === 'slow-node')).toMatchObject({ output: 'unblocked', error: null });
    expect(run.nodeResults.find((r) => r.nodeId === 'fast-node')).toMatchObject({ output: 'done', error: null });
  });

  // Concurrency alone isn't enough: with more than one trigger, the whole run must not
  // wait for every one of them to fire — the moment ANY trigger settles, every other
  // still-pending trigger gets `context.signal` fired so it can abandon its own wait
  // (trigger-webhook does exactly this) instead of the caller having to satisfy all of
  // them, or the run sitting there for up to that trigger's own timeout.
  it('races multiple triggers — the moment any one settles, every other still-waiting trigger is signalled to abandon its wait (RN-08)', async () => {
    const registry = registryWith(
      plugin('waits-for-signal', (_params, _input, context) => new Promise((_resolve, reject) => {
        context.signal?.addEventListener('abort', () => reject(new Error('Cancelled: superseded by another trigger')));
      }), 'trigger'),
      plugin('fires-immediately', () => 'fired', 'trigger'),
    );
    const wf = workflow({
      nodes: [
        { id: 'waiting-node', pluginId: 'waits-for-signal', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
        { id: 'immediate-node', pluginId: 'fires-immediately', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
      ],
    });

    const run = await runWorkflow(wf, registry, { mode: 'sandbox' });

    expect(run.nodeResults.find((r) => r.nodeId === 'immediate-node')).toMatchObject({ output: 'fired', error: null });
    expect(run.nodeResults.find((r) => r.nodeId === 'waiting-node')?.error).toMatch(/cancelled/i);
  });

  it('skips a whole island of action nodes that traces back to no trigger at all', async () => {
    let downstreamCalled = false;
    const registry = registryWith(
      plugin('orphan-action', () => 'root of nothing'),
      plugin('downstream', () => {
        downstreamCalled = true;
        return 'should not run';
      }),
    );
    const wf = workflow({
      nodes: [
        { id: 'n1', pluginId: 'orphan-action', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
        { id: 'n2', pluginId: 'downstream', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
      ],
      connections: [{ sourceNodeId: 'n1', sourceOutput: 'main', targetNodeId: 'n2', targetInput: 'main' }],
    });

    const run = await runWorkflow(wf, registry, { mode: 'sandbox' });

    expect(downstreamCalled).toBe(false);
    expect(run.nodeResults).toHaveLength(0);
    expect(run.status).toBe('success');
  });
});
