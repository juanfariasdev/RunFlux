import type { EnvironmentVariables } from '../environment.js';
import type { ParameterReader } from '../parameters/parameter-reader.js';
import type { RuntimeServices } from './services.js';

/** Output port of a node that has a single, always active output. */
export const MAIN_OUTPUT = 'main';

export type ExecutionMode = 'sandbox' | 'production';

/**
 * What every node execution produces: a value and the output port that carries it.
 * A `null` port ends the branch without an error, e.g. a filter that rejected its input.
 */
export class NodeOutput {
  readonly value: unknown;
  readonly activeOutput: string | null;

  private constructor(value: unknown, activeOutput: string | null) {
    this.value = value;
    this.activeOutput = activeOutput;
  }

  /** Sends `value` through the main output. */
  static main(value: unknown): NodeOutput {
    return new NodeOutput(value, MAIN_OUTPUT);
  }

  /** Sends `value` through a named output, or ends the branch when `output` is null. */
  static route(value: unknown, output: string | null): NodeOutput {
    return new NodeOutput(value, output);
  }
}

/** `$node`: the output of every node that already ran, by node id and by label. */
export type NodeOutputs = Readonly<Record<string, { readonly json: unknown }>>;

/** What a node knows about the execution it takes part in. */
export interface NodeContext {
  readonly workflowId: string;
  readonly nodeId: string;
  readonly mode: ExecutionMode;
  /** Reading a node that did not run yields `{ json: undefined }`. */
  readonly nodes: NodeOutputs;
  readonly env: EnvironmentVariables;
  /** Aborts when the result is no longer needed, e.g. a sibling trigger fired first. */
  readonly signal: AbortSignal;
}

export interface NodeInvocation<TParameters> {
  readonly parameters: TParameters;
  readonly input: unknown;
  readonly context: NodeContext;
}

/** Executes one node type. A runtime creates one handler per type and reuses it for every execution. */
export interface NodeHandler<TParameters> {
  execute(invocation: NodeInvocation<TParameters>): NodeOutput | Promise<NodeOutput>;
  /** Releases long-lived resources, such as connection pools, when the runtime shuts down. */
  dispose?(): Promise<void>;
}

/**
 * The executable part of a plugin. The same definition runs in the editor and inside exported
 * backends; parameters reach it with their `{{ }}` expressions already resolved.
 */
export interface NodeDefinition<TParameters = unknown> {
  parseParameters(parameters: ParameterReader): TParameters;
  createHandler(services: RuntimeServices): NodeHandler<TParameters>;
}

/** Declares a node definition, inferring its parameter type from `parseParameters`. */
export function defineNode<TParameters>(definition: NodeDefinition<TParameters>): NodeDefinition<TParameters> {
  return definition;
}
