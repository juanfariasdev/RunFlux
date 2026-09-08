import { resolveExpressions } from '@runflux/expression-engine';
import { resolveExecutor } from '@runflux/plugin-system/api/resolve-executor';
import type { PluginRegistry } from '@runflux/plugin-system/plugin-registry';
import type { PluginExecutionContext } from '@runflux/plugin-system/types';
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
  context: PluginExecutionContext,
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
 * A whole-workflow run only ever starts from an actual trigger — a node with
 * no incoming connection but whose plugin isn't `category: 'trigger'` (e.g. an
 * action node dropped on the canvas and never wired up) is not a valid entry
 * point, just disconnected, and must not run at all. Reachability is computed
 * from every trigger forward through `connections`, independent of topological
 * order or in-degree (RF-01, RN-07).
 */
function computeReachableFromTriggers(workflow: WorkflowDefinition, registry: PluginRegistry): Set<string> {
  const triggerIds = workflow.nodes
    .filter((node) => registry.getManifest(node.pluginId)?.category === 'trigger')
    .map((node) => node.id);

  const outgoing = new Map<string, string[]>();
  for (const connection of workflow.connections) {
    const list = outgoing.get(connection.sourceNodeId) ?? [];
    list.push(connection.targetNodeId);
    outgoing.set(connection.sourceNodeId, list);
  }

  const reachable = new Set<string>(triggerIds);
  const queue = [...triggerIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const nextId of outgoing.get(current) ?? []) {
      if (!reachable.has(nextId)) {
        reachable.add(nextId);
        queue.push(nextId);
      }
    }
  }
  return reachable;
}

/**
 * Runs a whole workflow locally (RF-01). Only nodes reachable from an actual
 * trigger ever execute (RN-07) — an island of action nodes with nothing
 * feeding them is silently skipped, not treated as its own starting point.
 *
 * Each node waits only for its OWN upstream connections, then runs — it does
 * NOT wait its turn in some single global order. Two independent trigger
 * branches (e.g. two unrelated Webhook Triggers) therefore execute fully
 * concurrently: a long wait on one (up to 120s for a real HTTP request, same
 * as testing it in isolation) never blocks the other from starting, and each
 * resolves on its own regardless of which one a caller interacts with first.
 *
 * With more than one trigger OF THE SAME PLUGIN TYPE (e.g. two Webhook
 * Triggers), the run doesn't wait for every one of them — it races that
 * group (RN-08): the moment any one settles, `signal` fires for every other
 * still-pending trigger sharing its plugin id, so it can abandon its wait
 * instead of the caller having to satisfy every one of them just to see a
 * result. This never crosses plugin types: a Manual Trigger firing instantly
 * must not cancel an unrelated Webhook Trigger's legitimate wait just because
 * it happened to settle first — each plugin type's triggers only race their
 * own siblings. A plugin that doesn't check `signal` is unaffected either way.
 *
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
  // Purely a defensive guard (D-06): 002-workflow-editor already prevents cycles at edit
  // time, but a residual one here would otherwise deadlock the scheduler below forever
  // instead of throwing a clear error — its own `order` return value goes unused.
  getExecutionOrder(workflow.nodes, workflow.connections);

  const reachableFromTrigger = computeReachableFromTriggers(workflow, registry);
  const byId = new Map(workflow.nodes.map((node) => [node.id, node]));
  const incomingByNode = new Map<string, WorkflowConnection[]>();
  for (const connection of workflow.connections) {
    if (!byId.has(connection.sourceNodeId) || !byId.has(connection.targetNodeId)) continue;
    const list = incomingByNode.get(connection.targetNodeId) ?? [];
    list.push(connection);
    incomingByNode.set(connection.targetNodeId, list);
  }

  const resultsByNodeId = new Map<string, NodeResult>();
  const activeOutputsByNodeId = new Map<string, string[]>();
  const started = new Map<string, Promise<void>>();

  // A shared AbortController per plugin id that has more than one reachable trigger
  // instance — e.g. two 'trigger-webhook' nodes get one controller between them, a
  // lone 'trigger-manual-example' gets none. Scoping by plugin id (not just "is a
  // trigger") is what keeps different trigger types from cancelling each other.
  const controllerByNodeId = new Map<string, AbortController>();
  const triggerNodeIdsByPlugin = new Map<string, string[]>();
  for (const node of workflow.nodes) {
    if (!reachableFromTrigger.has(node.id)) continue;
    if (registry.getManifest(node.pluginId)?.category !== 'trigger') continue;
    const list = triggerNodeIdsByPlugin.get(node.pluginId) ?? [];
    list.push(node.id);
    triggerNodeIdsByPlugin.set(node.pluginId, list);
  }
  const raceGroups: string[][] = [];
  for (const nodeIds of triggerNodeIdsByPlugin.values()) {
    if (nodeIds.length <= 1) continue; // nothing to race against
    raceGroups.push(nodeIds);
    const controller = new AbortController();
    for (const id of nodeIds) controllerByNodeId.set(id, controller);
  }

  function run(nodeId: string): Promise<void> {
    const existing = started.get(nodeId);
    if (existing) return existing; // fan-in: shared upstream runs exactly once

    const node = byId.get(nodeId)!;
    const incoming = incomingByNode.get(nodeId) ?? [];

    const promise = (async () => {
      await Promise.all(incoming.map((c) => run(c.sourceNodeId)));

      const upstreamFailed = incoming.some((c) => resultsByNodeId.get(c.sourceNodeId)?.error != null);
      if (upstreamFailed) return; // RN-02: propagation stops here, this node is never executed

      // D-04/RN-05: only a connection whose sourceOutput is one of its source
      // node's active outputs contributes to this node's input. A node with at
      // least one active incoming connection still executes (fan-in preserved,
      // RN-02); one with incoming connections but none active is skipped, same
      // as an upstream error, but without recording one.
      const activeIncoming = incoming.filter((c) => (activeOutputsByNodeId.get(c.sourceNodeId) ?? []).includes(c.sourceOutput));
      if (incoming.length > 0 && activeIncoming.length === 0) return;

      const input = resolveInput(activeIncoming, resultsByNodeId);
      const nodeStartedAt = new Date().toISOString();
      const { output, error, activeOutputs } = await executeNode(node.pluginId, node.parameters, input, registry, {
        workflowId: workflow.id,
        nodeId: node.id,
        mode: options.mode,
        signal: controllerByNodeId.get(node.id)?.signal,
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
    })();

    started.set(nodeId, promise);
    return promise;
  }

  const reachableNodeIds = workflow.nodes.filter((node) => reachableFromTrigger.has(node.id)).map((node) => node.id);

  const allSettled = Promise.all(reachableNodeIds.map(run));
  // RN-08: within each same-plugin-type group, one firing is enough — abort that
  // group's shared signal so its still-pending siblings stop waiting. Independent
  // of and unaffected by every other group (different trigger types never race).
  await Promise.all(raceGroups.map(async (nodeIds) => {
    await Promise.race(nodeIds.map(run));
    controllerByNodeId.get(nodeIds[0])!.abort();
  }));
  await allSettled;

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
