/**
 * Core types for the Plugin System.
 * See _reversa_sdd/sdd/plugin-system.md#9 (Modelo de Dados) in the RunFlux
 * planning repo for the spec these types implement.
 */

export type PluginCategory = 'trigger' | 'action' | 'output' | 'control-flow' | 'subworkflow';

export interface ParameterSchema {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  required: boolean;
  default?: unknown;
  sensitive?: boolean;
}

/**
 * Authored in TypeScript by the plugin author (D-02: strong typing at authoring
 * time). At discovery time this shape is serialized to JSON — that JSON is what
 * circulates in the in-memory registry and in project export/import.
 */
export interface PluginManifest {
  id: string;
  name: string;
  category: PluginCategory;
  version: string;
  parameters: ParameterSchema[];
  supportedPlatforms: string[];
}

export interface InfraFragment {
  kind: string;
  content: string;
}

export interface GeneratedArtifact {
  files: Array<{ path: string; content: string }>;
  infra: InfraFragment[];
}

export interface WorkflowContext {
  workflowId: string;
  nodeId: string;
}

export type GeneratorFn = (
  nodeConfig: Record<string, unknown>,
  workflowContext: WorkflowContext,
) => GeneratedArtifact;

/**
 * Context passed to a plugin's `execute` function (003-validation-runtime,
 * D-03/RN-04). Distinct from `WorkflowContext`: this one carries `mode`,
 * needed only at runtime, never at compile-time code generation.
 */
export interface PluginExecutionContext {
  workflowId: string;
  nodeId: string;
  mode: 'sandbox' | 'production';
}

/**
 * Runs a plugin's actual logic against real/mock data (003-validation-runtime,
 * D-03). Deliberately a third, independent function from `GeneratorFn`:
 * `GeneratorFn` takes config and produces file/infra text for a compile
 * target; `ExecutorFn` takes data and produces data, for interactive
 * validation before anything is compiled. Optional — a plugin without
 * `execute` simply cannot be validated at runtime yet (still fully usable for
 * compilation via its generators).
 */
export type ExecutorFn = (
  params: Record<string, unknown>,
  input: unknown,
  context: PluginExecutionContext,
) => unknown | Promise<unknown>;

/**
 * A discovered plugin, pairing its manifest with one generator per platform it
 * declares support for, plus an optional local executor (D-03).
 */
export interface DiscoveredPlugin {
  manifest: PluginManifest;
  generators: Record<string, GeneratorFn>;
  execute?: ExecutorFn;
  sourcePath: string;
}

/** What a plugin module must export to be discoverable (RF-01, RF-02, RF-03). */
export interface PluginModule {
  manifest: PluginManifest;
  generators: Record<string, GeneratorFn>;
  execute?: ExecutorFn;
}
