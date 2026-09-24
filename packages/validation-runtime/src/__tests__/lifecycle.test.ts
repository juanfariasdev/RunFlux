import { describe, expect, it, vi } from 'vitest';
import { testPlugin } from '@runflux/plugin-system/testing';
import { defineNode, NodeOutput } from '@runflux/runtime';
import type { WorkflowDefinition } from '@runflux/workflow-model/types';
import { runNode, runWorkflow, type NodeResult } from '../engine';
import { behaviourPlugin, registryWith } from './support';

function workflow(): WorkflowDefinition {
  return {
    id: 'wf-1',
    name: 'Test workflow',
    nodes: [
      { id: 'hook', pluginId: 'trigger', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
      { id: 'work', pluginId: 'action', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } },
    ],
    connections: [{ sourceNodeId: 'hook', sourceOutput: 'main', targetNodeId: 'work', targetInput: 'main' }],
  };
}

/** An action whose handler holds a resource, and that waits for its run to be cancelled when asked to. */
function resourceAction(options: { waitForCancel?: boolean; fail?: boolean } = {}) {
  const dispose = vi.fn(async () => {});
  const plugin = testPlugin({ id: 'action' }, defineNode({
    parseParameters: () => ({}),
    createHandler: () => ({
      execute: ({ input, context }) => {
        if (options.fail) throw new Error('action failed');
        if (!options.waitForCancel) return NodeOutput.main({ received: input });
        return new Promise<NodeOutput>((resolve) => context.signal.addEventListener('abort', () => resolve(NodeOutput.main('cancelled'))));
      },
      dispose,
    }),
  }));
  return { plugin, dispose };
}

const trigger = behaviourPlugin({ id: 'trigger', category: 'trigger' }, () => 'payload');

describe('validation runs release what their nodes hold', () => {
  it('disposes the handlers after a workflow run, also when a node failed', async () => {
    for (const fail of [false, true]) {
      const action = resourceAction({ fail });
      const run = await runWorkflow(workflow(), registryWith(trigger, action.plugin), { mode: 'sandbox' });
      expect(run).toMatchObject({ status: fail ? 'partial' : 'success', cancelled: false });
      expect(action.dispose).toHaveBeenCalledOnce();
    }
  });

  it('disposes the handlers after a single-node run, also when the node does not exist', async () => {
    const action = resourceAction();
    await runNode(workflow(), 'work', registryWith(trigger, action.plugin), { mode: 'sandbox' });
    expect(action.dispose).toHaveBeenCalledOnce();
    await expect(runNode(workflow(), 'ghost', registryWith(trigger, action.plugin), { mode: 'sandbox' })).rejects.toThrow(/unknown node/i);
  });
});

describe('validation runs can be cancelled', () => {
  it('passes the signal to the running nodes of a workflow run', async () => {
    const action = resourceAction({ waitForCancel: true });
    const controller = new AbortController();
    const running = runWorkflow(workflow(), registryWith(trigger, action.plugin), { mode: 'sandbox', signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    const run = await running;
    expect(run.nodeResults.find((result) => result.nodeId === 'work')?.output).toBe('cancelled');
    expect(run.cancelled).toBe(true);
  });

  it('passes the signal to a single-node run', async () => {
    const action = resourceAction({ waitForCancel: true });
    const controller = new AbortController();
    const running = runNode(workflow(), 'work', registryWith(trigger, action.plugin), { mode: 'sandbox', signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    expect((await running).output).toBe('cancelled');
  });

  it('ignores cached results that failed', async () => {
    const action = resourceAction();
    const cache = new Map<string, NodeResult>([['hook', { nodeId: 'hook', input: undefined, output: null, error: 'boom', startedAt: 't0', finishedAt: 't0' }]]);
    const result = await runNode(workflow(), 'work', registryWith(trigger, action.plugin), { mode: 'sandbox' }, cache);
    expect(result.input).toBeNull();
  });
});
