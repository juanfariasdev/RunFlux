/**
 * Core types for the Plugin System.
 * See _reversa_sdd/sdd/plugin-system.md#9 (Modelo de Dados) in the RunFlux
 * planning repo for the spec these types implement.
 */

export type PluginCategory = 'trigger' | 'action' | 'output' | 'control-flow' | 'subworkflow';

export interface JsonRowOption {
  value: string;
  label: string;
}

/**
 * Describes one field of a fixed-shape row inside a `type: 'json'`
 * array-of-objects parameter (e.g. a condition's `operator`, a Set node's
 * typed `value`). A plugin declares this on its own `rowSchema` to opt an
 * array parameter into a structured row form in the editor UI, instead of
 * the generic free-form key/value editor — without the UI needing to
 * recognize the parameter by name (previously the only mechanism: see
 * apps/workflow-editor JsonFieldEditor's old name-keyed LIST_ROW_FIELDS).
 */
export interface JsonRowFieldSchema {
  key: string;
  label: string;
  kind: 'text' | 'select' | 'typedValue';
  /** Seed value used when a new row is added via "+ Add row". */
  initialValue?: unknown;
  /** Choices for kind: 'select'. */
  options?: JsonRowOption[];
  /** kind: 'select' only — lets the user type a value beyond the predefined options. */
  allowCustomOptions?: boolean;
  /** kind: 'typedValue' only — which row key stores the JSON value type. Default 'type'. */
  typeKey?: string;
  /** Hide this field, and clear its value, whenever another field's value equals this. */
  hideWhen?: { key: string; equals?: unknown };
}

export interface ParameterSchema {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'json';
  required: boolean;
  default?: unknown;
  sensitive?: boolean;
  /** Disable interpolation for source code or SQL; bind data through separate parameters. */
  expressions?: boolean;
  /** Row shape for a `type: 'json'` array-of-objects parameter. See JsonRowFieldSchema. */
  rowSchema?: JsonRowFieldSchema[];
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
  /**
   * Named output ports (004-core-nodes-catalog, D-03). Absent = one implicit
   * "main" output, always active (legacy behavior, e.g. trigger-manual-example).
   * Present = `execute()` returns an `ExecutorResult` object instead of a raw
   * value, and the validation engine only propagates through the output it names.
   */
  outputs?: string[];
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
  $node?: Record<string, { json: unknown }>;
  $env?: Record<string, string | undefined>;
  /**
   * Fires when this node's wait no longer matters — e.g. a whole-workflow
   * run raced two independent triggers (RN-08) and a different one already
   * fired. A plugin that waits on a real external event (trigger-webhook)
   * should abandon that wait and reject when this fires; a plugin that
   * doesn't wait on anything can ignore it entirely.
   */
  signal?: AbortSignal;
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
/**
 * What `ExecutorFn` returns (004-core-nodes-catalog, D-03). The engine decides
 * which shape to expect by checking the plugin's own `manifest.outputs`, not
 * by inspecting the returned value: absent `outputs` means the plain `unknown`
 * form; present `outputs` means the `{ value, activeOutput }` form, where
 * `activeOutput: null` means no output was activated — propagation stops here.
 */
export type ExecutorResult = unknown | { value: unknown; activeOutput: string | null };

export type ExecutorFn = (
  params: Record<string, unknown>,
  input: unknown,
  context: PluginExecutionContext,
) => ExecutorResult | Promise<ExecutorResult>;

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
