import { describe, expect, it } from 'vitest';
import { layoutWorkflowNodes } from '../layout';
import type { WorkflowConnection, WorkflowNode } from '../types';

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
});
