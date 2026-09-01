import type { Edge as ReactFlowEdge, Node as ReactFlowNode } from '@xyflow/react';
import type { PluginManifest } from '@runflux/plugin-system/types';
import type { PluginReferenceStatus } from '@runflux/plugin-system/api/resolve-generator';
import type { WorkflowConnection, WorkflowNode } from '../domain/types';

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
}

export type FlowNode = ReactFlowNode<WorkflowNodeData>;
export type FlowEdge = ReactFlowEdge;

export function toReactFlowNode(
  node: WorkflowNode,
  manifest: PluginManifest | undefined,
  referenceStatus: PluginReferenceStatus,
): FlowNode {
  return {
    id: node.id,
    position: node.position,
    type: 'workflowNode',
    data: {
      pluginId: node.pluginId,
      pluginVersion: node.pluginVersion,
      parameters: node.parameters,
      manifest,
      referenceStatus,
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
  };
}

export function toReactFlowEdge(connection: WorkflowConnection): FlowEdge {
  return {
    id: edgeId(connection),
    source: connection.sourceNodeId,
    sourceHandle: connection.sourceOutput,
    target: connection.targetNodeId,
    targetHandle: connection.targetInput,
  };
}

export function fromReactFlowEdge(edge: FlowEdge): WorkflowConnection {
  return {
    sourceNodeId: edge.source,
    sourceOutput: edge.sourceHandle ?? 'main',
    targetNodeId: edge.target,
    targetInput: edge.targetHandle ?? 'main',
  };
}

function edgeId(connection: WorkflowConnection): string {
  return `${connection.sourceNodeId}:${connection.sourceOutput}->${connection.targetNodeId}:${connection.targetInput}`;
}
