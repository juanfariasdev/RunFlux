import { defineNode, NodeOutput, type NodeDefinition } from '../../contracts/node.js';
import { ExecutableWorkflowBuilder, type NodeTypeDescription, type WorkflowSource } from '../../workflow/workflow-builder.js';
import type { ExecutableWorkflow } from '../../workflow/executable-workflow.js';
import { NO_TRIGGERS, type WorkflowTriggers } from '../../workflow/triggers.js';

/** Node types used by the engine and host tests. */
export const definitions = {
  /** Trigger that emits its input, or its `value` parameter when given. */
  start: defineNode({
    parseParameters: (parameters) => ({ value: parameters.raw('value') }),
    createHandler: () => ({ execute: ({ parameters, input }) => NodeOutput.main(parameters.value ?? input) }),
  }),
  /** Trigger that waits until its run no longer needs it. */
  waiting: defineNode({
    parseParameters: () => ({}),
    createHandler: () => ({
      execute: ({ context }) => new Promise<NodeOutput>((_resolve, reject) => {
        context.signal.addEventListener('abort', () => reject(new Error('Cancelled: another trigger fired')));
      }),
    }),
  }),
  /** Emits its `value` parameter, or its input. */
  emit: defineNode({
    parseParameters: (parameters) => ({ value: parameters.raw('value'), delay: Number(parameters.raw('delay') ?? 0) }),
    createHandler: () => ({
      execute: async ({ parameters, input }) => {
        if (parameters.delay) await new Promise((resolve) => setTimeout(resolve, parameters.delay));
        return NodeOutput.main(parameters.value === undefined ? input : parameters.value);
      },
    }),
  }),
  /** Routes its input to `true` or `false`, or ends the branch for `halt`. */
  branch: defineNode({
    parseParameters: (parameters) => ({ take: parameters.choice('take', ['true', 'false', 'halt'], 'true') }),
    createHandler: () => ({ execute: ({ parameters, input }) => NodeOutput.route(input, parameters.take === 'halt' ? null : parameters.take) }),
  }),
  /** Always fails with its `message` parameter. */
  fail: defineNode({
    parseParameters: (parameters) => ({ message: parameters.string('message', 'boom') }),
    createHandler: () => ({ execute: ({ parameters }) => { throw new Error(parameters.message); } }),
  }),
  /** Returns what the engine passed in, for assertions. */
  inspect: defineNode({
    parseParameters: (parameters) => ({ expression: parameters.raw('expression'), literal: parameters.raw('literal') }),
    createHandler: () => ({
      execute: ({ parameters, input, context }) => NodeOutput.main({
        parameters, input, mode: context.mode, nodeId: context.nodeId, workflowId: context.workflowId, env: context.env.RUNFLUX_TEST,
        previous: context.nodes.first.json, labelled: context.nodes.First.json, missing: context.nodes.missing.json,
      }),
    }),
  }),
} satisfies Record<string, NodeDefinition<any>>;

const types: Record<string, NodeTypeDescription> = {
  start: { category: 'trigger', parameters: [] },
  waiting: { category: 'trigger', parameters: [] },
  emit: { category: 'action', parameters: [] },
  branch: { category: 'control-flow', outputs: ['true', 'false'], parameters: [] },
  fail: { category: 'action', parameters: [] },
  inspect: { category: 'action', parameters: [{ name: 'literal', expressions: false }] },
};

type NodeSpec = { id: string; pluginId: string; parameters?: Record<string, unknown>; label?: string };

export function workflow(nodes: NodeSpec[], connections: Array<[string, string, string?]>, triggers: WorkflowTriggers = NO_TRIGGERS): ExecutableWorkflow {
  const source: WorkflowSource = {
    id: 'test',
    name: 'Test',
    nodes: nodes.map((node) => ({ id: node.id, pluginId: node.pluginId, parameters: node.parameters, appearance: { label: node.label } })),
    connections: connections.map(([sourceNodeId, targetNodeId, sourceOutput]) => ({ sourceNodeId, targetNodeId, sourceOutput })),
  };
  return new ExecutableWorkflowBuilder((pluginId) => types[pluginId]).build(source, triggers);
}
