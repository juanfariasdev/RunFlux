import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginRegistry } from '@runflux/plugin-system/plugin-registry';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import {
  BuildProfile,
  TARGET_PLATFORMS,
  WorkflowCompiler,
  createZipPackage,
  type BuildManifest,
  type CompilationOptions,
  type CompilationFailure,
  type CompilationSuccess,
  type IncompatibleNode,
  type TargetPlatform,
} from '@runflux/compiler';
import { workflowDefinitionSchema } from './project-service.js';

/** A compilation the request cannot get: `status` is the HTTP status to answer with. */
export class CompilerRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, options: { status?: number; details?: unknown } = {}) {
    super(message);
    this.name = 'CompilerRequestError';
    this.code = code;
    this.status = options.status ?? 400;
    this.details = options.details ?? null;
  }
}

export class IncompatibleNodesError extends CompilerRequestError {
  readonly incompatibleNodes: IncompatibleNode[];

  constructor(incompatibleNodes: IncompatibleNode[]) {
    super('INCOMPATIBLE_NODES', `Incompatible nodes for target platform: ${incompatibleNodes.map((node) => node.pluginId).join(', ')}`, { details: incompatibleNodes });
    this.name = 'IncompatibleNodesError';
    this.incompatibleNodes = incompatibleNodes;
  }
}

export class CompilerValidationError extends CompilerRequestError {
  constructor(message: string) {
    super('VALIDATION_ERROR', message);
    this.name = 'CompilerValidationError';
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

const FUNCTION_ZIP = 'function.zip';
const COMPILATION_ID = /^[A-Za-z0-9_-]+-(local|aws)-\d+-[0-9a-f]{8}$/;

/**
 * Compiles workflows into downloadable backends. Every compilation gets its own folder in the
 * output directory, written under a temporary name and renamed once complete, so concurrent
 * compilations never mix files; only the latest folder of each project and target is kept. The
 * folder holds the project built into dist/ and `<project>-<target>.zip`, plus, for AWS, the
 * function package `function.zip`.
 */
export class CompilerService {
  private registry?: Promise<PluginRegistry>;
  private readonly customPluginsDir?: string;
  private readonly customOutputDir?: string;

  constructor(customPluginsDir?: string, customOutputDir?: string) {
    this.customPluginsDir = customPluginsDir;
    this.customOutputDir = customOutputDir;
  }

  getOutputDir(): string {
    if (this.customOutputDir) return this.customOutputDir;
    if (process.env.RUNFLUX_OUTPUT_DIR) return path.resolve(process.env.RUNFLUX_OUTPUT_DIR);
    return path.join(path.resolve(this.getPluginsDir(), '..'), 'output-backends');
  }

  /** Discovers the plugins once; later compilations reuse the registry. */
  loadPlugins(): Promise<PluginRegistry> {
    this.registry ??= (async () => {
      const registry = new PluginRegistry();
      await registry.discover({
        pluginDirectories: [this.getPluginsDir()],
        onLog: (message) => { if (process.env.NODE_ENV !== 'test') console.info(message); },
      });
      return registry;
    })();
    return this.registry;
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
    const outputDirectory = await this.writeProject(result, compilationId, zipFilename, nodePaths);
    await this.removeEarlierCompilations(key, compilationId);
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
  async findZipFile(filename: string, compilationId?: string): Promise<string | null> {
    if (filename !== path.basename(filename) || filename.includes('\\') || !filename.endsWith('.zip')) return null;
    if (compilationId !== undefined && !COMPILATION_ID.test(compilationId)) return null;
    const folders = compilationId ? [compilationId] : (await this.compilations()).reverse();
    for (const folder of folders) {
      const candidate = path.join(this.getOutputDir(), folder, filename);
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
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

  /** Writes and builds the project under a temporary name, then renames it into place. */
  private async writeProject(result: CompilationSuccess, compilationId: string, zipFilename: string, nodePaths: string[]): Promise<string> {
    const outputDirectory = path.join(this.getOutputDir(), compilationId);
    const staging = `${outputDirectory}.partial`;
    try {
      for (const file of result.files) {
        const filePath = path.join(staging, file.path);
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, file.content, 'utf8');
      }
      try {
        await BuildProfile.fromManifest(result.manifest).build(staging, nodePaths);
      } catch (error) {
        throw new CompilerRequestError('BUILD_ERROR', `Backend build failed: ${error instanceof Error ? error.message : String(error)}`, { status: 500 });
      }
      const bundle = await readTree(path.join(staging, 'dist'));
      if (result.targetPlatform === 'aws') await fs.promises.writeFile(path.join(staging, FUNCTION_ZIP), await createZipPackage(bundle));
      await fs.promises.writeFile(
        path.join(staging, zipFilename),
        await createZipPackage([...result.files, ...bundle.map((file) => ({ ...file, path: `dist/${file.path}` }))]),
      );
      await fs.promises.rename(staging, outputDirectory);
      return outputDirectory;
    } finally {
      await fs.promises.rm(staging, { recursive: true, force: true });
    }
  }

  /**
   * Removes the compilations of the same project and target that started before `keep`; one that
   * started later, concurrently, is newer and stays.
   */
  private async removeEarlierCompilations(key: string, keep: string): Promise<void> {
    const earlier = (await this.compilations()).filter((folder) => folder !== keep
      && /^\d+-[0-9a-f]{8}$/.test(folder.slice(key.length + 1))
      && folder.startsWith(`${key}-`)
      && timestampOf(folder) <= timestampOf(keep));
    await Promise.all(earlier.map((folder) => fs.promises.rm(path.join(this.getOutputDir(), folder), { recursive: true, force: true })));
  }

  /** Completed compilation folders, oldest first. */
  private async compilations(): Promise<string[]> {
    const entries = await fs.promises.readdir(this.getOutputDir(), { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isDirectory() && COMPILATION_ID.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => timestampOf(a) - timestampOf(b));
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

function timestampOf(compilationId: string): number {
  return Number(/-(\d+)-[0-9a-f]{8}$/.exec(compilationId)?.[1] ?? 0);
}

async function readTree(directory: string, prefix = ''): Promise<Array<{ path: string; content: Buffer }>> {
  const entries = await fs.promises.readdir(path.join(directory, prefix), { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return readTree(directory, relative);
    return [{ path: relative, content: await fs.promises.readFile(path.join(directory, relative)) }];
  }));
  return nested.flat();
}
