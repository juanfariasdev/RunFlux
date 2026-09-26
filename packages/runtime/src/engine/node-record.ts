/** What happened when one node ran. */
export interface NodeRecord {
  readonly nodeId: string;
  readonly input: unknown;
  /** The produced value; null when the node failed. */
  readonly output: unknown;
  /** The output port that carries `output`; null when the node failed or ended its branch. */
  readonly activeOutput: string | null;
  readonly error: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  /** What the node reported without failing, e.g. skipped elements; absent when it reported nothing. */
  readonly notices?: readonly string[];
}

export type NodeOutputsById = Record<string, { readonly json: unknown }>;

/**
 * `$node` entries for the successful records, by label and by node id. An id always wins over a
 * label that happens to equal it.
 */
export function nodeOutputsOf(records: Iterable<NodeRecord>, labelOf: (nodeId: string) => string | undefined): NodeOutputsById {
  const successful = [...records].filter((record) => record.error === null);
  // No prototype: ids and labels are user text, and "__proto__" must stay an ordinary key.
  const outputs: NodeOutputsById = Object.create(null);
  for (const record of successful) {
    const label = labelOf(record.nodeId);
    if (label) outputs[label] = { json: record.output };
  }
  for (const record of successful) outputs[record.nodeId] = { json: record.output };
  return outputs;
}
