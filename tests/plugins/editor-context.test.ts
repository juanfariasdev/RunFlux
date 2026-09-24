import { expect, it } from 'vitest';
import { PluginRegistry } from '@runflux/plugin-system/plugin-registry';
import { runWorkflow } from '../../packages/validation-runtime/src/engine';
import { loadPlugin } from './helpers';

it('passes upstream node context to user JavaScript without interpolating its source code', async () => {
  const registry = new PluginRegistry();
  for (const id of ['trigger-manual-example', 'code-javascript']) registry.register({ ...await loadPlugin(id), sourcePath: id });
  const result = await runWorkflow({
    id: 'context', name: 'Context', nodes: [
      { id: 'start', pluginId: 'trigger-manual-example', pluginVersion: '1.0.0', parameters: { label: 'Source' }, position: { x: 0, y: 0 } },
      { id: 'code', pluginId: 'code-javascript', pluginVersion: '1.0.0', parameters: {
        code: 'return { label: $node["start"].json.label, literal: "{{ untouched }}" };',
      }, position: { x: 0, y: 0 } },
    ], connections: [{ sourceNodeId: 'start', sourceOutput: 'main', targetNodeId: 'code', targetInput: 'main' }],
  }, registry, { mode: 'sandbox' });
  expect(result.nodeResults.find((result) => result.nodeId === 'code')).toMatchObject({ error: null, output: { label: 'Source', literal: '{{ untouched }}' } });
});
