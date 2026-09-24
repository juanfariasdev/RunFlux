import { CyclicWorkflowError, getExecutionOrder, type WorkflowDefinition } from '@runflux/workflow-model';
import { CompilationError, type IncompatibleNode, type PluginResolver, type TargetPlatform } from '../types.js';

/**
 * Rejects workflows that cannot become a backend for a target: nodes whose plugin is missing or
 * does not support the target, duplicate node ids, connections to unknown nodes or outputs, and
 * cycles.
 */
export class WorkflowValidator {
  private readonly plugins: PluginResolver;

  constructor(plugins: PluginResolver) {
    this.plugins = plugins;
  }

  validate(workflow: WorkflowDefinition, target: TargetPlatform): void {
    this.checkShape(workflow);
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

  /** Requests arrive as JSON: the lists must be lists of objects before anything reads them. */
  private checkShape(workflow: WorkflowDefinition): void {
    const isObjectList = (value: unknown) => Array.isArray(value) && value.every((item) => item !== null && typeof item === 'object');
    if (!isObjectList(workflow?.nodes) || !isObjectList(workflow?.connections)) {
      throw new CompilationError('INVALID_WORKFLOW', 'The workflow must have a list of nodes and a list of connections');
    }
    for (const node of workflow.nodes) {
      if (typeof node.pluginId !== 'string' || node.pluginId === '') throw new CompilationError('INVALID_WORKFLOW', `Node "${String(node.id)}" has no plugin`);
      if (node.parameters !== undefined && (node.parameters === null || typeof node.parameters !== 'object' || Array.isArray(node.parameters))) {
        throw new CompilationError('INVALID_WORKFLOW', `The parameters of node "${node.id}" must be an object`);
      }
    }
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
