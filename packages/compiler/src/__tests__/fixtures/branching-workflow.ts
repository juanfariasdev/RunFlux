import type { WorkflowDefinition } from '@runflux/workflow-model';

/**
 * Fixture de workflow com bifurcação condicional:
 * [Trigger] -> [Condition-If (score > 50)]
 *                 |-- (true)  -> [Set: status = 'APPROVED'] -> [Log: Approved]
 *                 |-- (false) -> [Set: status = 'REJECTED'] -> [Log: Rejected]
 */
export const branchingWorkflowFixture: WorkflowDefinition = {
  id: 'wf-branching-test',
  name: 'Branching Decision Workflow',
  nodes: [
    {
      id: 'node-trigger',
      pluginId: 'trigger-manual-example',
      pluginVersion: '1.0.0',
      parameters: {},
      position: { x: 0, y: 100 },
    },
    {
      id: 'node-if',
      pluginId: 'condition-if',
      pluginVersion: '1.0.0',
      parameters: {
        combinator: 'and',
        conditions: [
          {
            leftValue: '{{ $json.score }}',
            operator: 'greaterThan',
            rightValue: 50,
          },
        ],
      },
      position: { x: 200, y: 100 },
    },
    {
      id: 'node-set-approved',
      pluginId: 'set',
      pluginVersion: '1.0.0',
      parameters: {
        fields: [
          { name: 'decision', value: 'APPROVED', type: 'string' },
          { name: 'score', value: '{{ $json.score }}', type: 'number' },
        ],
      },
      position: { x: 400, y: 0 },
    },
    {
      id: 'node-set-rejected',
      pluginId: 'set',
      pluginVersion: '1.0.0',
      parameters: {
        fields: [
          { name: 'decision', value: 'REJECTED', type: 'string' },
          { name: 'score', value: '{{ $json.score }}', type: 'number' },
        ],
      },
      position: { x: 400, y: 200 },
    },
  ],
  connections: [
    {
      sourceNodeId: 'node-trigger',
      sourceOutput: 'main',
      targetNodeId: 'node-if',
      targetInput: 'main',
    },
    {
      sourceNodeId: 'node-if',
      sourceOutput: 'true',
      targetNodeId: 'node-set-approved',
      targetInput: 'main',
    },
    {
      sourceNodeId: 'node-if',
      sourceOutput: 'false',
      targetNodeId: 'node-set-rejected',
      targetInput: 'main',
    },
  ],
};
