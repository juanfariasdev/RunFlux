import { expect, it } from 'vitest';
import { runNode, runWorkflow } from '@runflux/validation-runtime';
import { edge, editorRegistry, node, workflow } from '../support/workflows';

const definition = workflow(
  [node('start', 'trigger-manual-example', { label: 'Source' }, 'Start'), node('code', 'code-javascript', {
    code: 'return { byId: $node["start"].json.label, byLabel: $node.Start.json.label, literal: "{{ untouched }}" };',
  })],
  [edge('start', 'code')],
);

it('passes upstream outputs to user JavaScript by id and label without interpolating its source', async () => {
  const result = await runWorkflow(definition, await editorRegistry(), { mode: 'sandbox' });
  expect(result.nodeResults.find((node) => node.nodeId === 'code')).toMatchObject({ error: null, output: { byId: 'Source', byLabel: 'Source', literal: '{{ untouched }}' } });
});

it('tests one node with the cached output of the nodes tested before it', async () => {
  const cache = new Map([['start', { nodeId: 'start', input: undefined, output: { label: 'Cached' }, error: null, startedAt: 't', finishedAt: 't' }]]);
  expect(await runNode(definition, 'code', await editorRegistry(), { mode: 'sandbox' }, cache)).toMatchObject({ input: { label: 'Cached' }, output: { byId: 'Cached', byLabel: 'Cached' } });
});
