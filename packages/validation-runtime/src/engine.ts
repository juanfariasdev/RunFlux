import {
  ExecutableWorkflowBuilder,
  MAIN_OUTPUT,
  WorkflowEngine,
  type ExecutionMode,
  type ExecutionStatus,
  type NodeRecord,
  type RuntimeServices,
} from '@runflux/runtime';
import type { PluginRegistry } from '@runflux/plugin-system/plugin-registry';
import type { WorkflowDefinition } from '@runflux/workflow-model/types';

export type PluginExecutionMode = ExecutionMode;

export interface ValidationRunOptions {
  mode: PluginExecutionMode;
  /**
   * Services for this run. The editor passes its webhook test hub as `triggerEvents`, so webhook
   * triggers wait for a real test request instead of using their sample payload.
   */
  services?: Partial<RuntimeServices>;
  /** Cancels the run, for instance when the editor closes the request that started it. */
  signal?: AbortSignal;
}

/** What the editor shows for one node after a test run. */
export interface NodeResult {
  nodeId: string;
  input: unknown;
  output: unknown | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface ValidationRun {
  workflowId: string;
  mode: PluginExecutionMode;
  nodeResults: NodeResult[];
  startedAt: string;
  finishedAt: string;
  /** Status of the nodes that ran; see `cancelled` for whether the run was stopped early. */
  status: ExecutionStatus;
  cancelled: boolean;
}

/** Runs `work` with an engine for this one run, releasing the handlers' resources afterwards. */
async function withEngine<TResult>(
  workflow: WorkflowDefinition,
  registry: PluginRegistry,
  options: ValidationRunOptions,
  work: (engine: WorkflowEngine) => Promise<TResult>,
): Promise<TResult> {
  const document = new ExecutableWorkflowBuilder(registry.describe).build(workflow);
  const engine = new WorkflowEngine(document, registry, { mode: options.mode, services: options.services });
  try {
    return await work(engine);
  } finally {
    await engine.dispose();
  }
}

function toNodeResult(record: NodeRecord): NodeResult {
  return {
    nodeId: record.nodeId,
    input: record.input,
    output: record.output ?? null,
    error: record.error,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
  };
}

function toNodeRecord(result: NodeResult): NodeRecord {
  return { ...result, activeOutput: MAIN_OUTPUT, finishedAt: result.finishedAt ?? result.startedAt };
}

/**
 * Runs a whole workflow locally (RF-01) with the same engine exported backends use. Only nodes
 * reachable from a trigger run (RN-07); a failure stops only its own descendants (RN-02); triggers
 * of the same plugin race each other (RN-08). Nothing is compiled or deployed (RN-01).
 */
export async function runWorkflow(workflow: WorkflowDefinition, registry: PluginRegistry, options: ValidationRunOptions): Promise<ValidationRun> {
  const execution = await withEngine(workflow, registry, options, (engine) => engine.run({ signal: options.signal }));
  return {
    workflowId: workflow.id,
    mode: options.mode,
    nodeResults: execution.records.map(toNodeResult),
    startedAt: execution.startedAt,
    finishedAt: execution.finishedAt,
    status: execution.status,
    cancelled: execution.cancelled,
  };
}

/**
 * Runs a single node in isolation (RF-04), with the last known outputs of its upstream nodes from
 * `cache` (RN-03). A parent that was never tested contributes null instead of blocking (RN-06).
 */
export async function runNode(
  workflow: WorkflowDefinition,
  nodeId: string,
  registry: PluginRegistry,
  options: ValidationRunOptions,
  cache: Map<string, NodeResult> = new Map(),
): Promise<NodeResult> {
  const previous = [...cache.values()].map(toNodeRecord);
  const record = await withEngine(workflow, registry, options, (engine) => engine.runNode(nodeId, { previous, signal: options.signal }));
  return toNodeResult(record);
}
