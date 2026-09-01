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
 * A discovered plugin, pairing its manifest with one generator per platform it
 * declares support for.
 */
export interface DiscoveredPlugin {
  manifest: PluginManifest;
  generators: Record<string, GeneratorFn>;
  sourcePath: string;
}

/** What a plugin module must export to be discoverable (RF-01, RF-02, RF-03). */
export interface PluginModule {
  manifest: PluginManifest;
  generators: Record<string, GeneratorFn>;
}
