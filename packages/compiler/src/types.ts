import type { WorkflowDefinition } from '@runflux/workflow-model';
import type { PluginManifest, GeneratorFn } from '@runflux/plugin-system';

export type TargetPlatform = 'local' | 'aws';

export interface GeneratedFile {
  path: string;
  content: string;
  type: 'source' | 'config' | 'infrastructure' | 'asset';
}

export interface CompiledNodeEntry {
  path: string;
  isTrigger: boolean;
  outputs?: string[];
}

export interface BuildManifest {
  $schema?: string;
  runfluxVersion: string;
  projectName: string;
  workflowId?: string;
  workflowVersion?: string;
  targetPlatform: TargetPlatform;
  compiledAt: string;
  entrypoint: string;
  nodeCount: number;
  pluginVersions: Record<string, string>;
  generatedFiles: string[];
}

export interface ProjectEnvVar {
  key: string;
  value?: string;
  description?: string;
}

export interface CompilationOptions {
  port?: number;
  includeDocker?: boolean;
  includeCdk?: boolean;
  packageName?: string;
  skipTests?: boolean;
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

export interface CompilationSuccess {
  status: 'success';
  projectName: string;
  targetPlatform: TargetPlatform;
  files: GeneratedFile[];
  manifest: BuildManifest;
  zipBuffer?: Uint8Array;
}

export interface CompilationFailure {
  status: 'failed';
  error: {
    code: 'INCOMPATIBLE_NODES' | 'CYCLE_DETECTED' | 'GENERATOR_ERROR' | 'INVALID_WORKFLOW';
    message: string;
    details?: {
      incompatibleNodes?: IncompatibleNode[];
    };
  };
}

export type CompilationResult = CompilationSuccess | CompilationFailure;

export interface CompiledPlugin {
  manifest: PluginManifest;
  generators?: Record<string, GeneratorFn>;
}

export type PluginResolver = (pluginId: string) => CompiledPlugin | undefined;
