import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkflowStore } from '../workflow-store';
import type { WorkflowConnection, WorkflowNode } from '@runflux/workflow-model/types';
import type { NodeResult } from '@runflux/validation-runtime';

function node(id: string): WorkflowNode {
  return { id, pluginId: 'action-example', pluginVersion: '1.0.0', parameters: {}, position: { x: 0, y: 0 } };
}

function connection(sourceNodeId: string, targetNodeId: string): WorkflowConnection {
  return { sourceNodeId, sourceOutput: 'main', targetNodeId, targetInput: 'main' };
}

function result(nodeId: string, error: string | null = null): NodeResult {
  return { nodeId, input: null, output: 'ok', error, startedAt: 't0', finishedAt: 't1' };
}

beforeEach(() => {
  // Reset to a clean workflow between tests — zustand stores are module-level singletons.
  useWorkflowStore.setState({
    workflow: { id: 'wf-test', name: 'Test', nodes: [], connections: [] },
    selectedNodeId: undefined,
    nodeResults: {},
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

  it('persists appearance and resize dimensions independently of plugin parameters', () => {
    const { addNode, updateNodeAppearance, updateNodeGeometry } = useWorkflowStore.getState();
    addNode(node('a'));
    updateNodeAppearance('a', { label: 'Webhook', shape: 'pill', color: '#4f46e5' });
    updateNodeGeometry('a', { width: 280, height: 120 });

    expect(useWorkflowStore.getState().workflow.nodes[0]).toMatchObject({
      parameters: {},
      appearance: { label: 'Webhook', shape: 'pill', color: '#4f46e5', width: 280, height: 120 },
    });
  });

  it('updates parentId on node and ensures parent nodes precede child nodes', () => {
    const { addNode, updateNodeGeometry } = useWorkflowStore.getState();
    addNode(node('child'));
    addNode(node('parent'));

    updateNodeGeometry('child', { parentId: 'parent' });

    const nodes = useWorkflowStore.getState().workflow.nodes;
    expect(nodes.map((n) => n.id)).toEqual(['parent', 'child']);
    expect(nodes.find((n) => n.id === 'child')?.parentId).toBe('parent');

    updateNodeGeometry('child', { parentId: null });
    expect(useWorkflowStore.getState().workflow.nodes.find((n) => n.id === 'child')?.parentId).toBeUndefined();
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

describe('nodeResults (003-validation-runtime, RF-02/RF-05)', () => {
  it('setNodeResults merges a batch of results, keyed by nodeId', () => {
    useWorkflowStore.getState().setNodeResults([result('a'), result('b', 'boom')]);
    const { nodeResults } = useWorkflowStore.getState();
    expect(nodeResults.a.error).toBeNull();
    expect(nodeResults.b.error).toBe('boom');
  });

  it('setNodeResult updates a single node without touching others', () => {
    useWorkflowStore.getState().setNodeResults([result('a'), result('b')]);
    useWorkflowStore.getState().setNodeResult(result('a', 'now failing'));
    const { nodeResults } = useWorkflowStore.getState();
    expect(nodeResults.a.error).toBe('now failing');
    expect(nodeResults.b.error).toBeNull();
  });

  it('clearNodeResults empties the map', () => {
    useWorkflowStore.getState().setNodeResults([result('a')]);
    useWorkflowStore.getState().clearNodeResults();
    expect(useWorkflowStore.getState().nodeResults).toEqual({});
  });

  it('removeNode drops that node\'s stale result', () => {
    const { addNode, setNodeResult, removeNode } = useWorkflowStore.getState();
    addNode(node('a'));
    setNodeResult(result('a'));
    removeNode('a');
    expect(useWorkflowStore.getState().nodeResults.a).toBeUndefined();
  });

  it('updateNodeParameters invalidates that node\'s stale result', () => {
    const { addNode, setNodeResult, updateNodeParameters } = useWorkflowStore.getState();
    addNode(node('a'));
    setNodeResult(result('a'));
    updateNodeParameters('a', { url: 'https://example.com' });
    expect(useWorkflowStore.getState().nodeResults.a).toBeUndefined();
  });
});

describe('edge appearance updates', () => {
  it('updates only the exact edge appearance, including parallel handles', () => {
    const first = connection('a', 'b');
    const second = { ...first, sourceOutput: 'error' };
    useWorkflowStore.setState((state) => ({
      workflow: { ...state.workflow, connections: [first, second] },
    }));

    useWorkflowStore.getState().updateConnection('a', 'main', 'b', 'main', {
      label: 'Success', animated: true, type: 'bezier', color: '#10b981',
    });

    expect(useWorkflowStore.getState().workflow.connections[0]).toMatchObject({ label: 'Success', animated: true, type: 'bezier' });
    expect(useWorkflowStore.getState().workflow.connections[1].label).toBeUndefined();
  });
});
