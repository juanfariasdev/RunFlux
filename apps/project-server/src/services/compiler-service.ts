import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { consoleDiscoveryLogger, PluginCatalogProvider, type PluginRegistry } from '@runflux/plugin-system';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import {
  TARGET_PLATFORMS,
  WorkflowCompiler,
  type BuildManifest,
  type CompilationOptions,
  type CompilationFailure,
  type IncompatibleNode,
  type TargetPlatform,
} from '@runflux/compiler';
import { workflowDefinitionSchema } from '@runflux/workflow-model/schema';
import { DomainError } from '../errors.js';
import { buildBackend } from './backend-build.js';
import { CompilationFolders } from './compilation-folders.js';

/** A compilation the request cannot get: `status` is the HTTP status to answer with. */
export class CompilerRequestError extends DomainError {
  constructor(code: string, message: string, options: { status?: number; details?: unknown } = {}) {
    super(code, options.status ?? 400, message, options.details ?? null);
  }
}

class IncompatibleNodesError extends CompilerRequestError {
  constructor(incompatibleNodes: IncompatibleNode[]) {
    super('INCOMPATIBLE_NODES', `Incompatible nodes for target platform: ${incompatibleNodes.map((node) => node.pluginId).join(', ')}`, { details: incompatibleNodes });
  }
}

class CompilerValidationError extends CompilerRequestError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message);
  }
}

export interface CompileWorkflowRequest {
  workflow: WorkflowDefinition;
  targetPlatform?: TargetPlatform;
  target?: TargetPlatform;
  projectName?: string;
  /** Only the options a client may choose; the port and variables come from the workflow. */
  options?: Pick<CompilationOptions, 'includeCli'>;
}

export interface CompileWorkflowResponse {
  status: 'success';
  targetPlatform: TargetPlatform;
  /** Identifies this compilation's folder, and its downloads, among the others. */
  compilationId: string;
  zipFilename: string;
  downloadUrl: string;
  outputDirectory: string;
  manifest: BuildManifest;
  filesCount: number;
}

/**
 * Compiles workflows into downloadable backends: validates the request, compiles with the plugin
 * catalog and stores each result, built into dist/ and archived, as a compilation folder (see
 * CompilationFolders and buildBackend).
 */
export class CompilerService {
  private catalog?: PluginCatalogProvider;
  private readonly customPluginsDir?: string;
  private readonly customOutputDir?: string;
  private readonly folders = new CompilationFolders(() => this.getOutputDir());

  /** `catalog` defaults to the plugins directory, discovered on the first compilation. */
  constructor(customPluginsDir?: string, customOutputDir?: string, catalog?: PluginCatalogProvider) {
    this.customPluginsDir = customPluginsDir;
    this.customOutputDir = customOutputDir;
    this.catalog = catalog;
  }

  getOutputDir(): string {
    if (this.customOutputDir) return this.customOutputDir;
    if (process.env.RUNFLUX_OUTPUT_DIR) return path.resolve(process.env.RUNFLUX_OUTPUT_DIR);
    return path.join(path.resolve(this.getPluginsDir(), '..'), 'output-backends');
  }

  /** The plugins of the catalog; they are discovered again only when the catalog is invalidated. */
  loadPlugins(): Promise<PluginRegistry> {
    this.catalog ??= new PluginCatalogProvider([this.getPluginsDir()], {
      onLog: process.env.NODE_ENV === 'test' ? undefined : consoleDiscoveryLogger,
    });
    return this.catalog.registry();
  }

  async compile(request: CompileWorkflowRequest): Promise<CompileWorkflowResponse> {
    const workflow = this.validWorkflow(request.workflow);
    const targetPlatform = String(request.targetPlatform || request.target || 'local').toLowerCase() as TargetPlatform;
    if (!TARGET_PLATFORMS.includes(targetPlatform)) {
      throw new CompilerRequestError('UNSUPPORTED_TARGET', `Plataforma alvo inválida: "${targetPlatform}". Suportadas: ${TARGET_PLATFORMS.join(', ')}.`);
    }
    const options = this.validOptions(request.options);
    const registry = await this.loadPlugins();
    const projectName = String(request.projectName || workflow.name || 'runflux-project').trim();
    console.log(`[compiler] Starting compilation for project "${projectName}" (target: ${targetPlatform})`);

    const result = await new WorkflowCompiler((pluginId) => registry.get(pluginId)).compile({ workflow, targetPlatform, projectName, options });
    if (result.status === 'failed') throw toRequestError(result);

    const key = `${projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}-${targetPlatform}`;
    const compilationId = `${key}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    // The target in the name keeps the local and AWS downloads of one workflow apart.
    const zipFilename = `${projectName.replace(/[\\/<>:"|?*\x00-\x1f]/g, '_') || 'backend'}-${targetPlatform}.zip`;
    const nodePaths = [this.dependencyDirectory(), ...this.pluginDependencyDirectories(registry, workflow)];
    const outputDirectory = await this.folders.write(compilationId, (staging) => buildBackend(staging, result, zipFilename, nodePaths, buildError));
    await this.folders.removeEarlier(key, compilationId);
    console.log(`[compiler] Compilation succeeded: ${result.files.length} files, download ${zipFilename}`);

    return {
      status: 'success',
      targetPlatform,
      compilationId,
      zipFilename,
      downloadUrl: `/api/compiler/downloads/${compilationId}/${encodeURIComponent(zipFilename)}`,
      outputDirectory,
      manifest: result.manifest,
      filesCount: result.files.length,
    };
  }

  /**
   * The archive `filename` of a compilation, or of the latest compilation that produced it when
   * no compilation is named. Names are checked, so no request reaches outside the output folder.
   */
  findZipFile(filename: string, compilationId?: string): Promise<string | null> {
    return this.folders.findArchive(filename, compilationId);
  }

  private validWorkflow(workflow: unknown): WorkflowDefinition {
    // passthrough keeps the settings (environment variables) the schema does not describe.
    const parsed = workflowDefinitionSchema.passthrough().safeParse(workflow);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'workflow'}: ${issue.message}`).join('; ');
      throw new CompilerValidationError(`Invalid workflow: ${problems}`);
    }
    return parsed.data as WorkflowDefinition;
  }

  /** Keeps only the options a client may set, so a request cannot change the port or the variables. */
  private validOptions(options: unknown): CompilationOptions {
    if (options === undefined || options === null) return {};
    if (typeof options !== 'object' || Array.isArray(options)) throw new CompilerValidationError('Invalid compilation options: expected an object.');
    const { includeCli } = options as Record<string, unknown>;
    if (includeCli === undefined) return {};
    if (typeof includeCli !== 'boolean') throw new CompilerValidationError('Invalid compilation option: includeCli must be a boolean.');
    return { includeCli };
  }

  /** RunFlux's own node_modules, which provides the npm packages a function bundle includes. */
  private dependencyDirectory(): string {
    return path.join(path.resolve(this.getPluginsDir(), '..'), 'node_modules');
  }

  /** The node_modules of the plugins the workflow uses, for packages only a plugin installs. */
  private pluginDependencyDirectories(registry: PluginRegistry, workflow: WorkflowDefinition): string[] {
    const sources = new Set(workflow.nodes.flatMap((node) => registry.get(node.pluginId)?.sourcePath ?? []));
    return [...sources].map((source) => path.join(source, 'node_modules')).filter((directory) => fs.existsSync(directory));
  }

  private getPluginsDir(): string {
    if (this.customPluginsDir && fs.existsSync(this.customPluginsDir)) return this.customPluginsDir;
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(process.cwd(), 'plugins'),
      path.resolve(process.cwd(), '../../plugins'),
      path.resolve(currentDir, '../../../../plugins'),
      path.resolve(currentDir, '../../../plugins'),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? path.resolve(process.cwd(), 'plugins');
  }
}

/** Problems of the request answer 400; the compiler failing to bundle its own runtime is a 500. */
function toRequestError({ error }: CompilationFailure): CompilerRequestError {
  if (error.code === 'INCOMPATIBLE_NODES') return new IncompatibleNodesError(error.details?.incompatibleNodes ?? []);
  return new CompilerRequestError(error.code, error.message, { status: error.code === 'GENERATOR_ERROR' ? 500 : 400 });
}

function buildError(error: unknown): CompilerRequestError {
  return new CompilerRequestError('BUILD_ERROR', `Backend build failed: ${error instanceof Error ? error.message : String(error)}`, { status: 500 });
}
