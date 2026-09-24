/**
 * Standalone Topological DAG Runner Template for compiled backends.
 * Dispatches workflow execution along active connections and handles branching.
 */

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
  run: (input: any, context?: any) => Promise<any>;
}

export interface WorkflowExecutionResult {
  success: boolean;
  result: any;
  nodeOutputs: Record<string, any>;
  error?: string;
}

/**
 * Executes a workflow graph in-process with full active output filtering and $node context.
 */
export async function executeWorkflowGraph(
  nodes: GraphNode[],
  connections: GraphConnection[],
  initialPayload: any = {}
): Promise<WorkflowExecutionResult> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, GraphConnection[]>();
  const outgoing = new Map<string, GraphConnection[]>();

  for (const c of connections) {
    const incList = incoming.get(c.target) ?? [];
    incList.push(c);
    incoming.set(c.target, incList);

    const outList = outgoing.get(c.source) ?? [];
    outList.push(c);
    outgoing.set(c.source, outList);
  }

  const triggers = nodes.filter((n) => n.isTrigger || (incoming.get(n.id) ?? []).length === 0);

  const nodeOutputs: Record<string, any> = {};
  const nodeScope: Record<string, any> = {};
  const activeOutputs = new Map<string, string[]>();
  const executing = new Map<string, Promise<void>>();

  async function runNode(nodeId: string, inputPayload: any): Promise<void> {
    if (executing.has(nodeId)) {
      return executing.get(nodeId)!;
    }

    const node = nodeMap.get(nodeId);
    if (!node || typeof node.run !== 'function') return;

    const promise = (async () => {
      try {
        const context = {
          $node: nodeScope,
          $env: typeof process !== 'undefined' ? process.env : {},
          nodeOutputs,
        };
        const rawResult = await node.run(inputPayload, context);

        let value = rawResult;
        let activated: string[] = ['main'];

        if (rawResult && typeof rawResult === 'object' && 'activeOutput' in rawResult) {
          value = rawResult.value !== undefined ? rawResult.value : rawResult;
          activated = rawResult.activeOutput ? [rawResult.activeOutput] : [];
        }

        nodeOutputs[nodeId] = value;
        const entry = { json: value };
        nodeScope[nodeId] = entry;
        if (node.name) {
          nodeScope[node.name] = entry;
        }
        activeOutputs.set(nodeId, activated);

        const outConns = outgoing.get(nodeId) ?? [];
        const activeTargets = outConns.filter((c) => activated.includes(c.sourceOutput));
        const children = [...new Set(activeTargets.map((c) => c.target))];

        await Promise.all(
          children.map(async (childId) => {
            const childIncomings = incoming.get(childId) ?? [];
            const activeIncomings = childIncomings.filter((c) => {
              const parentActivated = activeOutputs.get(c.source) ?? [];
              return parentActivated.includes(c.sourceOutput);
            });

            if (activeIncomings.length === 0) return;

            const childInputs = activeIncomings.map((c) => nodeOutputs[c.source]);
            const combinedInput = childInputs.length === 1 ? childInputs[0] : childInputs;

            await runNode(childId, combinedInput);
          })
        );
      } catch (err: any) {
        console.error(`[RunFlux Execution Error in node "${nodeId}"]:`, err);
        throw err;
      }
    })();

    executing.set(nodeId, promise);
    return promise;
  }

  try {
    if (triggers.length === 0 && nodes.length > 0) {
      await runNode(nodes[0].id, initialPayload);
    } else {
      await Promise.all(triggers.map((t) => runNode(t.id, initialPayload)));
    }

    const executedNodeIds = Object.keys(nodeOutputs);
    const leafNodes = executedNodeIds.filter((id) => {
      const outConns = outgoing.get(id) ?? [];
      const parentActivated = activeOutputs.get(id) ?? [];
      const hasActiveChild = outConns.some(
        (c) => parentActivated.includes(c.sourceOutput) && executing.has(c.target)
      );
      return !hasActiveChild;
    });

    let finalResult: any = null;
    if (leafNodes.length === 1) {
      finalResult = nodeOutputs[leafNodes[0]];
    } else if (leafNodes.length > 1) {
      finalResult = leafNodes.map((id) => nodeOutputs[id]);
    } else if (executedNodeIds.length > 0) {
      finalResult = nodeOutputs[executedNodeIds[executedNodeIds.length - 1]];
    }

    return {
      success: true,
      result: finalResult,
      nodeOutputs,
    };
  } catch (error: any) {
    return {
      success: false,
      result: null,
      nodeOutputs,
      error: error?.message || String(error),
    };
  }
}

export function buildRunnerCode(
  imports: string[],
  graphNodesCode: string,
  connectionsJson: string
): string {
  return `// Generated by RunFlux Compiler — Standalone DAG Runner
${imports.join('\n')}

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
  run: (input: any, context?: any) => Promise<any>;
}

export interface WorkflowExecutionResult {
  success: boolean;
  result: any;
  nodeOutputs: Record<string, any>;
  error?: string;
}

export const graphNodes: GraphNode[] = [
${graphNodesCode}
];

export const graphConnections: GraphConnection[] = ${connectionsJson};

/**
 * Executes the workflow graph by traversing connections from triggers through active outputs.
 */
export async function executeWorkflowGraph(
  nodes: GraphNode[],
  connections: GraphConnection[],
  initialPayload: any = {}
): Promise<WorkflowExecutionResult> {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map<string, GraphConnection[]>();
  const outgoing = new Map<string, GraphConnection[]>();

  for (const c of connections) {
    const incList = incoming.get(c.target) ?? [];
    incList.push(c);
    incoming.set(c.target, incList);

    const outList = outgoing.get(c.source) ?? [];
    outList.push(c);
    outgoing.set(c.source, outList);
  }

  // Identify triggers or root nodes with no incoming connections
  const triggers = nodes.filter((n) => n.isTrigger || (incoming.get(n.id) ?? []).length === 0);

  const nodeOutputs: Record<string, any> = {};
  const nodeScope: Record<string, any> = {};
  const activeOutputs = new Map<string, string[]>();
  const executing = new Map<string, Promise<void>>();

  async function runNode(nodeId: string, inputPayload: any): Promise<void> {
    if (executing.has(nodeId)) {
      return executing.get(nodeId)!;
    }

    const node = nodeMap.get(nodeId);
    if (!node || typeof node.run !== 'function') return;

    const promise = (async () => {
      try {
        const context = {
          $node: nodeScope,
          $env: typeof process !== 'undefined' ? process.env : {},
          nodeOutputs,
        };
        const rawResult = await node.run(inputPayload, context);

        let value = rawResult;
        let activated: string[] = ['main'];

        if (rawResult && typeof rawResult === 'object' && 'activeOutput' in rawResult) {
          value = rawResult.value !== undefined ? rawResult.value : rawResult;
          activated = rawResult.activeOutput ? [rawResult.activeOutput] : [];
        }

        nodeOutputs[nodeId] = value;
        const entry = { json: value };
        nodeScope[nodeId] = entry;
        if (node.name) {
          nodeScope[node.name] = entry;
        }
        activeOutputs.set(nodeId, activated);

        // Find child connections that match active outputs
        const outConns = outgoing.get(nodeId) ?? [];
        const activeTargets = outConns.filter((c) => activated.includes(c.sourceOutput));

        // Group unique target children
        const children = [...new Set(activeTargets.map((c) => c.target))];

        await Promise.all(
          children.map(async (childId) => {
            const childIncomings = incoming.get(childId) ?? [];
            const activeIncomings = childIncomings.filter((c) => {
              const parentActivated = activeOutputs.get(c.source) ?? [];
              return parentActivated.includes(c.sourceOutput);
            });

            if (activeIncomings.length === 0) return;

            const childInputs = activeIncomings.map((c) => nodeOutputs[c.source]);
            const combinedInput = childInputs.length === 1 ? childInputs[0] : childInputs;

            await runNode(childId, combinedInput);
          })
        );
      } catch (err: any) {
        console.error(\`[RunFlux Execution Error in node "\${nodeId}"]:\`, err);
        throw err;
      }
    })();

    executing.set(nodeId, promise);
    return promise;
  }

  try {
    if (triggers.length === 0 && nodes.length > 0) {
      await runNode(nodes[0].id, initialPayload);
    } else {
      await Promise.all(triggers.map((t) => runNode(t.id, initialPayload)));
    }

    // Determine final output from leaf nodes that actually executed
    const executedNodeIds = Object.keys(nodeOutputs);
    const leafNodes = executedNodeIds.filter((id) => {
      const outConns = outgoing.get(id) ?? [];
      const parentActivated = activeOutputs.get(id) ?? [];
      const hasActiveChild = outConns.some(
        (c) => parentActivated.includes(c.sourceOutput) && executing.has(c.target)
      );
      return !hasActiveChild;
    });

    let finalResult: any = null;
    if (leafNodes.length === 1) {
      finalResult = nodeOutputs[leafNodes[0]];
    } else if (leafNodes.length > 1) {
      finalResult = leafNodes.map((id) => nodeOutputs[id]);
    } else if (executedNodeIds.length > 0) {
      finalResult = nodeOutputs[executedNodeIds[executedNodeIds.length - 1]];
    }

    return {
      success: true,
      result: finalResult,
      nodeOutputs,
    };
  } catch (error: any) {
    return {
      success: false,
      result: null,
      nodeOutputs,
      error: error?.message || String(error),
    };
  }
}

export async function runWorkflow(initialPayload: any = {}): Promise<WorkflowExecutionResult> {
  return executeWorkflowGraph(graphNodes, graphConnections, initialPayload);
}
`;
}
