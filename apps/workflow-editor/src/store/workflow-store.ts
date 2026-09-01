import { create } from 'zustand';
import { wouldCreateCycle } from '@runflux/workflow-model/dag';
import type {
  WorkflowConnection,
  WorkflowDefinition,
  WorkflowEdgeType,
  WorkflowNode,
  WorkflowNodeAppearance,
} from '@runflux/workflow-model/types';

export interface WorkflowStoreState {
  workflow: WorkflowDefinition;
  selectedNodeId: string | undefined;

  addNode: (node: WorkflowNode) => void;
  removeNode: (nodeId: string) => void;
  updateNodeParameters: (nodeId: string, parameters: Record<string, unknown>) => void;
  moveNode: (nodeId: string, position: { x: number; y: number }) => void;
  updateNodeAppearance: (nodeId: string, appearance: Partial<WorkflowNodeAppearance>) => void;
  updateNodeGeometry: (nodeId: string, geometry: { position?: { x: number; y: number }; width?: number; height?: number; parentId?: string | null }) => void;
  replaceNodes: (nodes: WorkflowNode[]) => void;
  selectNode: (nodeId: string | undefined) => void;

  /**
   * Attempts to add a connection. Returns false (and does not mutate state)
   * when the connection would close a cycle (RF-08, D-06) — the caller (the
   * Canvas's onConnect handler) is responsible for surfacing that rejection
   * to the user (EC-03).
   */
  addConnection: (connection: WorkflowConnection) => boolean;
  updateConnection: (
    sourceNodeId: string,
    sourceOutput: string,
    targetNodeId: string,
    targetInput: string,
    appearance: { label?: string; animated?: boolean; type?: WorkflowEdgeType; color?: string },
  ) => void;
  removeConnection: (sourceNodeId: string, sourceOutput: string, targetNodeId: string, targetInput: string) => void;
}

function emptyWorkflow(): WorkflowDefinition {
  return { id: crypto.randomUUID(), name: 'Untitled workflow', nodes: [], connections: [] };
}

function orderNodesByParent(nodes: WorkflowNode[]): WorkflowNode[] {
  const parents = nodes.filter((n) => !n.parentId);
  const children = nodes.filter((n) => Boolean(n.parentId));
  return [...parents, ...children];
}

export const useWorkflowStore = create<WorkflowStoreState>((set, get) => ({
  workflow: emptyWorkflow(),
  selectedNodeId: undefined,

  addNode: (node) =>
    set((state) => ({
      workflow: {
        ...state.workflow,
        nodes: orderNodesByParent([...state.workflow.nodes, node]),
      },
    })),

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

  updateNodeAppearance: (nodeId, appearance) =>
    set((state) => ({
      workflow: {
        ...state.workflow,
        nodes: state.workflow.nodes.map((node) =>
          node.id === nodeId
            ? { ...node, appearance: { ...node.appearance, ...appearance } }
            : node,
        ),
      },
    })),

  updateNodeGeometry: (nodeId, geometry) =>
    set((state) => {
      const updatedNodes = state.workflow.nodes.map((node) => {
        if (node.id !== nodeId) return node;
        const updated: WorkflowNode = {
          ...node,
          position: geometry.position ?? node.position,
          appearance: {
            ...node.appearance,
            ...(geometry.width !== undefined ? { width: geometry.width } : {}),
            ...(geometry.height !== undefined ? { height: geometry.height } : {}),
          },
        };
        if (geometry.parentId !== undefined) {
          if (geometry.parentId === null) {
            delete updated.parentId;
          } else {
            updated.parentId = geometry.parentId;
          }
        }
        return updated;
      });

      return {
        workflow: {
          ...state.workflow,
          nodes: orderNodesByParent(updatedNodes),
        },
      };
    }),

  replaceNodes: (nodes) =>
    set((state) => ({ workflow: { ...state.workflow, nodes: orderNodesByParent(nodes) } })),

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

  updateConnection: (sourceNodeId, sourceOutput, targetNodeId, targetInput, appearance) =>
    set((state) => ({
      workflow: {
        ...state.workflow,
        connections: state.workflow.connections.map((connection) =>
          connection.sourceNodeId === sourceNodeId &&
          connection.sourceOutput === sourceOutput &&
          connection.targetNodeId === targetNodeId &&
          connection.targetInput === targetInput
            ? { ...connection, ...appearance }
            : connection,
        ),
      },
    })),

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
