import { create } from 'zustand';
import { wouldCreateCycle } from '@runflux/workflow-model/dag';
import type {
  WorkflowConnection,
  WorkflowDefinition,
  WorkflowEdgeType,
  WorkflowNode,
  WorkflowNodeAppearance,
} from '@runflux/workflow-model/types';
import type { NodeResult } from '@runflux/validation-runtime';

export interface WorkflowStoreState {
  workflow: WorkflowDefinition;
  selectedNodeId: string | undefined;
  historyPast: WorkflowDefinition[];
  historyFuture: WorkflowDefinition[];
  historyTransactionBase: WorkflowDefinition | undefined;
  /** Consecutive edits of the same group (typing in one node's form) share one undo step. */
  historyGroup: string | undefined;

  /**
   * Latest validation result per node (003-validation-runtime, RF-02/RF-05).
   * Ephemeral, session-only (NG-03 of the validation-runtime spec) — never
   * part of `workflow`, so it is never saved/exported with the project.
   */
  nodeResults: Record<string, NodeResult>;
  setNodeResults: (results: NodeResult[]) => void;
  setNodeResult: (result: NodeResult) => void;
  clearNodeResult: (nodeId: string) => void;
  clearNodeResults: () => void;

  setWorkflow: (workflow: WorkflowDefinition) => void;
  undo: () => void;
  redo: () => void;
  beginHistoryTransaction: () => void;
  endHistoryTransaction: () => void;
  addNode: (node: WorkflowNode) => void;
  addSubgraph: (nodes: WorkflowNode[], connections: WorkflowConnection[]) => void;
  removeNode: (nodeId: string) => void;
  removeNodes: (nodeIds: string[]) => void;
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

const HISTORY_LIMIT = 100;

function samePosition(a: { x: number; y: number }, b: { x: number; y: number }) {
  return a.x === b.x && a.y === b.y;
}

function commitWorkflow(
  state: WorkflowStoreState,
  workflow: WorkflowDefinition,
  extra: Partial<WorkflowStoreState> = {},
  group?: string,
): Partial<WorkflowStoreState> {
  if (workflow === state.workflow) return extra;
  if (state.historyTransactionBase || (group !== undefined && state.historyGroup === group)) {
    return { workflow, historyFuture: [], ...extra };
  }
  return {
    workflow,
    historyPast: [...state.historyPast.slice(-(HISTORY_LIMIT - 1)), state.workflow],
    historyFuture: [],
    historyGroup: group,
    ...extra,
  };
}

export const useWorkflowStore = create<WorkflowStoreState>((set, get) => ({
  workflow: emptyWorkflow(),
  selectedNodeId: undefined,
  historyPast: [],
  historyFuture: [],
  historyTransactionBase: undefined,
  historyGroup: undefined,
  nodeResults: {},

  setNodeResults: (results) =>
    set((state) => ({
      nodeResults: { ...state.nodeResults, ...Object.fromEntries(results.map((r) => [r.nodeId, r])) },
    })),

  setNodeResult: (result) =>
    set((state) => ({ nodeResults: { ...state.nodeResults, [result.nodeId]: result } })),

  clearNodeResult: (nodeId) =>
    set((state) => {
      const { [nodeId]: _stale, ...remainingResults } = state.nodeResults;
      return { nodeResults: remainingResults };
    }),

  clearNodeResults: () => set({ nodeResults: {} }),

  setWorkflow: (workflow) =>
    set({
      workflow,
      selectedNodeId: undefined,
      nodeResults: {},
      historyPast: [],
      historyFuture: [],
      historyTransactionBase: undefined,
      historyGroup: undefined,
    }),

  undo: () =>
    set((state) => {
      const previous = state.historyPast.at(-1);
      if (!previous) return state;
      return {
        workflow: previous,
        historyPast: state.historyPast.slice(0, -1),
        historyFuture: [state.workflow, ...state.historyFuture].slice(0, HISTORY_LIMIT),
        historyTransactionBase: undefined,
        historyGroup: undefined,
        selectedNodeId: undefined,
        nodeResults: {},
      };
    }),

  redo: () =>
    set((state) => {
      const next = state.historyFuture[0];
      if (!next) return state;
      return {
        workflow: next,
        historyPast: [...state.historyPast.slice(-(HISTORY_LIMIT - 1)), state.workflow],
        historyFuture: state.historyFuture.slice(1),
        historyTransactionBase: undefined,
        historyGroup: undefined,
        selectedNodeId: undefined,
        nodeResults: {},
      };
    }),

  beginHistoryTransaction: () =>
    set((state) => state.historyTransactionBase ? state : { historyTransactionBase: state.workflow }),

  endHistoryTransaction: () =>
    set((state) => {
      const base = state.historyTransactionBase;
      if (!base) return state;
      if (base === state.workflow) return { historyTransactionBase: undefined };
      return {
        historyPast: [...state.historyPast.slice(-(HISTORY_LIMIT - 1)), base],
        historyFuture: [],
        historyTransactionBase: undefined,
        historyGroup: undefined,
      };
    }),

  addNode: (node) =>
    set((state) => commitWorkflow(state, {
        ...state.workflow,
        nodes: orderNodesByParent([...state.workflow.nodes, node]),
      })),

  addSubgraph: (nodes, connections) =>
    set((state) => commitWorkflow(state, {
      ...state.workflow,
      nodes: orderNodesByParent([...state.workflow.nodes, ...nodes]),
      connections: [...state.workflow.connections, ...connections],
    })),

  removeNode: (nodeId) => get().removeNodes([nodeId]),

  removeNodes: (nodeIds) =>
    set((state) => {
      const removed = new Set(nodeIds);
      if (!state.workflow.nodes.some((node) => removed.has(node.id))) return state;
      const remainingResults = Object.fromEntries(Object.entries(state.nodeResults).filter(([nodeId]) => !removed.has(nodeId)));
      return commitWorkflow(state, {
          ...state.workflow,
          nodes: state.workflow.nodes.filter((n) => !removed.has(n.id)),
          connections: state.workflow.connections.filter(
            (c) => !removed.has(c.sourceNodeId) && !removed.has(c.targetNodeId),
          ),
        }, {
        selectedNodeId: state.selectedNodeId && removed.has(state.selectedNodeId) ? undefined : state.selectedNodeId,
        nodeResults: remainingResults,
      });
    }),

  updateNodeParameters: (nodeId, parameters) =>
    set((state) => {
      // A parameter change invalidates any previous test result for this
      // node — its output no longer reflects what the node would produce now.
      const { [nodeId]: _stale, ...remainingResults } = state.nodeResults;
      const nextWorkflow = {
          ...state.workflow,
          nodes: state.workflow.nodes.map((n) => (n.id === nodeId ? { ...n, parameters } : n)),
        };
      return commitWorkflow(state, nextWorkflow, {
        nodeResults: remainingResults,
      }, `parameters:${nodeId}`);
    }),

  moveNode: (nodeId, position) =>
    set((state) => {
      const current = state.workflow.nodes.find((node) => node.id === nodeId);
      if (!current || samePosition(current.position, position)) return state;
      return commitWorkflow(state, {
        ...state.workflow,
        nodes: state.workflow.nodes.map((n) => (n.id === nodeId ? { ...n, position } : n)),
      });
    }),

  updateNodeAppearance: (nodeId, appearance) =>
    set((state) => commitWorkflow(state, {
        ...state.workflow,
        nodes: state.workflow.nodes.map((node) =>
          node.id === nodeId
            ? { ...node, appearance: { ...node.appearance, ...appearance } }
            : node,
        ),
      }, {}, `appearance:${nodeId}`)),

  updateNodeGeometry: (nodeId, geometry) =>
    set((state) => {
      const current = state.workflow.nodes.find((node) => node.id === nodeId);
      if (!current) return state;
      const sameParent = geometry.parentId === undefined || (geometry.parentId === null ? !current.parentId : current.parentId === geometry.parentId);
      const sameWidth = geometry.width === undefined || current.appearance?.width === geometry.width;
      const sameHeight = geometry.height === undefined || current.appearance?.height === geometry.height;
      const samePos = geometry.position === undefined || samePosition(current.position, geometry.position);
      if (sameParent && sameWidth && sameHeight && samePos) return state;
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

      return commitWorkflow(state, {
          ...state.workflow,
          nodes: orderNodesByParent(updatedNodes),
        });
    }),

  replaceNodes: (nodes) =>
    set((state) => commitWorkflow(state, { ...state.workflow, nodes: orderNodesByParent(nodes) })),

  selectNode: (nodeId) => set({ selectedNodeId: nodeId }),

  addConnection: (connection) => {
    const { workflow } = get();
    if (wouldCreateCycle(workflow.connections, connection.sourceNodeId, connection.targetNodeId)) {
      return false;
    }
    set((state) => commitWorkflow(state, { ...state.workflow, connections: [...state.workflow.connections, connection] }));
    return true;
  },

  updateConnection: (sourceNodeId, sourceOutput, targetNodeId, targetInput, appearance) =>
    set((state) => commitWorkflow(state, {
        ...state.workflow,
        connections: state.workflow.connections.map((connection) =>
          connection.sourceNodeId === sourceNodeId &&
          connection.sourceOutput === sourceOutput &&
          connection.targetNodeId === targetNodeId &&
          connection.targetInput === targetInput
            ? { ...connection, ...appearance }
            : connection,
        ),
      })),

  removeConnection: (sourceNodeId, sourceOutput, targetNodeId, targetInput) =>
    set((state) => {
      const exists = state.workflow.connections.some(
        (c) =>
          c.sourceNodeId === sourceNodeId &&
          c.sourceOutput === sourceOutput &&
          c.targetNodeId === targetNodeId &&
          c.targetInput === targetInput,
      );
      if (!exists) return state;
      return commitWorkflow(state, {
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
      });
    }),
}));
