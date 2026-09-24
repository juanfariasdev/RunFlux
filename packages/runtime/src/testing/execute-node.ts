import { MAIN_OUTPUT, type ExecutionMode, type NodeDefinition } from '../contracts/node.js';
import type { RuntimeServices } from '../contracts/services.js';
import { StaticNodeCatalog } from '../engine/node-catalog.js';
import { NodeExecutor } from '../engine/node-executor.js';
import { addNodeOutput, type NodeOutputsById, type NodeRecord } from '../engine/node-record.js';
import type { EnvironmentVariables } from '../environment.js';
import { ParameterResolver } from '../expressions/parameter-resolver.js';
import { createRuntimeServices } from '../services/default-services.js';

export interface NodeTestRun {
  readonly parameters?: Readonly<Record<string, unknown>>;
  /** Parameters kept verbatim, like those a manifest marks `expressions: false`. */
  readonly literalParameters?: readonly string[];
  readonly input?: unknown;
  readonly mode?: ExecutionMode;
  readonly env?: EnvironmentVariables;
  /** Outputs of earlier nodes, by node id, visible as `$node`. */
  readonly nodes?: Readonly<Record<string, unknown>>;
  readonly outputs?: readonly string[];
  readonly services?: Partial<RuntimeServices> | RuntimeServices;
  readonly signal?: AbortSignal;
  readonly pluginId?: string;
}

/**
 * Runs one node of `definition` exactly as the engine would, with expressions resolved, and returns
 * its record. For plugin tests: a failure is the record's `error`, never a thrown exception.
 */
export function executeNode(definition: NodeDefinition, run: NodeTestRun = {}): Promise<NodeRecord> {
  const pluginId = run.pluginId ?? 'test-plugin';
  const services = createRuntimeServices(run.services);
  const executor = new NodeExecutor(new StaticNodeCatalog({ [pluginId]: definition }), services, new ParameterResolver(), {
    workflowId: 'test-workflow',
    mode: run.mode ?? 'sandbox',
    environment: run.env ?? {},
  });
  const outputs: NodeOutputsById = {};
  for (const [nodeId, output] of Object.entries(run.nodes ?? {})) {
    addNodeOutput(outputs, { nodeId, input: null, output, activeOutput: MAIN_OUTPUT, error: null, startedAt: '', finishedAt: '' }, undefined);
  }
  return executor.execute(
    {
      id: 'test-node',
      pluginId,
      trigger: false,
      outputs: run.outputs ?? [MAIN_OUTPUT],
      parameters: run.parameters ?? {},
      literalParameters: run.literalParameters ?? [],
    },
    run.input,
    outputs,
    run.signal ?? new AbortController().signal,
  );
}
