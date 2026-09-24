import { defineNode, NodeOutput } from '../../contracts/node.js';
import { StaticNodeCatalog } from '../../engine/node-catalog.js';
import { WorkflowEngine } from '../../engine/workflow-engine.js';
import { ExecutableWorkflowBuilder } from '../../workflow/workflow-builder.js';
import type { HttpTrigger, ScheduleTrigger } from '../../workflow/triggers.js';

/** A trigger that echoes the payload it was started with, and a node that fails on demand. */
const catalog = new StaticNodeCatalog({
  trigger: defineNode({ parseParameters: () => ({}), createHandler: () => ({ execute: ({ input }) => NodeOutput.main(input) }) }),
  fail: defineNode({ parseParameters: () => ({}), createHandler: () => ({ execute: () => { throw new Error('node failed'); } }) }),
});

const builder = new ExecutableWorkflowBuilder((pluginId) => ({ category: pluginId === 'trigger' ? 'trigger' : 'action', parameters: [] }));

export function hostEngine(options: { http?: HttpTrigger[]; schedules?: ScheduleTrigger[]; failing?: string[] } = {}): WorkflowEngine {
  const triggerIds = [...new Set([...(options.http ?? []).map((trigger) => trigger.nodeId), ...(options.schedules ?? []).map((schedule) => schedule.nodeId), 'manual'])];
  return new WorkflowEngine(builder.build({
    id: 'hosted',
    name: 'Hosted workflow',
    nodes: [
      ...triggerIds.map((id) => ({ id, pluginId: 'trigger' })),
      ...(options.failing ?? []).map((id) => ({ id: `${id}-fails`, pluginId: 'fail' })),
    ],
    connections: (options.failing ?? []).map((id) => ({ sourceNodeId: id, targetNodeId: `${id}-fails` })),
  }, { http: options.http ?? [], schedules: options.schedules ?? [] }), catalog);
}

export function httpTrigger(nodeId: string, overrides: Partial<HttpTrigger> = {}): HttpTrigger {
  return { nodeId, path: `/${nodeId}`, method: 'POST', authentication: { type: 'none' }, rawBody: false, ...overrides };
}
