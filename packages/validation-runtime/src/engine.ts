import { resolveExpressions } from '@runflux/expression-engine';
import { resolveExecutor } from '@runflux/plugin-system/api/resolve-executor';
import type { PluginRegistry } from '@runflux/plugin-system/plugin-registry';
import type { WorkflowConnection, WorkflowDefinition } from '@runflux/workflow-model/types';
import { getExecutionOrder } from './topological-order';

export type PluginExecutionMode = 'sandbox' | 'production';

export interface ValidationRunOptions {
  mode: PluginExecutionMode;
}

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
  status: 'success' | 'error' | 'partial';
}

/**
 * Resolves what a node receives as input from its upstream connection(s):
 * `undefined` for a node with no upstream (e.g. a trigger), the single
 * upstream's output for exactly one incoming connection, or an array of
 * outputs for more than one (RF-01/RF-02).
 */
function resolveInput(
  incoming: WorkflowConnection[],
  resultsByNodeId: Map<string, NodeResult>,
  fallback: unknown = null,
): unknown {
  if (incoming.length === 0) return undefined;
  const outputs = incoming.map((c) => resultsByNodeId.get(c.sourceNodeId)?.output ?? fallback);
  return incoming.length === 1 ? outputs[0] : outputs;
}

interface ExecuteNodeResult extends Pick<NodeResult, 'output' | 'error'> {
  /**
   * Output ports this execution activated (004-core-nodes-catalog, D-03/D-04).
   * `['main']` for a plugin without `manifest.outputs` (legacy: one implicit,
   * always-active output) or `[]` when the node errored or explicitly
   * activated no output (`activeOutput: null`, RN-02).
   */
  activeOutputs: string[];
}

async function executeNode(
  pluginId: string,
  params: Record<string, unknown>,
  input: unknown,
  registry: PluginRegistry,
  context: { workflowId: string; nodeId: string; mode: PluginExecutionMode },
): Promise<ExecuteNodeResult> {
  const executor = resolveExecutor(registry, pluginId);
  if (!executor) {
    return { output: null, error: `Plugin "${pluginId}" does not support local execution`, activeOutputs: [] };
  }
  const manifest = registry.getManifest(pluginId);
  try {
    // D-02: expressions resolve here, once, for every plugin — a plugin's
    // execute() always receives already-resolved parameters, never a raw {{ }}.
    const resolvedParams = resolveExpressions(params, { $json: input });
    const raw = await executor(resolvedParams, input, context);
    if (!manifest?.outputs) {
      return { output: raw ?? null, error: null, activeOutputs: ['main'] };
    }
    // Named-output plugin (D-03): the executor returns { value, activeOutput }
    // instead of a raw value — the manifest is the discriminator, not the shape.
    const wrapped = raw as { value: unknown; activeOutput: string | null } | null | undefined;
    const activeOutputs = wrapped?.activeOutput != null ? [wrapped.activeOutput] : [];
    return { output: wrapped?.value ?? null, error: null, activeOutputs };
  } catch (err) {
    return { output: null, error: (err as Error).message, activeOutputs: [] };
  }
}

/**
 * Runs a whole workflow locally, node by node in topological order (RF-01).
 * A node error does not abort the run: it stops propagation to that node's
 * downstream nodes only, while every already-computed result stays in
 * `nodeResults` (RN-02). Never generates or touches real infrastructure
 * (RN-01) — this only ever calls each plugin's `execute`, never `generators`.
 */
export async function runWorkflow(
  workflow: WorkflowDefinition,
  registry: PluginRegistry,
  options: ValidationRunOptions,
): Promise<ValidationRun> {
  const startedAt = new Date().toISOString();
  const order = getExecutionOrder(workflow.nodes, workflow.connections);
  const resultsByNodeId = new Map<string, NodeResult>();
  const activeOutputsByNodeId = new Map<string, string[]>();

  for (const node of order) {
    const incoming = workflow.connections.filter((c) => c.targetNodeId === node.id);
    const upstreamFailed = incoming.some((c) => resultsByNodeId.get(c.sourceNodeId)?.error != null);
    if (upstreamFailed) {
      continue; // RN-02: propagation stops here, this node is never executed
    }

    // D-04/RN-05: only a connection whose sourceOutput is one of its source
    // node's active outputs contributes to this node's input. A node with at
    // least one active incoming connection still executes (fan-in preserved,
    // RN-02); one with incoming connections but none active is skipped, same
    // as an upstream error, but without recording one.
    const activeIncoming = incoming.filter((c) => (activeOutputsByNodeId.get(c.sourceNodeId) ?? []).includes(c.sourceOutput));
    if (incoming.length > 0 && activeIncoming.length === 0) {
      continue;
    }

    const input = resolveInput(activeIncoming, resultsByNodeId);
    const nodeStartedAt = new Date().toISOString();
    const { output, error, activeOutputs } = await executeNode(node.pluginId, node.parameters, input, registry, {
      workflowId: workflow.id,
      nodeId: node.id,
      mode: options.mode,
    });
    resultsByNodeId.set(node.id, {
      nodeId: node.id,
      input,
      output,
      error,
      startedAt: nodeStartedAt,
      finishedAt: new Date().toISOString(),
    });
    activeOutputsByNodeId.set(node.id, activeOutputs);
  }

  const nodeResults = [...resultsByNodeId.values()];
  const firstErrorIndex = nodeResults.findIndex((r) => r.error !== null);
  const status: ValidationRun['status'] =
    firstErrorIndex === -1 ? 'success' : firstErrorIndex === 0 ? 'error' : 'partial';

  return {
    workflowId: workflow.id,
    mode: options.mode,
    nodeResults,
    startedAt,
    finishedAt: new Date().toISOString(),
    status,
  };
}

/**
 * Runs a single node in isolation (RF-04). Reuses the last known output of
 * its upstream node(s) from `cache` when available (RN-03); when the
 * upstream was never tested, runs anyway with a `null` input instead of
 * blocking (RN-06).
 */
export async function runNode(
  workflow: WorkflowDefinition,
  nodeId: string,
  registry: PluginRegistry,
  options: ValidationRunOptions,
  cache: Map<string, NodeResult> = new Map(),
): Promise<NodeResult> {
  const node = workflow.nodes.find((n) => n.id === nodeId);
  if (!node) {
    throw new Error(`Unknown node "${nodeId}" in workflow "${workflow.id}"`);
  }

  const incoming = workflow.connections.filter((c) => c.targetNodeId === nodeId);
  const input = resolveInput(incoming, cache);
  const startedAt = new Date().toISOString();
  const { output, error } = await executeNode(node.pluginId, node.parameters, input, registry, {
    workflowId: workflow.id,
    nodeId: node.id,
    mode: options.mode,
  });

  return { nodeId, input, output, error, startedAt, finishedAt: new Date().toISOString() };
}
