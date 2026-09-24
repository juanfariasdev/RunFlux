import type { WorkflowConnection, WorkflowNode } from '@runflux/workflow-model/types';

export type WorkflowLayout = 'horizontal' | 'vertical' | 'grid';

const FLOW_GAP = 80;
const SIBLING_GAP = 48;

function dimensions(node: WorkflowNode) {
  const subflow = node.appearance?.shape === 'subflow';
  return {
    width: node.appearance?.width ?? (subflow ? 520 : 220),
    height: node.appearance?.height ?? (subflow ? 300 : 104),
  };
}

interface LayoutNode {
  node: WorkflowNode;
  rank: number;
  order: number;
  center: number;
  size: number;
  span: number;
  depth: number;
  previous: LayoutNode[];
  next: LayoutNode[];
}

function crossingsBefore(first: LayoutNode, second: LayoutNode) {
  let crossings = 0;
  for (const direction of ['previous', 'next'] as const) {
    for (const a of first[direction]) {
      for (const b of second[direction]) {
        if (a.center > b.center) crossings += 1;
      }
    }
  }
  return crossings;
}

function reduceCrossings(layers: LayoutNode[][]) {
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    const movable = layers.slice(1);
    if (pass % 2 === 1) movable.reverse();
    for (const layer of movable) {
      for (let sweep = 0; sweep < layer.length; sweep += 1) {
        let swapped = false;
        for (let index = 0; index < layer.length - 1; index += 1) {
          const first = layer[index];
          const second = layer[index + 1];
          if (crossingsBefore(first, second) <= crossingsBefore(second, first)) continue;
          layer[index] = second;
          layer[index + 1] = first;
          second.order = index;
          first.order = index + 1;
          swapped = true;
          changed = true;
        }
        if (!swapped) break;
      }
    }
    if (!changed) break;
  }
}

/** Compact a layer around the connected nodes while preventing overlap. */
function alignLayer(layer: LayoutNode[], neighbors: (item: LayoutNode) => LayoutNode[]) {
  const offsets: number[] = [];
  const blocks: { start: number; end: number; sum: number; count: number }[] = [];
  for (let index = 0; index < layer.length; index += 1) {
    const item = layer[index];
    const adjacent = neighbors(item);
    const desired = adjacent.length
      ? adjacent.reduce((sum, neighbor) => sum + neighbor.center, 0) / adjacent.length
      : item.center;
    offsets[index] = index === 0 ? 0 : offsets[index - 1] + (layer[index - 1].span + item.span) / 2 + SIBLING_GAP;
    blocks.push({ start: index, end: index, sum: desired - offsets[index], count: 1 });
    while (blocks.length > 1) {
      const right = blocks[blocks.length - 1];
      const left = blocks[blocks.length - 2];
      if (left.sum / left.count <= right.sum / right.count) break;
      left.end = right.end;
      left.sum += right.sum;
      left.count += right.count;
      blocks.pop();
    }
  }
  for (const block of blocks) {
    for (let index = block.start; index <= block.end; index += 1) {
      layer[index].center = block.sum / block.count + offsets[index];
    }
  }
}

function gridPositions(nodes: WorkflowNode[]) {
  const ordered = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const columns = Math.ceil(Math.sqrt(ordered.length));
  const widths = Array<number>(columns).fill(0);
  const heights = Array<number>(Math.ceil(ordered.length / columns)).fill(0);
  ordered.forEach((node, index) => {
    const { width, height } = dimensions(node);
    widths[index % columns] = Math.max(widths[index % columns], width);
    heights[Math.floor(index / columns)] = Math.max(heights[Math.floor(index / columns)], height);
  });
  const xOffsets = [Math.min(...nodes.map((node) => node.position.x))];
  const yOffsets = [Math.min(...nodes.map((node) => node.position.y))];
  for (let index = 1; index < widths.length; index += 1) xOffsets[index] = xOffsets[index - 1] + widths[index - 1] + FLOW_GAP;
  for (let index = 1; index < heights.length; index += 1) yOffsets[index] = yOffsets[index - 1] + heights[index - 1] + SIBLING_GAP;
  return new Map(ordered.map((node, index) => [node.id, { x: xOffsets[index % columns], y: yOffsets[Math.floor(index / columns)] }]));
}

/**
 * Arrange connected nodes in compact layers, using their current visual order
 * as the starting point. Only crossing-reducing swaps may change that order.
 * Child nodes keep their relative position inside their subflow.
 */
export function layoutWorkflowNodes(
  nodes: WorkflowNode[],
  connections: WorkflowConnection[],
  layout: WorkflowLayout,
): WorkflowNode[] {
  const topLevel = nodes.filter((node) => !node.parentId);
  if (!topLevel.length) return nodes;
  const applyPositions = (positions: Map<string, WorkflowNode['position']>) => nodes.map((node) => {
    const position = positions.get(node.id);
    return position ? { ...node, position } : node;
  });
  if (layout === 'grid') return applyPositions(gridPositions(topLevel));

  const main = layout === 'horizontal' ? 'x' : 'y';
  const cross = layout === 'horizontal' ? 'y' : 'x';
  const graph = new Map<string, LayoutNode>(topLevel.map((node) => {
    const { width, height } = dimensions(node);
    const size = layout === 'horizontal' ? height : width;
    return [node.id, {
      node, rank: 0, order: 0, center: node.position[cross] + size / 2,
      size, span: size, depth: layout === 'horizontal' ? width : height, previous: [], next: [],
    }];
  }));
  for (const connection of connections) {
    const source = graph.get(connection.sourceNodeId);
    const target = graph.get(connection.targetNodeId);
    if (!source || !target || source === target || source.next.includes(target)) continue;
    source.next.push(target);
    target.previous.push(source);
  }

  const incoming = new Map([...graph.values()].map((item) => [item, item.previous.length]));
  const queue = [...graph.values()].filter((item) => item.previous.length === 0);
  const visited = new Set<LayoutNode>();
  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    visited.add(item);
    for (const target of item.next) {
      target.rank = Math.max(target.rank, item.rank + 1);
      const remaining = incoming.get(target)! - 1;
      incoming.set(target, remaining);
      if (remaining === 0) queue.push(target);
    }
  }
  // Keep nodes from cyclic drafts visible without allowing a cycle to reorder them.
  for (const item of graph.values()) if (!visited.has(item)) item.rank = 0;
  for (const item of graph.values()) {
    item.previous = item.previous.filter((neighbor) => neighbor.rank < item.rank);
    item.next = item.next.filter((neighbor) => neighbor.rank > item.rank);
  }

  const layers: LayoutNode[][] = [];
  for (const item of graph.values()) (layers[item.rank] ??= []).push(item);
  for (const layer of layers) {
    layer.sort((a, b) => a.node.position[cross] - b.node.position[cross] || a.node.position[main] - b.node.position[main]);
    layer.forEach((item, index) => { item.order = index; });
  }
  // Reserve enough cross-axis space for each complete downstream branch.
  for (let rank = layers.length - 1; rank >= 0; rank -= 1) {
    for (const item of layers[rank]) {
      const childSpan = item.next.reduce((sum, child) => sum + child.span, SIBLING_GAP * Math.max(0, item.next.length - 1));
      item.span = Math.max(item.size, childSpan);
    }
  }
  reduceCrossings(layers);

  const roots = layers[0];
  for (let index = 1; index < roots.length; index += 1) {
    roots[index].center = roots[index - 1].center + (roots[index - 1].span + roots[index].span) / 2 + SIBLING_GAP;
  }
  for (const layer of layers.slice(1)) alignLayer(layer, (item) => item.previous);
  for (let pass = 0; pass < 4; pass += 1) {
    for (let rank = layers.length - 2; rank > 0; rank -= 1) {
      alignLayer(layers[rank], (item) => [...item.previous, ...item.next]);
    }
    for (const layer of layers.slice(1)) alignLayer(layer, (item) => item.previous);
  }

  const positions = new Map<string, WorkflowNode['position']>();
  let offset = Math.min(...roots.map((item) => item.node.position[main]));
  for (const layer of layers) {
    for (const item of layer) {
      const across = item.center - item.size / 2;
      positions.set(item.node.id, layout === 'horizontal' ? { x: offset, y: across } : { x: across, y: offset });
    }
    offset += Math.max(...layer.map((item) => item.depth)) + FLOW_GAP;
  }
  return applyPositions(positions);
}
