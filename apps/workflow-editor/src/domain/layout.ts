import type { WorkflowConnection, WorkflowNode } from './types';

export type WorkflowLayout = 'horizontal' | 'vertical' | 'grid';

const DEFAULT_WIDTH = 220;
const DEFAULT_HEIGHT = 104;

/**
 * Small deterministic layout engine for the editor. DAG layouts use a
 * topological rank and center each rank around the origin; grid is useful for
 * disconnected drafts. Child nodes keep their positions inside subflows.
 */
export function layoutWorkflowNodes(
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
  layout: WorkflowLayout,
): WorkflowNode[] {
  const topLevel = nodes.filter((node) => !node.parentId);
  const children = nodes.filter((node) => node.parentId);

  if (layout === 'grid') {
    const columns = Math.max(1, Math.ceil(Math.sqrt(topLevel.length)));
    const placed = topLevel.map((node, index) => ({
      ...node,
      position: {
        x: (index % columns) * 320,
        y: Math.floor(index / columns) * 210,
      },
    }));
    return [...placed, ...children];
  }

  const topLevelIds = new Set(topLevel.map((node) => node.id));
  const incoming = new Map(topLevel.map((node) => [node.id, 0]));
  const outgoing = new Map(topLevel.map((node) => [node.id, [] as string[]]));

  for (const connection of connections) {
    if (!topLevelIds.has(connection.sourceNodeId) || !topLevelIds.has(connection.targetNodeId)) continue;
    outgoing.get(connection.sourceNodeId)?.push(connection.targetNodeId);
    incoming.set(connection.targetNodeId, (incoming.get(connection.targetNodeId) ?? 0) + 1);
  }

  const queue = topLevel.filter((node) => incoming.get(node.id) === 0).map((node) => node.id);
  const rank = new Map(queue.map((id) => [id, 0]));

  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    for (const targetId of outgoing.get(id) ?? []) {
      rank.set(targetId, Math.max(rank.get(targetId) ?? 0, (rank.get(id) ?? 0) + 1));
      const nextIncoming = (incoming.get(targetId) ?? 1) - 1;
      incoming.set(targetId, nextIncoming);
      if (nextIncoming === 0) queue.push(targetId);
    }
  }

  // Isolated or defensive cycle fallback: keep every node in the result.
  for (const node of topLevel) {
    if (!rank.has(node.id)) rank.set(node.id, 0);
  }

  const ranks = new Map<number, WorkflowNode[]>();
  for (const node of topLevel) {
    const nodeRank = rank.get(node.id) ?? 0;
    ranks.set(nodeRank, [...(ranks.get(nodeRank) ?? []), node]);
  }

  const placed = [...ranks.entries()].flatMap(([nodeRank, rankNodes]) =>
    rankNodes.map((node, index) => {
      const width = node.appearance?.width ?? DEFAULT_WIDTH;
      const height = node.appearance?.height ?? DEFAULT_HEIGHT;
      const crossGap = layout === 'horizontal' ? Math.max(height + 72, 176) : Math.max(width + 80, 300);
      const crossOffset = ((rankNodes.length - 1) * crossGap) / 2;

      return {
        ...node,
        position:
          layout === 'horizontal'
            ? { x: nodeRank * 360, y: index * crossGap - crossOffset }
            : { x: index * crossGap - crossOffset, y: nodeRank * 230 },
      };
    }),
  );

  return [...placed, ...children];
}
