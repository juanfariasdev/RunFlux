import type { ExecutionMode, NodeDefinition } from '../contracts/node.js';
import type { RunRequest, WorkflowRunner } from '../contracts/runner.js';
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
import { NEVER_ABORTED } from './signals.js';
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

export interface NodeRunRequest {
  /** Earlier records; the node's parents provide its input and its ancestors `$node`. */
  readonly previous?: Iterable<NodeRecord>;
  readonly signal?: AbortSignal;
}

export class EngineDisposedError extends Error {
  constructor() {
    super('The workflow engine was disposed');
    this.name = 'EngineDisposedError';
  }
}

/** Runs a workflow, or single nodes of it, with the node types of a catalog. */
export class WorkflowEngine implements WorkflowRunner {
  readonly workflow: ExecutableWorkflow;
  private readonly graph: WorkflowGraph;
  private readonly executor: NodeExecutor;
  private readonly services: RuntimeServices;
  private readonly active = new Set<Promise<unknown>>();
  private disposal?: Promise<void>;

  constructor(workflow: ExecutableWorkflow, catalog: NodeCatalog, options: WorkflowEngineOptions = {}) {
    this.workflow = workflow;
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

  run(request: RunRequest = {}): Promise<WorkflowExecution> {
    return this.track(async () => {
      const startedAt = this.timestamp();
      const triggers = this.graph.triggers(request.triggerId);
      const records = await new WorkflowRun(this.graph, this.executor, triggers, request.payload, request.signal, request.targetNodeId).execute();
      return new WorkflowExecution(this.graph, records, startedAt, this.timestamp(), request.signal?.aborted ?? false);
    });
  }

  /**
   * Runs one node with the records of earlier runs: its input comes from its parents' records
   * (null for a parent without a successful one) and `$node` from its ancestors' records.
   */
  runNode(nodeId: string, request: NodeRunRequest = {}): Promise<NodeRecord> {
    return this.track(async () => {
      const node = this.graph.node(nodeId);
      const records = new Map([...request.previous ?? []].filter((record) => record.error === null).map((record) => [record.nodeId, record]));
      const parents = this.graph.incoming(nodeId).map((connection) => records.get(connection.source)?.output ?? null);
      const input = parents.length === 0 ? undefined : parents.length === 1 ? parents[0] : parents;
      const ancestors = [...this.graph.ancestors(nodeId)].flatMap((id) => records.get(id) ?? []);
      const outputs = nodeOutputsOf(ancestors, (id) => this.graph.node(id).label);
      return this.executor.execute(node, input, outputs, request.signal ?? NEVER_ABORTED);
    });
  }

  /**
   * Waits for the runs in progress, then releases the resources the node handlers hold, such as
   * database pools. Later runs are refused. The composition root that created the engine owns
   * this call, not the hosts serving it.
   */
  dispose(): Promise<void> {
    this.disposal ??= (async () => {
      await Promise.allSettled([...this.active]);
      await this.executor.dispose();
    })();
    return this.disposal;
  }

  private track<TResult>(work: () => Promise<TResult>): Promise<TResult> {
    if (this.disposal) return Promise.reject(new EngineDisposedError());
    const running = work();
    this.active.add(running);
    void running.finally(() => this.active.delete(running)).catch(() => {});
    return running;
  }

  private timestamp(): string {
    return this.services.clock.now().toISOString();
  }
}
