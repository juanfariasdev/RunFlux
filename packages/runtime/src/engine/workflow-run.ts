import type { ExecutableNode } from '../workflow/executable-workflow.js';
import type { WorkflowGraph } from '../workflow/workflow-graph.js';
import type { NodeExecutor } from './node-executor.js';
import { nodeOutputsOf, type NodeRecord } from './node-record.js';
import { anySignal } from './signals.js';

/**
 * The state of one workflow run. Every node waits only for its own parents, so independent
 * branches run concurrently. A node runs when at least one parent activated the connection to it;
 * it is skipped when a parent failed or none did. With no parents it receives the run's payload,
 * with one its parent's output, with several the list of the active parents' outputs. `$node`
 * holds the outputs of the node's ancestors only, so it never depends on the timing of parallel
 * branches.
 *
 * Triggers of the same plugin race each other: once one settles, the others are cancelled and left
 * out of the run, so a run started for several webhooks finishes when any one of them is called.
 * Once the run's own signal aborts, no further node starts.
 */
export class WorkflowRun {
  private readonly records = new Map<string, NodeRecord>();
  private readonly pending = new Map<string, Promise<void>>();
  private readonly races = new Map<string, AbortController>();
  private readonly reachable: ReadonlySet<string>;

  private readonly graph: WorkflowGraph;
  private readonly executor: NodeExecutor;
  private readonly triggers: readonly ExecutableNode[];
  private readonly payload: unknown;
  private readonly signal: AbortSignal | undefined;

  constructor(graph: WorkflowGraph, executor: NodeExecutor, triggers: readonly ExecutableNode[], payload: unknown, signal?: AbortSignal, targetNodeId?: string) {
    this.graph = graph;
    this.executor = executor;
    this.payload = payload;
    this.signal = signal;
    const reachableFromTriggers = graph.reachableFrom(triggers.map((trigger) => trigger.id));
    if (targetNodeId === undefined) {
      this.reachable = reachableFromTriggers;
      this.triggers = triggers;
      return;
    }

    graph.node(targetNodeId);
    const required = new Set([...graph.ancestors(targetNodeId), targetNodeId]);
    this.reachable = new Set([...reachableFromTriggers].filter((nodeId) => required.has(nodeId)));
    this.triggers = triggers.filter((trigger) => this.reachable.has(trigger.id));
  }

  async execute(): Promise<NodeRecord[]> {
    const races = this.raceGroups();
    const all = Promise.all([...this.reachable].map((nodeId) => this.run(nodeId)));
    await Promise.all(races.map(async ([controller, nodeIds]) => {
      await Promise.race(nodeIds.map((nodeId) => this.run(nodeId)));
      controller.abort();
    }));
    await all;
    return [...this.records.values()];
  }

  private raceGroups(): Array<[AbortController, string[]]> {
    const byPlugin = new Map<string, string[]>();
    for (const trigger of this.triggers) byPlugin.set(trigger.pluginId, [...byPlugin.get(trigger.pluginId) ?? [], trigger.id]);
    return [...byPlugin.values()].filter((nodeIds) => nodeIds.length > 1).map((nodeIds) => {
      const controller = new AbortController();
      for (const nodeId of nodeIds) this.races.set(nodeId, controller);
      return [controller, nodeIds];
    });
  }

  private run(nodeId: string): Promise<void> {
    if (!this.reachable.has(nodeId)) return Promise.resolve();
    let pending = this.pending.get(nodeId);
    if (!pending) {
      pending = this.runOnce(nodeId);
      this.pending.set(nodeId, pending);
    }
    return pending;
  }

  private async runOnce(nodeId: string): Promise<void> {
    const parents = this.graph.incoming(nodeId);
    await Promise.all(parents.map((connection) => this.run(connection.source)));
    if (this.signal?.aborted) return;
    if (parents.some((connection) => this.failed(connection.source))) return;
    const active = parents.filter((connection) => this.records.get(connection.source)?.activeOutput === connection.sourceOutput);
    if (parents.length > 0 && active.length === 0) return;

    const node = this.graph.node(nodeId);
    const outputs = active.map((connection) => this.records.get(connection.source)!.output);
    const input = parents.length === 0 ? this.payload : outputs.length === 1 ? outputs[0] : outputs;
    const race = this.races.get(nodeId)?.signal;
    const record = await this.executor.execute(node, input, this.ancestorOutputs(nodeId), anySignal([this.signal, race]));
    // A trigger that lost its race did not start this run: leave it out instead of failing it.
    if (record.error !== null && race?.aborted) return;
    this.records.set(nodeId, record);
  }

  private ancestorOutputs(nodeId: string) {
    const ancestors = [...this.graph.ancestors(nodeId)].flatMap((id) => this.records.get(id) ?? []);
    return nodeOutputsOf(ancestors, (id) => this.graph.node(id).label);
  }

  private failed(nodeId: string): boolean {
    const record = this.records.get(nodeId);
    return record !== undefined && record.error !== null;
  }
}
