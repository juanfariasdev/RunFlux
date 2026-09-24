import { describe, expect, it } from 'vitest';
import { runNode, type NodeResult } from '../engine';
import type { WorkflowDefinition } from '@runflux/workflow-model/types';
import { behaviourPlugin, registryWith, type TestBehaviour } from './support';

const plugin = (id: string, behaviour: TestBehaviour = () => undefined) => behaviourPlugin({ id }, behaviour);

function workflow(): WorkflowDefinition {
  return {
    id: 'wf-1',
    name: 'Test workflow',
    nodes: [
      { id: 'upstream', pluginId: 'trigger', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
      { id: 'target', pluginId: 'action', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
    ],
    connections: [{ sourceNodeId: 'upstream', sourceOutput: 'main', targetNodeId: 'target', targetInput: 'main' }],
  };
}

describe('runNode (RF-04)', () => {
  it('reuses the last known output of an already-tested upstream node (RN-03)', async () => {
    const registry = registryWith(
      plugin('trigger', () => 'irrelevant, upstream is not re-run'),
      plugin('action', (_params, input) => ({ received: input })),
    );
    const cache = new Map<string, NodeResult>([
      ['upstream', { nodeId: 'upstream', input: undefined, output: 'cached-output', error: null, startedAt: 't0', finishedAt: 't0' }],
    ]);

    const result = await runNode(workflow(), 'target', registry, { mode: 'sandbox' }, cache);

    expect(result.input).toBe('cached-output');
    expect(result.output).toEqual({ received: 'cached-output' });
  });

  it('runs with a null/mock input, without blocking, when the upstream node was never tested (RN-06)', async () => {
    const registry = registryWith(
      plugin('trigger'),
      plugin('action', (_params, input) => ({ received: input })),
    );

    const result = await runNode(workflow(), 'target', registry, { mode: 'sandbox' }); // no cache passed

    expect(result.error).toBeNull();
    expect(result.input).toBeNull();
    expect(result.output).toEqual({ received: null });
  });

  it('throws for a node id that does not exist in the workflow', async () => {
    const registry = registryWith(plugin('trigger'), plugin('action'));
    await expect(runNode(workflow(), 'ghost', registry, { mode: 'sandbox' })).rejects.toThrow(/unknown node/i);
  });
});
