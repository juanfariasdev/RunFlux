import { describe, expect, it } from 'vitest';
import { PluginRegistry } from '@runflux/plugin-system/plugin-registry';
import type { DiscoveredPlugin, ExecutorFn } from '@runflux/plugin-system/types';
import type { WorkflowDefinition } from '@runflux/workflow-model/types';
import { runWorkflow, runNode } from '../engine';

function plugin(
  id: string,
  execute?: ExecutorFn,
  category: DiscoveredPlugin['manifest']['category'] = 'action'
): DiscoveredPlugin {
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

describe('node-context-propagation: $node across workflow nodes (009-expression-global-context)', () => {
  it('propagates executed node outputs to downstream expressions via $node by label and by ID', async () => {
    let capturedParams: any = null;

    const registry = registryWith(
      plugin('trigger', () => ({ orderId: 'ord-123', customer: 'Alice' }), 'trigger'),
      plugin('transform', () => ({ processed: true })),
      plugin('notify', (params) => {
        capturedParams = params;
        return { sent: true };
      })
    );

    const wf: WorkflowDefinition = {
      id: 'wf-context-test',
      name: 'Context Propagation Test',
      nodes: [
        {
          id: 'n1',
          pluginId: 'trigger',
          pluginVersion: '1.0.0',
          parameters: {},
          position: { x: 0, y: 0 },
          appearance: { label: 'Webhook Trigger' },
        },
        {
          id: 'n2',
          pluginId: 'transform',
          pluginVersion: '1.0.0',
          parameters: {},
          position: { x: 100, y: 0 },
          appearance: { label: 'Transform Step' },
        },
        {
          id: 'n3',
          pluginId: 'notify',
          pluginVersion: '1.0.0',
          parameters: {
            recipient: "{{ $node['Webhook Trigger'].json.customer }}",
            orderRef: "{{ $node['n1'].json.orderId }}",
            wasProcessed: "{{ $node['Transform Step'].json.processed }}",
          },
          position: { x: 200, y: 0 },
          appearance: { label: 'Send Notification' },
        },
      ],
      connections: [
        { sourceNodeId: 'n1', sourceOutput: 'main', targetNodeId: 'n2', targetInput: 'main' },
        { sourceNodeId: 'n2', sourceOutput: 'main', targetNodeId: 'n3', targetInput: 'main' },
      ],
    };

    const run = await runWorkflow(wf, registry, { mode: 'sandbox' });

    expect(run.status).toBe('success');
    expect(capturedParams).toEqual({
      recipient: 'Alice',
      orderRef: 'ord-123',
      wasProcessed: true,
    });
  });

  it('provides $node context during single node execution (runNode) when cache contains results', async () => {
    let capturedParams: any = null;

    const registry = registryWith(
      plugin('notify', (params) => {
        capturedParams = params;
        return { ok: true };
      })
    );

    const wf: WorkflowDefinition = {
      id: 'wf-single-node',
      name: 'Single Node Test',
      nodes: [
        {
          id: 'upstream-node',
          pluginId: 'some-trigger',
          pluginVersion: '1.0.0',
          parameters: {},
          position: { x: 0, y: 0 },
          appearance: { label: 'Source Event' },
        },
        {
          id: 'target-node',
          pluginId: 'notify',
          pluginVersion: '1.0.0',
          parameters: {
            msg: "Hello {{ $node['Source Event'].json.user }}",
          },
          position: { x: 100, y: 0 },
          appearance: { label: 'Target Node' },
        },
      ],
      connections: [
        { sourceNodeId: 'upstream-node', sourceOutput: 'main', targetNodeId: 'target-node', targetInput: 'main' },
      ],
    };

    const cache = new Map();
    cache.set('upstream-node', {
      nodeId: 'upstream-node',
      input: undefined,
      output: { user: 'Bob' },
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
    });

    const result = await runNode(wf, 'target-node', registry, { mode: 'sandbox' }, cache);
    expect(result.error).toBeNull();
    expect(capturedParams).toEqual({
      msg: 'Hello Bob',
    });
  });
});
