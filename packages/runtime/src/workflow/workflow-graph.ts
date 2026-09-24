import type { ExecutableConnection, ExecutableNode, ExecutableWorkflow } from './executable-workflow.js';

export class CyclicWorkflowError extends Error {
  constructor() {
    super('Cannot compute an execution order: the workflow graph contains a cycle');
    this.name = 'CyclicWorkflowError';
  }
}

export class UnknownNodeError extends Error {
  constructor(nodeId: string, workflowId: string) {
    super(`Unknown node "${nodeId}" in workflow "${workflowId}"`);
    this.name = 'UnknownNodeError';
  }
}

export class NotATriggerError extends Error {
  constructor(nodeId: string) {
    super(`Node "${nodeId}" is not a trigger`);
    this.name = 'NotATriggerError';
  }
}

/** Indexed, acyclic view of a workflow's nodes and connections. */
export class WorkflowGraph {
  private readonly byId = new Map<string, ExecutableNode>();
  private readonly incomingById = new Map<string, ExecutableConnection[]>();
  private readonly outgoingById = new Map<string, ExecutableConnection[]>();
  private readonly ancestorsById = new Map<string, ReadonlySet<string>>();

  readonly workflow: ExecutableWorkflow;

  constructor(workflow: ExecutableWorkflow) {
    this.workflow = workflow;
    for (const node of workflow.nodes) this.byId.set(node.id, node);
    for (const connection of workflow.connections) {
      if (!this.byId.has(connection.source) || !this.byId.has(connection.target)) continue;
      append(this.incomingById, connection.target, connection);
      append(this.outgoingById, connection.source, connection);
    }
    this.assertAcyclic();
  }

  get nodes(): readonly ExecutableNode[] {
    return this.workflow.nodes;
  }

  node(id: string): ExecutableNode {
    const node = this.byId.get(id);
    if (!node) throw new UnknownNodeError(id, this.workflow.id);
    return node;
  }

  incoming(id: string): readonly ExecutableConnection[] {
    return this.incomingById.get(id) ?? [];
  }

  outgoing(id: string): readonly ExecutableConnection[] {
    return this.outgoingById.get(id) ?? [];
  }

  /** Trigger nodes, or only `triggerId` when given (which must be a trigger). */
  triggers(triggerId?: string): ExecutableNode[] {
    if (triggerId === undefined) return this.workflow.nodes.filter((node) => node.trigger);
    const trigger = this.node(triggerId);
    if (!trigger.trigger) throw new NotATriggerError(triggerId);
    return [trigger];
  }

  /** Every node reachable from `startIds` through connections, including the start nodes. */
  reachableFrom(startIds: Iterable<string>): Set<string> {
    const reachable = new Set(startIds);
    const queue = [...reachable];
    for (let index = 0; index < queue.length; index++) {
      for (const connection of this.outgoing(queue[index])) {
        if (!reachable.has(connection.target)) {
          reachable.add(connection.target);
          queue.push(connection.target);
        }
      }
    }
    return reachable;
  }

  /** Every node with a path to `id`: the only nodes whose outputs `id` can depend on. */
  ancestors(id: string): ReadonlySet<string> {
    let ancestors = this.ancestorsById.get(id);
    if (!ancestors) {
      const found = new Set<string>();
      for (const connection of this.incoming(id)) {
        found.add(connection.source);
        for (const ancestor of this.ancestors(connection.source)) found.add(ancestor);
      }
      ancestors = found;
      this.ancestorsById.set(id, ancestors);
    }
    return ancestors;
  }

  private assertAcyclic(): void {
    const inDegree = new Map(this.workflow.nodes.map((node) => [node.id, this.incoming(node.id).length]));
    const queue = [...inDegree].filter(([, degree]) => degree === 0).map(([id]) => id);
    for (let index = 0; index < queue.length; index++) {
      for (const connection of this.outgoing(queue[index])) {
        const remaining = inDegree.get(connection.target)! - 1;
        inDegree.set(connection.target, remaining);
        if (remaining === 0) queue.push(connection.target);
      }
    }
    if (queue.length !== inDegree.size) throw new CyclicWorkflowError();
  }
}

function append<TValue>(map: Map<string, TValue[]>, key: string, value: TValue): void {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}
