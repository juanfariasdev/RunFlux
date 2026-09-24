import { describe, expect, it } from 'vitest';
import { layoutWorkflowNodes, type WorkflowLayout } from '../layout';
import type { WorkflowConnection, WorkflowNode } from '@runflux/workflow-model/types';

const nodes: WorkflowNode[] = ['a', 'b', 'c'].map((id) => ({
  id,
  pluginId: `plugin-${id}`,
  pluginVersion: '1.0.0',
  parameters: {},
  position: { x: 0, y: 0 },
}));
const connections: WorkflowConnection[] = [
  { sourceNodeId: 'a', sourceOutput: 'main', targetNodeId: 'b', targetInput: 'main' },
  { sourceNodeId: 'b', sourceOutput: 'main', targetNodeId: 'c', targetInput: 'main' },
];

function node(id: string, x: number, y: number, appearance?: WorkflowNode['appearance']): WorkflowNode {
  return { ...nodes[0], id, position: { x, y }, ...(appearance ? { appearance } : {}) };
}

function connect(sourceNodeId: string, targetNodeId: string): WorkflowConnection {
  return { sourceNodeId, targetNodeId, sourceOutput: 'main', targetInput: 'main' };
}

function coordinate(result: WorkflowNode[], id: string, axis: 'x' | 'y') {
  return result.find((item) => item.id === id)!.position[axis];
}

describe('layoutWorkflowNodes', () => {
  it('places each DAG rank farther right in horizontal mode', () => {
    const result = layoutWorkflowNodes(nodes, connections, 'horizontal');
    expect(result.find((node) => node.id === 'a')!.position.x).toBeLessThan(result.find((node) => node.id === 'b')!.position.x);
    expect(result.find((node) => node.id === 'b')!.position.x).toBeLessThan(result.find((node) => node.id === 'c')!.position.x);
  });

  it('places each DAG rank farther down in vertical mode', () => {
    const result = layoutWorkflowNodes(nodes, connections, 'vertical');
    expect(result.find((node) => node.id === 'a')!.position.y).toBeLessThan(result.find((node) => node.id === 'b')!.position.y);
    expect(result.find((node) => node.id === 'b')!.position.y).toBeLessThan(result.find((node) => node.id === 'c')!.position.y);
  });

  it('keeps child coordinates relative to their subflow', () => {
    const child = { ...nodes[2], id: 'child', parentId: 'group', position: { x: 32, y: 48 } };
    const result = layoutWorkflowNodes([nodes[0], child], [], 'grid');
    expect(result.find((node) => node.id === 'child')!.position).toEqual({ x: 32, y: 48 });
  });

  it.each<WorkflowLayout>(['horizontal', 'vertical', 'grid'])('preserves the node array order in %s mode', (layout) => {
    const input = [node('group', 0, 0), { ...node('child', 32, 48), parentId: 'group' }, nodes[2], nodes[0], nodes[1]];
    const result = layoutWorkflowNodes(input, connections, layout);
    expect(result.map((item) => item.id)).toEqual(input.map((item) => item.id));
    expect(result[1]).toBe(input[1]);
  });

  describe.each(['horizontal', 'vertical'] as const)('%s layout stability', (layout) => {
    const main = layout === 'horizontal' ? 'x' : 'y';
    const cross = layout === 'horizontal' ? 'y' : 'x';
    const positioned = (id: string, along: number, across: number, appearance?: WorkflowNode['appearance']) =>
      node(id, main === 'x' ? along : across, main === 'x' ? across : along, appearance);

    it('keeps the visual order of starting nodes even when their insertion order differs', () => {
      const input = [positioned('lower', 120, 600), positioned('upper', 120, 200)];
      const result = layoutWorkflowNodes(input, [], layout);
      expect(coordinate(result, 'upper', cross)).toBeLessThan(coordinate(result, 'lower', cross));
      expect(result.find((item) => item.id === 'upper')!.position).toEqual(input[1].position);
    });

    it('aligns a lone successor with its connected starting node', () => {
      const input = [positioned('upper', 100, 0), positioned('lower', 100, 500), positioned('child', 700, 500)];
      const result = layoutWorkflowNodes(input, [connect('lower', 'child')], layout);
      expect(coordinate(result, 'child', cross)).toBe(coordinate(result, 'lower', cross));
      const parentSize = main === 'x' ? 220 : 104;
      const gap = coordinate(result, 'child', main) - coordinate(result, 'lower', main) - parentSize;
      expect(gap).toBeGreaterThan(0);
      expect(gap).toBeLessThanOrEqual(100);
    });

    it.each([2, 4])('reserves the full branch span for a node with %i children', (childCount) => {
      const root = positioned('wide-root', 0, 0);
      const otherRoot = positioned('small-root', 0, 0);
      const children = Array.from({ length: childCount }, (_, index) => positioned(`child-${index}`, 900, 200 + index * 180));
      const otherChild = positioned('other-child', 900, 2000);
      const input = [root, otherRoot, ...children, otherChild];
      const edges = [...children.map((child) => connect(root.id, child.id)), connect(otherRoot.id, otherChild.id)];
      const result = layoutWorkflowNodes(input, edges, layout);
      const branchSpan = childCount * 104 + (childCount - 1) * 48;
      const rootGap = coordinate(result, 'small-root', cross) - coordinate(result, 'wide-root', cross);
      const childPositions = children.map((child) => coordinate(result, child.id, cross));
      const actualBranchSpan = Math.max(...childPositions) + 104 - Math.min(...childPositions);

      expect(rootGap).toBeGreaterThanOrEqual((branchSpan + 104) / 2 + 48);
      expect(actualBranchSpan).toBeGreaterThanOrEqual(branchSpan);
    });

    it('uncrosses independent pairs without swapping their starting nodes', () => {
      const input = [positioned('upper', 0, 0), positioned('lower', 0, 400), positioned('lower-child', 500, 0), positioned('upper-child', 500, 400)];
      const result = layoutWorkflowNodes(input, [connect('upper', 'upper-child'), connect('lower', 'lower-child')], layout);
      expect(coordinate(result, 'upper', cross)).toBeLessThan(coordinate(result, 'lower', cross));
      expect(coordinate(result, 'upper-child', cross)).toBeLessThan(coordinate(result, 'lower-child', cross));
      expect(coordinate(result, 'upper-child', cross)).toBe(coordinate(result, 'upper', cross));
      expect(coordinate(result, 'lower-child', cross)).toBe(coordinate(result, 'lower', cross));
    });

    it('reduces crossings when one connection skips a rank', () => {
      const input = [
        positioned('upper', 0, 0), positioned('lower', 0, 500),
        positioned('upper-branch', 400, 0), positioned('lower-branch', 400, 500),
        positioned('top-child', 900, 500), positioned('bottom-child', 900, 0),
      ];
      const edges = [
        connect('upper', 'upper-branch'), connect('upper', 'top-child'),
        connect('upper-branch', 'top-child'), connect('lower', 'lower-branch'),
        connect('lower-branch', 'bottom-child'),
      ];
      const result = layoutWorkflowNodes(input, edges, layout);
      expect(coordinate(result, 'top-child', cross)).toBeLessThan(coordinate(result, 'bottom-child', cross));
    });

    it('leaves an already ordered branch in the same visual order', () => {
      const input = [positioned('root', 100, 200), positioned('bottom', 700, 500), positioned('top', 700, 100)];
      const result = layoutWorkflowNodes(input, [connect('root', 'bottom'), connect('root', 'top')], layout);
      expect(coordinate(result, 'top', cross)).toBeLessThan(coordinate(result, 'bottom', cross));
      expect(layoutWorkflowNodes(result, [connect('root', 'bottom'), connect('root', 'top')], layout)).toEqual(result);
    });

    it('respects resized nodes and the default subflow size', () => {
      const input = [positioned('group', 0, 0, { shape: 'subflow' }), positioned('small', 0, 800), positioned('next', 900, 0)];
      const result = layoutWorkflowNodes(input, [connect('group', 'next')], layout);
      expect(coordinate(result, 'next', main)).toBeGreaterThan(coordinate(result, 'group', main) + (main === 'x' ? 520 : 300));
      expect(coordinate(result, 'small', cross)).toBeGreaterThan(coordinate(result, 'group', cross) + (cross === 'x' ? 520 : 300));
    });
  });
});
