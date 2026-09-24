import { describe, expect, it } from 'vitest';
import { compileWorkflow } from '../../packages/compiler/src/compiler';
import type { WorkflowDefinition, WorkflowNode } from '@runflux/workflow-model';
import { loadPlugin, loadProject } from '../plugins/helpers';

export function node(id: string, pluginId: string, parameters: Record<string, unknown> = {}): WorkflowNode {
  return { id, pluginId, pluginVersion: '1.0.0', parameters, position: { x: 0, y: 0 } };
}
export function edge(sourceNodeId: string, targetNodeId: string, sourceOutput = 'main') {
  return { sourceNodeId, targetNodeId, sourceOutput, targetInput: 'main' };
}
export async function compile(workflow: WorkflowDefinition, targetPlatform: 'local' | 'aws' = 'local') {
  const modules = new Map(await Promise.all(workflow.nodes.map(async (n) => [n.pluginId, await loadPlugin(n.pluginId)] as const)));
  return compileWorkflow({ workflow, targetPlatform, projectName: 'Contract backend' }, (id) => modules.get(id));
}

describe('standalone backend execution', () => {
  it.each([
    { nodes: [node('same', 'set'), node('same', 'set')], connections: [] },
    { nodes: [node('a', 'set')], connections: [edge('missing', 'a')] },
    { nodes: [node('a', 'set'), node('b', 'set')], connections: [edge('a', 'b', 'invalid')] },
  ])('rejects malformed graph references', async (graph) => {
    expect(await compile({ id: 'invalid', name: 'Invalid', ...graph })).toMatchObject({ status: 'failed', error: { code: 'INVALID_WORKFLOW' } });
  });

  it('rejects cyclic graphs before generating a backend', async () => {
    const result = await compile({ id: 'cycle', name: 'Cycle', nodes: [node('a', 'set'), node('b', 'set')], connections: [edge('a', 'b'), edge('b', 'a')] });
    expect(result).toMatchObject({ status: 'failed', error: { code: 'CYCLE_DETECTED' } });
  });

  it.each(['local', 'aws'] as const)('waits for all active parents before executing a merge (%s)', async (platform) => {
    const workflow: WorkflowDefinition = {
      id: 'merge', name: 'Merge',
      nodes: [node('start', 'trigger-webhook'),
        node('slow', 'code-javascript', { code: 'await new Promise(resolve => setTimeout(resolve, 15)); return "slow";' }),
        node('fast', 'code-javascript', { code: 'return "fast";' }),
        node('merge', 'code-javascript', { code: 'return $json;' })],
      connections: [edge('start', 'slow'), edge('start', 'fast'), edge('slow', 'merge'), edge('fast', 'merge')],
    };
    const result = await compile(workflow, platform);
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(await loadProject(result.files).runWorkflow({ body: {} })).toMatchObject({ success: true, result: ['slow', 'fast'] });
  });

  it.each(['local', 'aws'] as const)('binds each repeated plugin to its own configuration regardless of canvas order (%s)', async (platform) => {
    const workflow: WorkflowDefinition = {
      id: 'binding', name: 'Binding',
      nodes: [node('last', 'set', { fields: [{ name: 'result', value: '{{ $json.count + 1 }}', type: 'number' }] }),
        node('start', 'trigger-webhook'),
        node('first', 'set', { fields: [{ name: 'count', value: '{{ $json.count * 2 }}', type: 'number' }] })],
      connections: [edge('start', 'first'), edge('first', 'last')],
    };
    const result = await compile(workflow, platform);
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    const execution = await loadProject(result.files).runWorkflow({ body: { count: 3 } });
    expect(execution).toMatchObject({ success: true, result: { result: 7 } });
  });
});
