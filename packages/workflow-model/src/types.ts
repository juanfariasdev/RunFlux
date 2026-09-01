/**
 * Canonical workflow model, shared by every consumer that needs to reason
 * about a RunFlux workflow's structure (the editor's UI, the validation
 * runtime, and — later — the compiler) without depending on any of them.
 * Deliberately independent of @xyflow/react's own Node/Edge shape — see
 * apps/workflow-editor/src/adapters/react-flow-adapter.ts for that
 * translation layer (002-workflow-editor, D-05).
 */

export interface WorkflowNode {
  id: string;
  pluginId: string;
  pluginVersion: string;
  parameters: Record<string, unknown>;
  position: { x: number; y: number };
  parentId?: string;
  appearance?: WorkflowNodeAppearance;
}

export type WorkflowNodeShape = 'card' | 'rounded' | 'pill' | 'diamond' | 'subflow';

export interface WorkflowNodeAppearance {
  label?: string;
  color?: string;
  shape?: WorkflowNodeShape;
  width?: number;
  height?: number;
}

export interface WorkflowConnection {
  sourceNodeId: string;
  sourceOutput: string;
  targetNodeId: string;
  targetInput: string;
  label?: string;
  animated?: boolean;
  type?: WorkflowEdgeType;
  color?: string;
}

export type WorkflowEdgeType = 'smoothstep' | 'bezier' | 'straight';

export interface WorkflowDefinition {
  id: string;
  name: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
}
