import { CyclicWorkflowError, getExecutionOrder, type WorkflowDefinition } from '@runflux/workflow-model';
import { CompilationError, type IncompatibleNode, type PluginResolver, type TargetPlatform } from '../types.js';

/**
 * Rejects workflows that cannot become a backend for a target: nodes whose plugin is missing or
 * does not support the target, duplicate node ids, connections to unknown nodes or outputs, and
 * cycles.
 */
export class WorkflowValidator {
  constructor(private readonly plugins: PluginResolver) {}

  validate(workflow: WorkflowDefinition, target: TargetPlatform): void {
    this.checkCompatibility(workflow, target);
    this.checkReferences(workflow);
    try {
      getExecutionOrder(workflow.nodes, workflow.connections);
    } catch (error) {
      if (error instanceof CyclicWorkflowError) throw new CompilationError('CYCLE_DETECTED', error.message);
      throw error;
    }
  }

  incompatibleNodes(workflow: WorkflowDefinition, target: TargetPlatform): IncompatibleNode[] {
    return workflow.nodes
      .filter((node) => !this.plugins(node.pluginId)?.manifest.supportedPlatforms.includes(target))
      .map((node) => ({ nodeId: node.id, pluginId: node.pluginId, targetPlatform: target }));
  }

  private checkCompatibility(workflow: WorkflowDefinition, target: TargetPlatform): void {
    const incompatibleNodes = this.incompatibleNodes(workflow, target);
    if (incompatibleNodes.length > 0) {
      throw new CompilationError(
        'INCOMPATIBLE_NODES',
        `Workflow contains ${incompatibleNodes.length} node(s) without support for target platform '${target}'.`,
        { incompatibleNodes },
      );
    }
  }

  private checkReferences(workflow: WorkflowDefinition): void {
    const nodes = new Map<string, WorkflowDefinition['nodes'][number]>();
    for (const node of workflow.nodes) {
      if (!node.id || nodes.has(node.id)) throw new CompilationError('INVALID_WORKFLOW', `Duplicate or empty node ID "${node.id}"`);
      nodes.set(node.id, node);
    }
    for (const connection of workflow.connections) {
      const source = nodes.get(connection.sourceNodeId);
      if (!source || !nodes.has(connection.targetNodeId)) {
        throw new CompilationError('INVALID_WORKFLOW', `Connection ${connection.sourceNodeId} -> ${connection.targetNodeId} references an unknown node`);
      }
      const outputs = this.plugins(source.pluginId)?.manifest.outputs ?? ['main'];
      const output = connection.sourceOutput || 'main';
      if (!outputs.includes(output)) throw new CompilationError('INVALID_WORKFLOW', `Unknown output "${output}" on node "${source.id}"`);
    }
  }
}
