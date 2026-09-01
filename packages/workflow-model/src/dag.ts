import type { WorkflowConnection } from './types';

/**
 * Checks whether adding a new `sourceNodeId -> targetNodeId` connection would
 * close a cycle in the workflow graph (002-workflow-editor RF-08, D-06). The
 * graph must remain a DAG at all times — loops are handled by a dedicated
 * Loop node (RF-09), not by a structural back-edge.
 *
 * Algorithm: a new edge source->target closes a cycle if and only if there is
 * already a path from target back to source. We do a BFS from `targetNodeId`
 * following existing connections and check whether `sourceNodeId` is reachable.
 */
export function wouldCreateCycle(
  connections: WorkflowConnection[],
  sourceNodeId: string,
  targetNodeId: string,
): boolean {
  if (sourceNodeId === targetNodeId) {
    return true; // a self-loop is trivially a cycle
  }

  const outgoing = new Map<string, string[]>();
  for (const connection of connections) {
    const list = outgoing.get(connection.sourceNodeId) ?? [];
    list.push(connection.targetNodeId);
    outgoing.set(connection.sourceNodeId, list);
  }

  const visited = new Set<string>([targetNodeId]);
  const queue: string[] = [targetNodeId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === sourceNodeId) {
      return true;
    }
    for (const next of outgoing.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  return false;
}
