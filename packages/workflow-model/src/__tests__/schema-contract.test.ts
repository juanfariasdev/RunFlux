import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import { runfluxEnvelopeSchema, workflowConnectionSchema, workflowDefinitionSchema, workflowNodeSchema } from '../schema';
import type { WorkflowConnection, WorkflowNode } from '../types';

describe('the workflow schemas', () => {
  it('validate into the model types of nodes and connections', () => {
    expectTypeOf<z.output<typeof workflowNodeSchema>>().toEqualTypeOf<WorkflowNode>();
    expectTypeOf<z.output<typeof workflowConnectionSchema>>().toEqualTypeOf<WorkflowConnection>();
  });

  it('fill the defaults a request may leave out', () => {
    expect(workflowDefinitionSchema.parse({
      nodes: [{ id: 'a', pluginId: 'set', position: { x: 0, y: 0 } }],
      connections: [{ sourceNodeId: 'a', targetNodeId: 'b' }],
    })).toEqual({
      nodes: [{ id: 'a', pluginId: 'set', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } }],
      connections: [{ sourceNodeId: 'a', sourceOutput: 'main', targetNodeId: 'b', targetInput: 'main' }],
    });
  });

  it('reject a project file with an invalid variable name, in the messages the editor shows', () => {
    const result = runfluxEnvelopeSchema.safeParse({ schemaVersion: 1, exportedAt: 'now', project: { name: 'P', envVars: [{ key: '1x' }] }, workflow: {} });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe('Nome da variável deve ser um identificador válido (ex: API_KEY)');
  });
});
