import { create } from 'zustand';
import { wouldCreateCycle } from '../domain/dag';
import type { WorkflowConnection, WorkflowDefinition, WorkflowNode } from '../domain/types';

export interface WorkflowStoreState {
  workflow: WorkflowDefinition;
  selectedNodeId: string | undefined;

  addNode: (node: WorkflowNode) => void;
  removeNode: (nodeId: string) => void;
  updateNodeParameters: (nodeId: string, parameters: Record<string, unknown>) => void;
  moveNode: (nodeId: string, position: { x: number; y: number }) => void;
  selectNode: (nodeId: string | undefined) => void;

  /**
   * Attempts to add a connection. Returns false (and does not mutate state)
   * when the connection would close a cycle (RF-08, D-06) — the caller (the
   * Canvas's onConnect handler) is responsible for surfacing that rejection
   * to the user (EC-03).
   */
  addConnection: (connection: WorkflowConnection) => boolean;
  removeConnection: (sourceNodeId: string, sourceOutput: string, targetNodeId: string, targetInput: string) => void;
}

function emptyWorkflow(): WorkflowDefinition {
  return { id: crypto.randomUUID(), name: 'Untitled workflow', nodes: [], connections: [] };
}

export const useWorkflowStore = create<WorkflowStoreState>((set, get) => ({
  workflow: emptyWorkflow(),
  selectedNodeId: undefined,

  addNode: (node) =>
    set((state) => ({ workflow: { ...state.workflow, nodes: [...state.workflow.nodes, node] } })),

  removeNode: (nodeId) =>
    set((state) => ({
      workflow: {
        ...state.workflow,
        nodes: state.workflow.nodes.filter((n) => n.id !== nodeId),
        connections: state.workflow.connections.filter(
          (c) => c.sourceNodeId !== nodeId && c.targetNodeId !== nodeId,
        ),
      },
      selectedNodeId: state.selectedNodeId === nodeId ? undefined : state.selectedNodeId,
    })),

  updateNodeParameters: (nodeId, parameters) =>
    set((state) => ({
      workflow: {
        ...state.workflow,
        nodes: state.workflow.nodes.map((n) => (n.id === nodeId ? { ...n, parameters } : n)),
      },
    })),

  moveNode: (nodeId, position) =>
    set((state) => ({
      workflow: {
        ...state.workflow,
        nodes: state.workflow.nodes.map((n) => (n.id === nodeId ? { ...n, position } : n)),
      },
    })),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  addConnection: (connection) => {
    const { workflow } = get();
    if (wouldCreateCycle(workflow.connections, connection.sourceNodeId, connection.targetNodeId)) {
      return false;
    }
    set((state) => ({
      workflow: { ...state.workflow, connections: [...state.workflow.connections, connection] },
    }));
    return true;
  },

  removeConnection: (sourceNodeId, sourceOutput, targetNodeId, targetInput) =>
    set((state) => ({
      workflow: {
        ...state.workflow,
        connections: state.workflow.connections.filter(
          (c) =>
            !(
              c.sourceNodeId === sourceNodeId &&
              c.sourceOutput === sourceOutput &&
              c.targetNodeId === targetNodeId &&
              c.targetInput === targetInput
            ),
        ),
      },
    })),
}));
