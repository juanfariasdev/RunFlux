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
}

export type NodeOutputsById = Record<string, { readonly json: unknown }>;

/** `$node` entries for the given records, by node id and, when the node has one, by label. */
export function nodeOutputsOf(records: Iterable<NodeRecord>, labelOf: (nodeId: string) => string | undefined): NodeOutputsById {
  const outputs: NodeOutputsById = {};
  for (const record of records) addNodeOutput(outputs, record, labelOf(record.nodeId));
  return outputs;
}

export function addNodeOutput(outputs: NodeOutputsById, record: NodeRecord, label: string | undefined): void {
  const entry = { json: record.output };
  outputs[record.nodeId] = entry;
  if (label) outputs[label] = entry;
}
