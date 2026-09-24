import { describe, expect, it } from 'vitest';
import { getExecutionOrder, CyclicWorkflowError } from '../topological-order';
import type { WorkflowConnection, WorkflowNode } from '@runflux/workflow-model/types';

function node(id: string): WorkflowNode {
  return { id, pluginId: `plugin-${id}`, pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } };
}

function connection(sourceNodeId: string, targetNodeId: string): WorkflowConnection {
  return { sourceNodeId, sourceOutput: 'main', targetNodeId, targetInput: 'main' };
}

function indexOf(order: WorkflowNode[], id: string): number {
  return order.findIndex((n) => n.id === id);
}

describe('getExecutionOrder', () => {
  it('orders a linear chain a -> b -> c in sequence', () => {
    const nodes = [node('c'), node('a'), node('b')];
    const connections = [connection('a', 'b'), connection('b', 'c')];
    const order = getExecutionOrder(nodes, connections);
    expect(order.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });

  it('orders a branching graph so every node comes after all of its upstream nodes', () => {
    // a -> b, a -> c, b -> d, c -> d
    const nodes = [node('a'), node('b'), node('c'), node('d')];
    const connections = [connection('a', 'b'), connection('a', 'c'), connection('b', 'd'), connection('c', 'd')];
    const order = getExecutionOrder(nodes, connections);
    expect(indexOf(order, 'a')).toBeLessThan(indexOf(order, 'b'));
    expect(indexOf(order, 'a')).toBeLessThan(indexOf(order, 'c'));
    expect(indexOf(order, 'b')).toBeLessThan(indexOf(order, 'd'));
    expect(indexOf(order, 'c')).toBeLessThan(indexOf(order, 'd'));
  });

  it('includes disconnected nodes exactly once', () => {
    const nodes = [node('a'), node('isolated')];
    const order = getExecutionOrder(nodes, []);
    expect(order.map((n) => n.id).sort()).toEqual(['a', 'isolated']);
  });

  it('throws CyclicWorkflowError instead of looping forever when the graph has a residual cycle (D-06)', () => {
    const nodes = [node('a'), node('b')];
    const connections = [connection('a', 'b'), connection('b', 'a')];
    expect(() => getExecutionOrder(nodes, connections)).toThrow(CyclicWorkflowError);
  });

  it('ignores a connection that references a node id not present in the workflow', () => {
    const nodes = [node('a')];
    const connections = [connection('a', 'ghost')];
    const order = getExecutionOrder(nodes, connections);
    expect(order.map((n) => n.id)).toEqual(['a']);
  });
});
