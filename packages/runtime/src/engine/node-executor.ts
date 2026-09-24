import type { ExecutionMode, NodeContext, NodeDefinition, NodeHandler, NodeOutput } from '../contracts/node.js';
import type { RuntimeServices } from '../contracts/services.js';
import type { EnvironmentVariables } from '../environment.js';
import { createNodeScope } from '../expressions/node-scope.js';
import type { ParameterResolver } from '../expressions/parameter-resolver.js';
import { ObjectParameterReader } from '../parameters/parameter-reader.js';
import type { ExecutableNode } from '../workflow/executable-workflow.js';
import type { NodeCatalog } from './node-catalog.js';
import type { NodeOutputsById, NodeRecord } from './node-record.js';

export class UnknownNodeTypeError extends Error {
  constructor(pluginId: string) {
    super(`Plugin "${pluginId}" is not installed`);
    this.name = 'UnknownNodeTypeError';
  }
}

export class InvalidNodeOutputError extends Error {
  constructor(nodeId: string, problem: string) {
    super(`Node "${nodeId}" ${problem}`);
    this.name = 'InvalidNodeOutputError';
  }
}

export interface NodeExecutorSettings {
  readonly workflowId: string;
  readonly mode: ExecutionMode;
  readonly environment: EnvironmentVariables;
}

/**
 * Runs single nodes: resolves their parameters, invokes their plugin's handler and records the
 * outcome. A failure becomes the node's recorded error; it never throws.
 */
export class NodeExecutor {
  private readonly handlers = new Map<string, NodeHandler<unknown>>();

  private readonly catalog: NodeCatalog;
  private readonly services: RuntimeServices;
  private readonly parameters: ParameterResolver;
  private readonly settings: NodeExecutorSettings;

  constructor(
    catalog: NodeCatalog,
    services: RuntimeServices,
    parameters: ParameterResolver,
    settings: NodeExecutorSettings,
  ) {
    this.catalog = catalog;
    this.services = services;
    this.parameters = parameters;
    this.settings = settings;
  }

  async execute(node: ExecutableNode, input: unknown, outputs: NodeOutputsById, signal: AbortSignal): Promise<NodeRecord> {
    const startedAt = this.timestamp();
    try {
      const output = await this.invoke(node, input, outputs, signal);
      return { nodeId: node.id, input, output: output.value, activeOutput: output.activeOutput, error: null, startedAt, finishedAt: this.timestamp() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { nodeId: node.id, input, output: null, activeOutput: null, error: message, startedAt, finishedAt: this.timestamp() };
    }
  }

  /** Releases the resources held by every handler created so far. */
  async dispose(): Promise<void> {
    const handlers = [...this.handlers.values()];
    this.handlers.clear();
    await Promise.all(handlers.map((handler) => handler.dispose?.()));
  }

  private async invoke(node: ExecutableNode, input: unknown, outputs: NodeOutputsById, signal: AbortSignal): Promise<NodeOutput> {
    const definition = this.catalog.resolve(node.pluginId);
    if (!definition) throw new UnknownNodeTypeError(node.pluginId);
    const { environment } = this.settings;
    const resolved = this.parameters.resolve(node.parameters, new Set(node.literalParameters), { $json: input, $node: outputs, $env: environment });
    const parameters = definition.parseParameters(new ObjectParameterReader(resolved, node.pluginId));
    const context: NodeContext = {
      workflowId: this.settings.workflowId,
      nodeId: node.id,
      mode: this.settings.mode,
      nodes: createNodeScope(outputs),
      env: environment,
      signal,
    };
    return checkOutput(node, await this.handler(node.pluginId, definition).execute({ parameters, input, context }));
  }

  private handler(pluginId: string, definition: NodeDefinition): NodeHandler<unknown> {
    let handler = this.handlers.get(pluginId);
    if (!handler) {
      handler = definition.createHandler(this.services);
      this.handlers.set(pluginId, handler);
    }
    return handler;
  }

  private timestamp(): string {
    return this.services.clock.now().toISOString();
  }
}

function checkOutput(node: ExecutableNode, output: unknown): NodeOutput {
  if (output === null || typeof output !== 'object' || !('value' in output) || !('activeOutput' in output)) {
    throw new InvalidNodeOutputError(node.id, 'must return a NodeOutput');
  }
  const { activeOutput } = output as NodeOutput;
  if (activeOutput !== null && !node.outputs.includes(activeOutput)) {
    throw new InvalidNodeOutputError(node.id, `activated unknown output "${String(activeOutput)}"`);
  }
  return output as NodeOutput;
}
