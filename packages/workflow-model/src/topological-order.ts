import type { WorkflowConnection, WorkflowNode } from './types';

export class CyclicWorkflowError extends Error {
  constructor() {
    super('Cannot compute an execution order: the workflow graph contains a cycle');
    this.name = 'CyclicWorkflowError';
  }
}

/**
 * Computes a valid execution order for a workflow's nodes via Kahn's
 * algorithm (003-validation-runtime, D-06). 002-workflow-editor already
 * guarantees the graph is a DAG at edit time (`wouldCreateCycle`) — this is a
 * second, defensive layer: a residual cycle throws a clear error instead of
 * looping forever, in case that guarantee is ever violated elsewhere (e.g. a
 * hand-edited workflow file).
 */
export function getExecutionOrder(nodes: WorkflowNode[], connections: WorkflowConnection[]): WorkflowNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const inDegree = new Map<string, number>(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const connection of connections) {
    if (!byId.has(connection.sourceNodeId) || !byId.has(connection.targetNodeId)) {
      continue; // dangling reference to a node not in this workflow — not this function's concern
    }
    const list = outgoing.get(connection.sourceNodeId) ?? [];
    list.push(connection.targetNodeId);
    outgoing.set(connection.sourceNodeId, list);
    inDegree.set(connection.targetNodeId, (inDegree.get(connection.targetNodeId) ?? 0) + 1);
  }

  const queue = nodes.filter((node) => inDegree.get(node.id) === 0).map((node) => node.id);
  const order: WorkflowNode[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    order.push(byId.get(currentId)!);
    for (const nextId of outgoing.get(currentId) ?? []) {
      const remaining = (inDegree.get(nextId) ?? 0) - 1;
      inDegree.set(nextId, remaining);
      if (remaining === 0) {
        queue.push(nextId);
      }
    }
  }

  if (order.length !== nodes.length) {
    throw new CyclicWorkflowError();
  }

  return order;
}
