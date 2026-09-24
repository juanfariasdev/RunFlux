export interface GraphConnection {
  source: string;
  sourceOutput: string;
  target: string;
  targetInput: string;
}

export interface GraphNode {
  id: string;
  name: string;
  isTrigger: boolean;
  outputs?: string[];
  run: (input: any, context?: any) => unknown | Promise<unknown>;
}

export interface WorkflowExecutionResult {
  success: boolean;
  result: unknown;
  nodeOutputs: Record<string, unknown>;
  error?: string;
}

/** Dependency-driven scheduling waits for all parents, including inactive branches. */
export async function executeWorkflowGraph(
  nodes: GraphNode[], connections: GraphConnection[], initialPayload: unknown = {}, triggerId?: string,
): Promise<WorkflowExecutionResult> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, GraphConnection[]>();
  const outgoing = new Map<string, GraphConnection[]>();
  for (const connection of connections) {
    incoming.set(connection.target, [...incoming.get(connection.target) ?? [], connection]);
    outgoing.set(connection.source, [...outgoing.get(connection.source) ?? [], connection]);
  }
  const nodeOutputs: Record<string, unknown> = Object.create(null);
  const nodeScope: Record<string, { json: unknown }> = Object.create(null);
  const activeOutputs = new Map<string, string[]>();
  const pending = new Map<string, Promise<void>>();
  const errors = new Map<string, string>();
  const reachable = new Set(nodes.filter((node) => node.isTrigger && (!triggerId || node.id === triggerId)).map((node) => node.id));
  const queue = [...reachable];
  for (let i = 0; i < queue.length; i++) {
    for (const connection of outgoing.get(queue[i]) ?? []) {
      if (!reachable.has(connection.target)) { reachable.add(connection.target); queue.push(connection.target); }
    }
  }
  function runNode(nodeId: string): Promise<void> {
    if (!reachable.has(nodeId)) return Promise.resolve();
    const existing = pending.get(nodeId);
    if (existing) return existing;
    const promise = Promise.resolve().then(async () => {
      const node = byId.get(nodeId)!;
      const parents = incoming.get(nodeId) ?? [];
      await Promise.all(parents.map((parent) => runNode(parent.source)));
      if (parents.some((parent) => errors.has(parent.source))) return;
      const active = parents.filter((parent) => activeOutputs.get(parent.source)?.includes(parent.sourceOutput));
      if (parents.length && !active.length) return;
      const input = parents.length === 0 ? initialPayload : active.length === 1 ? nodeOutputs[active[0].source] : active.map((parent) => nodeOutputs[parent.source]);
      try {
        const raw = await node.run(input, { $node: nodeScope, $env: typeof process === 'undefined' ? {} : process.env });
        let value = raw;
        let outputs = ['main'];
        if (node.outputs) {
          const result = raw as { value: unknown; activeOutput: string | null };
          if (!result || typeof result !== 'object' || !('value' in result) || !('activeOutput' in result)
            || (result.activeOutput !== null && !node.outputs.includes(result.activeOutput))) {
            throw new Error(`Node "${nodeId}" returned an invalid named output`);
          }
          value = result.value;
          outputs = result.activeOutput === null ? [] : [result.activeOutput];
        }
        nodeOutputs[nodeId] = value;
        const entry = { json: value };
        nodeScope[nodeId] = entry;
        if (node.name) nodeScope[node.name] = entry;
        activeOutputs.set(nodeId, outputs);
      } catch (error) {
        errors.set(nodeId, error instanceof Error ? error.message : String(error));
      }
    });
    pending.set(nodeId, promise);
    return promise;
  }
  await Promise.all(nodes.filter((node) => reachable.has(node.id)).map((node) => runNode(node.id)));
  const leaves = nodes.filter((node) => Object.hasOwn(nodeOutputs, node.id) && !(outgoing.get(node.id) ?? []).some(
    (connection) => activeOutputs.get(node.id)?.includes(connection.sourceOutput) && Object.hasOwn(nodeOutputs, connection.target),
  ));
  if (errors.size) return { success: false, result: null, nodeOutputs, error: [...errors.values()][0] };
  return { success: true, result: leaves.length === 1 ? nodeOutputs[leaves[0].id] : leaves.length ? leaves.map((node) => nodeOutputs[node.id]) : null, nodeOutputs };
}
