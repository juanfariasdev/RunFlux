import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginRegistry } from '@runflux/plugin-system/plugin-registry';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import {
  BuildProfile,
  TARGET_PLATFORMS,
  WorkflowCompiler,
  createZipArchive,
  type BuildManifest,
  type CompilationSuccess,
  type IncompatibleNode,
  type TargetPlatform,
} from '@runflux/compiler';

export class IncompatibleNodesError extends Error {
  code = 'INCOMPATIBLE_NODES';
  incompatibleNodes: IncompatibleNode[];
  constructor(incompatibleNodes: IncompatibleNode[]) {
    super(`Incompatible nodes for target platform: ${incompatibleNodes.map((n) => n.pluginId).join(', ')}`);
    this.name = 'IncompatibleNodesError';
    this.incompatibleNodes = incompatibleNodes;
  }
}

export class CompilerValidationError extends Error {
  code = 'VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'CompilerValidationError';
  }
}

export interface CompileWorkflowRequest {
  workflow: WorkflowDefinition;
  targetPlatform?: TargetPlatform;
  target?: TargetPlatform;
  projectName?: string;
  skipTests?: boolean;
}

export interface CompileWorkflowResponse {
  status: 'success';
  targetPlatform: TargetPlatform;
  zipFilename: string;
  downloadUrl: string;
  outputDirectory: string;
  manifest: BuildManifest;
  filesCount: number;
}

/**
 * Compiles workflows into downloadable backends. Each compilation is written to its own folder in
 * the output directory, built into dist/ with the project's own build profile, and packaged as
 * `<project>-<target>.zip` (the whole project) plus `compiled/function.zip` (dist/ only).
 */
export class CompilerService {
  private registry?: Promise<PluginRegistry>;

  constructor(
    private readonly customPluginsDir?: string,
    private readonly customOutputDir?: string,
  ) {}

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
    if (!request.workflow || !Array.isArray(request.workflow.nodes)) {
      throw new CompilerValidationError('Invalid workflow: nodes must be defined.');
    }
    const targetPlatform = (request.targetPlatform || request.target || 'local').toLowerCase() as TargetPlatform;
    if (!TARGET_PLATFORMS.includes(targetPlatform)) {
      throw new CompilerValidationError(`Plataforma alvo inválida: "${targetPlatform}". Suportadas: ${TARGET_PLATFORMS.join(', ')}.`);
    }
    const registry = await this.loadPlugins();
    const projectName = (request.projectName || request.workflow.name || 'runflux-project').trim();
    console.log(`[compiler] Starting compilation for project "${projectName}" (target: ${targetPlatform})`);

    const result = await new WorkflowCompiler((pluginId) => registry.get(pluginId)).compile({
      workflow: request.workflow,
      targetPlatform,
      projectName,
      options: { skipTests: request.skipTests ?? true },
    });
    if (result.status === 'failed') {
      if (result.error.code === 'INCOMPATIBLE_NODES') throw new IncompatibleNodesError(result.error.details?.incompatibleNodes || []);
      throw new CompilerValidationError(result.error.message);
    }

    const outputDir = path.join(this.getOutputDir(), `${projectName.replace(/[^a-zA-Z0-9_\-]/g, '_')}-${targetPlatform}`);
    // The target in the name keeps the local and AWS downloads of one workflow apart.
    const zipFilename = `${projectName.replace(/[\\/<>:"|?*\x00-\x1f]/g, '_') || 'backend'}-${targetPlatform}.zip`;
    await this.writeProject(result, outputDir, zipFilename);
    console.log(`[compiler] Compilation succeeded: ${result.files.length} files, download ${zipFilename}`);

    return {
      status: 'success',
      targetPlatform,
      zipFilename,
      downloadUrl: `/api/compiler/downloads/${encodeURIComponent(zipFilename)}`,
      outputDirectory: outputDir,
      manifest: result.manifest,
      filesCount: result.files.length,
    };
  }

  async findZipFile(filename: string): Promise<string | null> {
    if (filename !== path.basename(filename) || filename.includes('\\') || !filename.endsWith('.zip')) return null;
    const baseDir = this.getOutputDir();
    if (!fs.existsSync(baseDir)) return null;
    for (const entry of await fs.promises.readdir(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      for (const candidate of [path.join(baseDir, entry.name, filename), path.join(baseDir, entry.name, 'compiled', filename)]) {
        if (fs.existsSync(candidate)) return candidate;
      }
    }
    const rootCandidate = path.join(baseDir, filename);
    return fs.existsSync(rootCandidate) ? rootCandidate : null;
  }

  /**
   * Writes the project into an emptied folder (so nothing from an earlier compilation survives),
   * builds dist/ and packages both archives.
   */
  private async writeProject(result: CompilationSuccess, outputDir: string, zipFilename: string): Promise<void> {
    await fs.promises.rm(outputDir, { recursive: true, force: true });
    for (const file of result.files) {
      const filePath = path.join(outputDir, file.path);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, file.content, 'utf8');
    }
    try {
      await BuildProfile.fromManifest(result.manifest).build(outputDir, [this.dependencyDirectory()]);
    } catch (error) {
      throw new CompilerValidationError(`Backend build failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const distDir = path.join(outputDir, 'dist');
    const bundle = await Promise.all((await fs.promises.readdir(distDir)).map(async (entry) => ({
      path: entry,
      content: await fs.promises.readFile(path.join(distDir, entry)),
    })));
    await fs.promises.mkdir(path.join(outputDir, 'compiled'), { recursive: true });
    await fs.promises.writeFile(path.join(outputDir, 'compiled', 'function.zip'), await createZipArchive(bundle));
    await fs.promises.writeFile(
      path.join(outputDir, zipFilename),
      await createZipArchive([...result.files, ...bundle.map((file) => ({ ...file, path: `dist/${file.path}` }))]),
    );
  }

  /** RunFlux's own node_modules, which provides the npm packages a function bundle includes. */
  private dependencyDirectory(): string {
    return path.join(path.resolve(this.getPluginsDir(), '..'), 'node_modules');
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
