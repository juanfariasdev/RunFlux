import type { WorkflowDefinition, WorkflowNode } from '@runflux/workflow-model';
import type { TargetPlatform, IncompatibleNode, PluginResolver } from './types.js';

export interface CompatibilityValidationResult {
  compatible: boolean;
  incompatibleNodes: IncompatibleNode[];
}

export function validateWorkflowCompatibility(
  workflow: WorkflowDefinition,
  targetPlatform: TargetPlatform,
  resolver: PluginResolver
): CompatibilityValidationResult {
  const incompatibleNodes: IncompatibleNode[] = [];

  for (const node of workflow.nodes) {
    const plugin = resolver(node.pluginId);
    if (!plugin || !plugin.generators || typeof plugin.generators[targetPlatform] !== 'function') {
      incompatibleNodes.push({
        nodeId: node.id,
        pluginId: node.pluginId,
        targetPlatform,
      });
    }
  }

  return {
    compatible: incompatibleNodes.length === 0,
    incompatibleNodes,
  };
}

export function getTopologicalNodeOrder(workflow: WorkflowDefinition): WorkflowNode[] {
  const nodeMap = new Map<string, WorkflowNode>();
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  for (const node of workflow.nodes) {
    nodeMap.set(node.id, node);
    inDegree.set(node.id, 0);
    adjList.set(node.id, []);
  }

  for (const conn of workflow.connections) {
    if (inDegree.has(conn.targetNodeId)) {
      inDegree.set(conn.targetNodeId, (inDegree.get(conn.targetNodeId) || 0) + 1);
    }
    if (adjList.has(conn.sourceNodeId)) {
      adjList.get(conn.sourceNodeId)!.push(conn.targetNodeId);
    }
  }

  const queue: string[] = [];
  for (const [nodeId, deg] of inDegree.entries()) {
    if (deg === 0) {
      queue.push(nodeId);
    }
  }

  const sorted: WorkflowNode[] = [];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const node = nodeMap.get(currentId);
    if (node) {
      sorted.push(node);
    }

    const neighbors = adjList.get(currentId) || [];
    for (const neighborId of neighbors) {
      const newDeg = (inDegree.get(neighborId) || 1) - 1;
      inDegree.set(neighborId, newDeg);
      if (newDeg === 0) {
        queue.push(neighborId);
      }
    }
  }

  // Se restou algum nó (ciclos ou nós soltos), anexa os faltantes
  if (sorted.length < workflow.nodes.length) {
    for (const node of workflow.nodes) {
      if (!sorted.some((s) => s.id === node.id)) {
        sorted.push(node);
      }
    }
  }

  return sorted;
}
