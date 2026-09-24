import { MAIN_OUTPUT } from '../contracts/node.js';
import { WORKFLOW_SCHEMA_VERSION, type ExecutableNode, type ExecutableWorkflow } from './executable-workflow.js';
import { NO_TRIGGERS, type WorkflowTriggers } from './triggers.js';

/** The parts of an editor workflow the engine needs. A `WorkflowDefinition` satisfies it. */
export interface WorkflowSource {
  readonly id: string;
  readonly name: string;
  readonly nodes: readonly {
    readonly id: string;
    readonly pluginId: string;
    readonly parameters?: Readonly<Record<string, unknown>>;
    readonly appearance?: { readonly label?: string };
  }[];
  readonly connections: readonly {
    readonly sourceNodeId: string;
    readonly sourceOutput?: string;
    readonly targetNodeId: string;
    readonly targetInput?: string;
  }[];
}

/** What the builder needs to know about a node type. A `PluginManifest` satisfies it. */
export interface NodeTypeDescription {
  readonly category: string;
  readonly outputs?: readonly string[];
  readonly parameters: readonly { readonly name: string; readonly expressions?: boolean }[];
}

export type NodeTypeLookup = (pluginId: string) => NodeTypeDescription | undefined;

/**
 * Turns an editor workflow into the document the engine runs. Connections to nodes that do not
 * exist are dropped; nodes of unknown types are kept so the engine can report them when they run.
 */
export class ExecutableWorkflowBuilder {
  private readonly describe: NodeTypeLookup;

  constructor(describe: NodeTypeLookup) {
    this.describe = describe;
  }

  build(source: WorkflowSource, triggers: WorkflowTriggers = NO_TRIGGERS): ExecutableWorkflow {
    const nodeIds = new Set(source.nodes.map((node) => node.id));
    return {
      schemaVersion: WORKFLOW_SCHEMA_VERSION,
      id: source.id,
      name: source.name,
      nodes: source.nodes.map((node) => this.buildNode(node)),
      connections: source.connections
        .filter((connection) => nodeIds.has(connection.sourceNodeId) && nodeIds.has(connection.targetNodeId))
        .map((connection) => ({
          source: connection.sourceNodeId,
          sourceOutput: connection.sourceOutput || MAIN_OUTPUT,
          target: connection.targetNodeId,
          targetInput: connection.targetInput || MAIN_OUTPUT,
        })),
      triggers,
    };
  }

  private buildNode(node: WorkflowSource['nodes'][number]): ExecutableNode {
    const type = this.describe(node.pluginId);
    return {
      id: node.id,
      ...(node.appearance?.label ? { label: node.appearance.label } : {}),
      pluginId: node.pluginId,
      trigger: type?.category === 'trigger',
      outputs: type?.outputs?.length ? [...type.outputs] : [MAIN_OUTPUT],
      parameters: node.parameters ?? {},
      literalParameters: (type?.parameters ?? []).filter((parameter) => parameter.expressions === false).map((parameter) => parameter.name),
    };
  }
}
