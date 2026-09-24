import type { ExecutionMode, NodeDefinition } from '../contracts/node.js';
import type { RuntimeServices } from '../contracts/services.js';
import { systemEnvironment, type EnvironmentVariables } from '../environment.js';
import { ExpressionEvaluator } from '../expressions/expression-evaluator.js';
import { ParameterResolver } from '../expressions/parameter-resolver.js';
import { createRuntimeServices } from '../services/default-services.js';
import { parseExecutableWorkflow, type ExecutableWorkflow } from '../workflow/executable-workflow.js';
import { WorkflowGraph } from '../workflow/workflow-graph.js';
import { StaticNodeCatalog, type NodeCatalog } from './node-catalog.js';
import { NodeExecutor } from './node-executor.js';
import { nodeOutputsOf, type NodeRecord } from './node-record.js';
import { WorkflowExecution } from './workflow-execution.js';
import { WorkflowRun } from './workflow-run.js';

export interface WorkflowEngineOptions {
  /** Defaults to `production`; the editor's test runs use `sandbox`. */
  readonly mode?: ExecutionMode;
  readonly services?: Partial<RuntimeServices>;
  /** `$env` of every node. Defaults to the host process environment. */
  readonly environment?: EnvironmentVariables;
  readonly expressions?: ExpressionEvaluator;
}

export interface RunRequest {
  /** What the starting triggers receive as input. */
  readonly payload?: unknown;
  /** Start only this trigger; all triggers start when omitted. */
  readonly triggerId?: string;
}

const NEVER_ABORTED = new AbortController().signal;

/** Runs a workflow, or single nodes of it, with the node types of a catalog. */
export class WorkflowEngine {
  private readonly graph: WorkflowGraph;
  private readonly executor: NodeExecutor;
  private readonly services: RuntimeServices;

  constructor(
    readonly workflow: ExecutableWorkflow,
    catalog: NodeCatalog,
    options: WorkflowEngineOptions = {},
  ) {
    this.graph = new WorkflowGraph(workflow);
    this.services = createRuntimeServices(options.services);
    this.executor = new NodeExecutor(catalog, this.services, new ParameterResolver(options.expressions ?? new ExpressionEvaluator()), {
      workflowId: workflow.id,
      mode: options.mode ?? 'production',
      environment: options.environment ?? systemEnvironment(),
    });
  }

  /** Validates `document` (typically an exported `workflow.json`) and creates its engine. */
  static fromDocument(
    document: unknown,
    plugins: NodeCatalog | Readonly<Record<string, NodeDefinition>>,
    options?: WorkflowEngineOptions,
  ): WorkflowEngine {
    const catalog = typeof plugins.resolve === 'function' ? (plugins as NodeCatalog) : new StaticNodeCatalog(plugins as Readonly<Record<string, NodeDefinition>>);
    return new WorkflowEngine(parseExecutableWorkflow(document), catalog, options);
  }

  async run(request: RunRequest = {}): Promise<WorkflowExecution> {
    const startedAt = this.timestamp();
    const records = await new WorkflowRun(this.graph, this.executor, this.graph.triggers(request.triggerId), request.payload).execute();
    return new WorkflowExecution(this.graph, records, startedAt, this.timestamp());
  }

  /**
   * Runs one node with the outputs of earlier runs: its input comes from the records of its parents
   * (null for a parent without one) and `$node` from all given records.
   */
  async runNode(nodeId: string, previous: Iterable<NodeRecord> = []): Promise<NodeRecord> {
    const node = this.graph.node(nodeId);
    const records = new Map([...previous].map((record) => [record.nodeId, record]));
    const parents = this.graph.incoming(nodeId).map((connection) => records.get(connection.source)?.output ?? null);
    const input = parents.length === 0 ? undefined : parents.length === 1 ? parents[0] : parents;
    const outputs = nodeOutputsOf(records.values(), (id) => this.graph.nodes.find((candidate) => candidate.id === id)?.label);
    return this.executor.execute(node, input, outputs, NEVER_ABORTED);
  }

  /** Releases the resources the node handlers hold, such as database pools. */
  dispose(): Promise<void> {
    return this.executor.dispose();
  }

  private timestamp(): string {
    return this.services.clock.now().toISOString();
  }
}
