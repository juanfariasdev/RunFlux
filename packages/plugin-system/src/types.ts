/**
 * Core types for the Plugin System.
 * See _reversa_sdd/sdd/plugin-system.md#9 (Modelo de Dados) in the RunFlux
 * planning repo for the spec these types implement.
 */
import type { NodeDefinition } from '@runflux/runtime';
import type { PluginDeployment } from './deployment.js';

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
 * recognize the parameter by name.
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
  /**
   * Hide this field, and clear its value, while another field of the row equals `equals` or one of
   * `oneOf`. See isRowFieldHidden.
   */
  hideWhen?: { key: string; equals?: unknown; oneOf?: readonly unknown[] };
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
  /** Choices of a `type: 'string'` parameter; the editor shows them as a select. */
  options?: JsonRowOption[];
  /** With `options`: they are suggestions and any other value may be typed. */
  allowCustomOptions?: boolean;
  /** Show the parameter only while another parameter holds one of these values. */
  showWhen?: { parameter: string; oneOf: readonly unknown[] };
  /** A `type: 'string'` parameter holding source code in this language. */
  language?: 'javascript' | 'sql';
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
   * "main" output. The node's handler names the port it activates on every run.
   */
  outputs?: string[];
  /**
   * How the editor draws the plugin, as names it maps to its own icons and colors (for example
   * `database` and `cyan`). Without it, the plugin's category decides.
   */
  appearance?: { icon?: string; accent?: string };
  /** How the plugin behaves in the editor's test runs. */
  testing?: {
    /** The node waits for an HTTP request sent to its test URL, so the editor offers to send one. */
    waitsForRequest?: boolean;
  };
}

/**
 * What a plugin module exports.
 *
 * `runtimeModule` locates the module whose default export is the plugin's NodeDefinition. The
 * editor imports it to run nodes; the compiler bundles it into exported backends. It must import
 * only `@runflux/runtime`, its own files and the npm packages it declares in `deployment`.
 */
export interface PluginModule {
  manifest: PluginManifest;
  runtimeModule: URL | string;
  deployment?: PluginDeployment;
}

/** A plugin loaded by the registry, with its runtime definition imported. */
export interface DiscoveredPlugin extends PluginModule {
  definition: NodeDefinition;
  sourcePath: string;
}
