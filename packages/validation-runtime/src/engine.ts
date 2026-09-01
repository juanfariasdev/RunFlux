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

async function executeNode(
  pluginId: string,
  params: Record<string, unknown>,
  input: unknown,
  registry: PluginRegistry,
  context: { workflowId: string; nodeId: string; mode: PluginExecutionMode },
): Promise<Pick<NodeResult, 'output' | 'error'>> {
  const executor = resolveExecutor(registry, pluginId);
  if (!executor) {
    return { output: null, error: `Plugin "${pluginId}" does not support local execution` };
  }
  try {
    const output = await executor(params, input, context);
    return { output: output ?? null, error: null };
  } catch (err) {
    return { output: null, error: (err as Error).message };
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

  for (const node of order) {
    const incoming = workflow.connections.filter((c) => c.targetNodeId === node.id);
    const upstreamFailed = incoming.some((c) => resultsByNodeId.get(c.sourceNodeId)?.error != null);
    if (upstreamFailed) {
      continue; // RN-02: propagation stops here, this node is never executed
    }

    const input = resolveInput(incoming, resultsByNodeId);
    const nodeStartedAt = new Date().toISOString();
    const { output, error } = await executeNode(node.pluginId, node.parameters, input, registry, {
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
