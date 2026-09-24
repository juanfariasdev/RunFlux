import type { WorkflowGraph } from '../workflow/workflow-graph.js';
import type { NodeRecord } from './node-record.js';

export type ExecutionStatus = 'success' | 'error' | 'partial';

/** The JSON body exported backends answer with. */
export interface ExecutionResponse {
  readonly success: boolean;
  /** Output of the last node of each branch: one value, a list for several branches, or null. */
  readonly result: unknown;
  readonly nodeOutputs: Record<string, unknown>;
  readonly error?: string;
}

/** The outcome of one workflow run; records are in the order nodes finished. */
export class WorkflowExecution {
  private readonly graph: WorkflowGraph;
  readonly records: readonly NodeRecord[];
  readonly startedAt: string;
  readonly finishedAt: string;

  constructor(
    graph: WorkflowGraph,
    records: readonly NodeRecord[],
    startedAt: string,
    finishedAt: string,
  ) {
    this.graph = graph;
    this.records = records;
    this.startedAt = startedAt;
    this.finishedAt = finishedAt;
  }

  get workflowId(): string {
    return this.graph.workflow.id;
  }

  /** `error` when the first node to finish failed, `partial` when a later one did. */
  get status(): ExecutionStatus {
    const firstError = this.records.findIndex((record) => record.error !== null);
    if (firstError === -1) return 'success';
    return firstError === 0 ? 'error' : 'partial';
  }

  get succeeded(): boolean {
    return this.status === 'success';
  }

  /** The error of the first node that failed. */
  get error(): string | undefined {
    return this.records.find((record) => record.error !== null)?.error ?? undefined;
  }

  record(nodeId: string): NodeRecord | undefined {
    return this.records.find((record) => record.nodeId === nodeId);
  }

  /** Outputs of the nodes that succeeded, by node id. */
  outputs(): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};
    for (const record of this.successful().values()) outputs[record.nodeId] = record.output;
    return outputs;
  }

  /** Output of each node whose active output reached no node that ran. */
  result(): unknown {
    const successful = this.successful();
    const leaves = this.graph.nodes.filter((node) => {
      const record = successful.get(node.id);
      return record !== undefined && !this.graph.outgoing(node.id).some(
        (connection) => connection.sourceOutput === record.activeOutput && successful.has(connection.target),
      );
    });
    if (leaves.length === 0) return null;
    return leaves.length === 1 ? successful.get(leaves[0].id)!.output : leaves.map((node) => successful.get(node.id)!.output);
  }

  toResponse(): ExecutionResponse {
    const nodeOutputs = this.outputs();
    return this.succeeded
      ? { success: true, result: this.result(), nodeOutputs }
      : { success: false, result: null, nodeOutputs, error: this.error };
  }

  private successful(): Map<string, NodeRecord> {
    return new Map(this.records.filter((record) => record.error === null).map((record) => [record.nodeId, record]));
  }
}
