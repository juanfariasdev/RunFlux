import { getExecutionOrder } from '@runflux/workflow-model';
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
  return getExecutionOrder(workflow.nodes, workflow.connections);
}

export function validateGraphReferences(workflow: WorkflowDefinition, resolver: PluginResolver): void {
  const nodes = new Map<string, WorkflowNode>();
  for (const node of workflow.nodes) {
    if (!node.id || nodes.has(node.id)) throw new Error(`Duplicate or empty node ID "${node.id}"`);
    nodes.set(node.id, node);
  }
  for (const connection of workflow.connections) {
    const source = nodes.get(connection.sourceNodeId);
    if (!source || !nodes.has(connection.targetNodeId)) throw new Error('Connection references an unknown node');
    const outputs = resolver(source.pluginId)?.manifest.outputs ?? ['main'];
    if (!outputs.includes(connection.sourceOutput || 'main')) throw new Error(`Unknown output "${connection.sourceOutput}" on node "${source.id}"`);
  }
}
