import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkflowStore } from '../workflow-store';
import type { WorkflowConnection, WorkflowNode } from '../../domain/types';

function node(id: string): WorkflowNode {
  return { id, pluginId: 'action-example', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } };
}

function connection(sourceNodeId: string, targetNodeId: string): WorkflowConnection {
  return { sourceNodeId, sourceOutput: 'main', targetNodeId, targetInput: 'main' };
}

beforeEach(() => {
  // Reset to a clean workflow between tests — zustand stores are module-level singletons.
  useWorkflowStore.setState({
    workflow: { id: 'wf-test', name: 'Test', nodes: [], connections: [] },
    selectedNodeId: undefined,
  });
});

describe('addNode / removeNode', () => {
  it('adds a node to the workflow', () => {
    useWorkflowStore.getState().addNode(node('a'));
    expect(useWorkflowStore.getState().workflow.nodes.map((n) => n.id)).toEqual(['a']);
  });

  it('removes a node and any connections touching it', () => {
    const { addNode, addConnection, removeNode } = useWorkflowStore.getState();
    addNode(node('a'));
    addNode(node('b'));
    addConnection(connection('a', 'b'));

    removeNode('a');

    const { nodes, connections } = useWorkflowStore.getState().workflow;
    expect(nodes.map((n) => n.id)).toEqual(['b']);
    expect(connections).toHaveLength(0);
  });

  it('clears selectedNodeId when the selected node is removed', () => {
    const { addNode, selectNode, removeNode } = useWorkflowStore.getState();
    addNode(node('a'));
    selectNode('a');
    removeNode('a');
    expect(useWorkflowStore.getState().selectedNodeId).toBeUndefined();
  });
});

describe('updateNodeParameters / moveNode', () => {
  it('updates only the targeted node parameters', () => {
    const { addNode, updateNodeParameters } = useWorkflowStore.getState();
    addNode(node('a'));
    addNode(node('b'));

    updateNodeParameters('a', { label: 'hello' });

    const nodes = useWorkflowStore.getState().workflow.nodes;
    expect(nodes.find((n) => n.id === 'a')?.parameters).toEqual({ label: 'hello' });
    expect(nodes.find((n) => n.id === 'b')?.parameters).toEqual({});
  });

  it('updates only the targeted node position', () => {
    const { addNode, moveNode } = useWorkflowStore.getState();
    addNode(node('a'));
    moveNode('a', { x: 100, y: 200 });
    expect(useWorkflowStore.getState().workflow.nodes[0].position).toEqual({ x: 100, y: 200 });
  });
});

describe('addConnection (RF-08, D-06)', () => {
  it('accepts a connection between two nodes and returns true', () => {
    const { addNode, addConnection } = useWorkflowStore.getState();
    addNode(node('a'));
    addNode(node('b'));

    const accepted = addConnection(connection('a', 'b'));

    expect(accepted).toBe(true);
    expect(useWorkflowStore.getState().workflow.connections).toHaveLength(1);
  });

  it('rejects a connection that would close a cycle and does not mutate state', () => {
    const { addNode, addConnection } = useWorkflowStore.getState();
    addNode(node('a'));
    addNode(node('b'));
    addConnection(connection('a', 'b'));

    const accepted = addConnection(connection('b', 'a'));

    expect(accepted).toBe(false);
    expect(useWorkflowStore.getState().workflow.connections).toHaveLength(1);
  });
});

describe('removeConnection', () => {
  it('removes exactly the matching connection, leaving others intact', () => {
    const { addNode, addConnection, removeConnection } = useWorkflowStore.getState();
    addNode(node('a'));
    addNode(node('b'));
    addNode(node('c'));
    addConnection(connection('a', 'b'));
    addConnection(connection('a', 'c'));

    removeConnection('a', 'main', 'b', 'main');

    const connections = useWorkflowStore.getState().workflow.connections;
    expect(connections).toHaveLength(1);
    expect(connections[0].targetNodeId).toBe('c');
  });
});
