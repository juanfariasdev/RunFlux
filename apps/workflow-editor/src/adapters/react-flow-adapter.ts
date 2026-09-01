import { MarkerType, type Edge as ReactFlowEdge, type Node as ReactFlowNode } from '@xyflow/react';
import type { PluginManifest } from '@runflux/plugin-system/types';
import type { PluginReferenceStatus } from '@runflux/plugin-system/api/resolve-generator';
import type { WorkflowConnection, WorkflowNode, WorkflowNodeAppearance } from '@runflux/workflow-model/types';

/**
 * Data carried on every React Flow node (D-05). Keeps the canonical
 * WorkflowNode fields needed for a lossless round-trip, plus display-only
 * info (the resolved manifest and plugin-reference status) the node's visual
 * component uses to render its label/icon and error state (RF-11).
 */
export interface WorkflowNodeData extends Record<string, unknown> {
  pluginId: string;
  pluginVersion: string;
  parameters: Record<string, unknown>;
  manifest: PluginManifest | undefined;
  referenceStatus: PluginReferenceStatus;
  appearance: WorkflowNodeAppearance;
}

export type FlowNode = ReactFlowNode<WorkflowNodeData>;
export type FlowEdge = ReactFlowEdge;

export function toReactFlowNode(
  node: WorkflowNode,
  manifest: PluginManifest | undefined,
  referenceStatus: PluginReferenceStatus,
): FlowNode {
  const appearance = node.appearance ?? {};
  const isSubflow = appearance.shape === 'subflow';

  return {
    id: node.id,
    position: node.position,
    type: isSubflow ? 'subflowNode' : 'workflowNode',
    parentId: node.parentId,
    extent: node.parentId ? 'parent' : undefined,
    expandParent: node.parentId ? true : undefined,
    style: {
      width: appearance.width ?? (isSubflow ? 520 : 220),
      height: appearance.height ?? (isSubflow ? 300 : 104),
    },
    zIndex: isSubflow ? -1 : 1,
    data: {
      pluginId: node.pluginId,
      pluginVersion: node.pluginVersion,
      parameters: node.parameters,
      manifest,
      referenceStatus,
      appearance,
    },
  };
}

export function fromReactFlowNode(flowNode: FlowNode): WorkflowNode {
  return {
    id: flowNode.id,
    pluginId: flowNode.data.pluginId,
    pluginVersion: flowNode.data.pluginVersion,
    parameters: flowNode.data.parameters,
    position: flowNode.position,
    ...(flowNode.parentId ? { parentId: flowNode.parentId } : {}),
    ...(Object.keys(flowNode.data.appearance).length > 0 ? { appearance: flowNode.data.appearance } : {}),
  };
}

export function toReactFlowEdge(connection: WorkflowConnection): FlowEdge {
  return {
    id: connectionId(connection),
    source: connection.sourceNodeId,
    sourceHandle: connection.sourceOutput,
    target: connection.targetNodeId,
    targetHandle: connection.targetInput,
    label: connection.label,
    animated: connection.animated,
    type: connection.type ?? 'smoothstep',
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: connection.color ?? '#64748b',
      width: 18,
      height: 18,
    },
    style: {
      stroke: connection.color ?? '#64748b',
      strokeWidth: 2,
    },
    labelStyle: { fill: '#475569', fontSize: 11, fontWeight: 600 },
    labelBgStyle: { fill: '#ffffff', fillOpacity: 0.92 },
    labelBgPadding: [6, 4],
    labelBgBorderRadius: 6,
    data: {
      workflowAppearance: {
        ...(connection.label !== undefined ? { label: connection.label } : {}),
        ...(connection.animated !== undefined ? { animated: connection.animated } : {}),
        ...(connection.type !== undefined ? { type: connection.type } : {}),
        ...(connection.color !== undefined ? { color: connection.color } : {}),
      },
    },
  };
}

export function fromReactFlowEdge(edge: FlowEdge): WorkflowConnection {
  const appearance =
    edge.data && typeof edge.data.workflowAppearance === 'object' && edge.data.workflowAppearance !== null
      ? (edge.data.workflowAppearance as Partial<WorkflowConnection>)
      : {};

  return {
    sourceNodeId: edge.source,
    sourceOutput: edge.sourceHandle ?? 'main',
    targetNodeId: edge.target,
    targetInput: edge.targetHandle ?? 'main',
    ...(appearance.label !== undefined ? { label: appearance.label } : {}),
    ...(appearance.animated !== undefined ? { animated: appearance.animated } : {}),
    ...(appearance.type !== undefined ? { type: appearance.type } : {}),
    ...(appearance.color !== undefined ? { color: appearance.color } : {}),
  };
}

export function connectionId(connection: WorkflowConnection): string {
  return `${connection.sourceNodeId}:${connection.sourceOutput}->${connection.targetNodeId}:${connection.targetInput}`;
}
