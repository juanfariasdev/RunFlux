import type { WorkflowConnection, WorkflowDefinition, WorkflowNode } from '@runflux/workflow-model';

export function node(id: string, pluginId: string, parameters: Record<string, unknown> = {}): WorkflowNode {
  return { id, pluginId, pluginVersion: '1.0.0', parameters, position: { x: 0, y: 0 } };
}

export function edge(sourceNodeId: string, targetNodeId: string, sourceOutput = 'main'): WorkflowConnection {
  return { sourceNodeId, targetNodeId, sourceOutput, targetInput: 'main' };
}

export function workflow(nodes: WorkflowNode[], connections: WorkflowConnection[] = [], extra: Partial<WorkflowDefinition> = {}): WorkflowDefinition {
  return { id: 'fixture', name: 'Fixture', nodes, connections, ...extra };
}
