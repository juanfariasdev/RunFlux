import type { PluginDeployment, PluginManifest } from '@runflux/plugin-system';
import type { WorkflowDefinition, WorkflowEnvVar } from '@runflux/workflow-model';

/** The id of a deployment target, such as `local` or `aws`; see TargetRegistry. */
export type TargetPlatform = string;

/** The platforms of the targets RunFlux ships (defaultTargets). */
export const TARGET_PLATFORMS: readonly TargetPlatform[] = ['local', 'aws'];

export interface GeneratedFile {
  path: string;
  content: string;
  type: 'source' | 'config' | 'infrastructure' | 'asset' | 'runtime';
}

/** What the compiler needs from a plugin: a PluginModule, or a plugin the registry discovered. */
export interface CompiledPlugin {
  manifest: PluginManifest;
  runtimeModule: URL | string;
  deployment?: PluginDeployment;
}

export type PluginResolver = (pluginId: string) => CompiledPlugin | undefined;

export interface BuildManifest {
  $schema?: string;
  runfluxVersion: string;
  projectName: string;
  workflowId?: string;
  workflowVersion?: string;
  targetPlatform: TargetPlatform;
  compiledAt: string;
  entrypoint: string;
  /** How the project bundles itself into dist/ (see BuildProfile). */
  build: { entryPoints: string[]; bundleDependencies: boolean };
  nodeCount: number;
  pluginVersions: Record<string, string>;
  generatedFiles: string[];
}

export type ProjectEnvVar = WorkflowEnvVar;

export interface CompilationOptions {
  /** Port of the local server. Defaults to 3000. */
  port?: number;
  /** Include the local command-line runner. Defaults to true for backwards compatibility. */
  includeCli?: boolean;
  /** Replace the workflow's own environment variables. */
  envVars?: ProjectEnvVar[];
}

export interface CompilationRequest {
  workflow: WorkflowDefinition;
  targetPlatform: TargetPlatform;
  projectName: string;
  projectVersion?: string;
  options?: CompilationOptions;
}

export interface IncompatibleNode {
  nodeId: string;
  pluginId: string;
  targetPlatform: TargetPlatform;
}

/** The generated project. The compiler does not archive it: zip `files` with createZipPackage when needed. */
export interface CompilationSuccess {
  status: 'success';
  projectName: string;
  targetPlatform: TargetPlatform;
  files: GeneratedFile[];
  manifest: BuildManifest;
}

export type CompilationErrorCode =
  /** Nodes whose plugin does not support the target platform. */
  | 'INCOMPATIBLE_NODES'
  | 'CYCLE_DETECTED'
  /** The workflow, its parameters or its plugins' contributions cannot form a backend. */
  | 'INVALID_WORKFLOW'
  | 'UNSUPPORTED_TARGET'
  /** The runtime or a plugin runtime could not be bundled: a problem of the installation, not of the workflow. */
  | 'GENERATOR_ERROR';

export interface CompilationFailure {
  status: 'failed';
  error: {
    code: CompilationErrorCode;
    message: string;
    details?: {
      incompatibleNodes?: IncompatibleNode[];
    };
  };
}

export type CompilationResult = CompilationSuccess | CompilationFailure;

/** A compilation that cannot proceed; the compiler reports it as a failed result. */
export class CompilationError extends Error {
  constructor(
    readonly code: CompilationErrorCode,
    message: string,
    readonly details?: CompilationFailure['error']['details'],
  ) {
    super(message);
    this.name = 'CompilationError';
  }

  toFailure(): CompilationFailure {
    return { status: 'failed', error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) } };
  }
}
