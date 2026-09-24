import { PluginRegistry } from '@runflux/plugin-system/plugin-registry';
import type { PluginCategory } from '@runflux/plugin-system/types';
import { describe, expect, it } from 'vitest';
import { runNode, runWorkflow } from '../engine';
import type { WorkflowDefinition } from '@runflux/workflow-model/types';
import { behaviourPlugin } from './support';

const echoModePlugin = (id: string, category: PluginCategory = 'action') =>
  behaviourPlugin({ id, category }, (_parameters, _input, context) => ({ mode: context.mode, workflowId: context.workflowId, nodeId: context.nodeId }));

function workflow(): WorkflowDefinition {
  return {
    id: 'wf-mode',
    name: 'Mode propagation workflow',
    nodes: [{ id: 'n1', pluginId: 'echo', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } }],
    connections: [],
  };
}

describe('mode propagation (RF-08, RN-05)', () => {
  it('passes mode "sandbox" through runWorkflow into the executing plugin\'s context', async () => {
    const registry = new PluginRegistry();
    registry.register(echoModePlugin('echo', 'trigger'));

    const run = await runWorkflow(workflow(), registry, { mode: 'sandbox' });

    expect(run.nodeResults[0].output).toMatchObject({ mode: 'sandbox', workflowId: 'wf-mode', nodeId: 'n1' });
  });

  it('passes mode "production" through runWorkflow into the executing plugin\'s context', async () => {
    const registry = new PluginRegistry();
    registry.register(echoModePlugin('echo', 'trigger'));

    const run = await runWorkflow(workflow(), registry, { mode: 'production' });

    expect(run.nodeResults[0].output).toMatchObject({ mode: 'production' });
  });

  it('passes the same mode through runNode into the executing plugin\'s context', async () => {
    const registry = new PluginRegistry();
    registry.register(echoModePlugin('echo'));

    const result = await runNode(workflow(), 'n1', registry, { mode: 'production' });

    expect(result.output).toMatchObject({ mode: 'production' });
  });
});
