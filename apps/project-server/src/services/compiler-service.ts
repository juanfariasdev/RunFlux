import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import {
  compileWorkflow,
  validateWorkflowCompatibility,
  createZipArchive,
  type TargetPlatform,
  type CompiledPlugin,
  type IncompatibleNode,
  type PluginResolver,
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
  manifest: unknown;
  filesCount: number;
}

export class CompilerService {
  private pluginsCache = new Map<string, CompiledPlugin>();
  private pluginsLoaded = false;

  constructor(
    private readonly customPluginsDir?: string,
    private readonly customOutputDir?: string,
  ) {}

  private getPluginsDir(): string {
    if (this.customPluginsDir && fs.existsSync(this.customPluginsDir)) {
      return this.customPluginsDir;
    }
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(process.cwd(), 'plugins'),
      path.resolve(process.cwd(), '../../plugins'),
      path.resolve(currentDir, '../../../../plugins'),
      path.resolve(currentDir, '../../../plugins'),
    ];
    for (const cand of candidates) {
      if (fs.existsSync(cand)) return cand;
    }
    return path.resolve(process.cwd(), 'plugins');
  }

  getOutputDir(): string {
    if (this.customOutputDir) {
      return this.customOutputDir;
    }
    if (process.env.RUNFLUX_OUTPUT_DIR) {
      return path.resolve(process.env.RUNFLUX_OUTPUT_DIR);
    }
    const pluginsDir = this.getPluginsDir();
    const repoRoot = path.resolve(pluginsDir, '..');
    return path.join(repoRoot, 'output-backends');
  }

  async loadPlugins(): Promise<void> {
    if (this.pluginsLoaded && this.pluginsCache.size > 0) {
      return;
    }

    const pluginsDir = this.getPluginsDir();
    if (!fs.existsSync(pluginsDir)) {
      this.pluginsLoaded = true;
      return;
    }

    const entries = await fs.promises.readdir(pluginsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const pluginFolder = path.join(pluginsDir, entry.name);
      const candidates = ['index.ts', 'index.js', 'dist/index.js'];
      let entryFile: string | null = null;
      for (const cand of candidates) {
        const full = path.join(pluginFolder, cand);
        if (fs.existsSync(full)) {
          entryFile = full;
          break;
        }
      }

      if (!entryFile) continue;

      try {
        const fileUrl = pathToFileURL(entryFile).href;
        const mod = await import(fileUrl);
        if (mod.manifest && mod.manifest.id) {
          const generators = mod.generators || {};
          if (generators.local && !generators.aws) {
            generators.aws = generators.local;
          }
          this.pluginsCache.set(mod.manifest.id, {
            manifest: mod.manifest,
            generators,
          });
        }
      } catch (err) {
        console.warn(`[CompilerService] Failed to load plugin at ${pluginFolder}:`, err);
      }
    }

    this.pluginsLoaded = true;
  }

  private createPluginResolver(): PluginResolver {
    return (pluginId: string): CompiledPlugin | undefined => {
      return this.pluginsCache.get(pluginId);
    };
  }

  async compile(request: CompileWorkflowRequest): Promise<CompileWorkflowResponse> {
    if (!request.workflow || !Array.isArray(request.workflow.nodes)) {
      throw new CompilerValidationError('Workflow inválido: deve conter nós definidos.');
    }

    await this.loadPlugins();

    const targetPlatform: TargetPlatform =
      (request.targetPlatform || request.target || 'local').toLowerCase() as TargetPlatform;

    if (targetPlatform !== 'local' && targetPlatform !== 'aws') {
      throw new CompilerValidationError(`Plataforma alvo inválida: "${targetPlatform}". Suportadas: local, aws.`);
    }

    const resolver = this.createPluginResolver();
    const projectName = (request.projectName || request.workflow.name || 'runflux-project').trim();
    console.log(`[compiler] Starting compilation for project "${projectName}" (target: ${targetPlatform}, skipTests: ${request.skipTests ?? true})`);

    // 1. Compilação através do compiler
    const result = await compileWorkflow(
      {
        workflow: request.workflow,
        targetPlatform,
        projectName,
        options: {
          skipTests: request.skipTests ?? true,
        },
      },
      resolver,
    );

    if (result.status === 'failed') {
      if (result.error.code === 'INCOMPATIBLE_NODES') {
        throw new IncompatibleNodesError(result.error.details?.incompatibleNodes || []);
      }
      throw new CompilerValidationError(result.error.message);
    }

    // 2. Preparação dos diretórios de saída físicos
    const sanitizedProjectName = projectName.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const folderName = `${sanitizedProjectName}-${targetPlatform}`;
    const baseDir = this.getOutputDir();
    const outputDir = path.join(baseDir, folderName);

    await fs.promises.mkdir(outputDir, { recursive: true });

    // 3. Gravação física de cada arquivo gerado na pasta
    for (const file of result.files) {
      const filePath = path.join(outputDir, file.path);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, file.content, 'utf8');
    }

    // 4. Empacotamento zip gerado dentro da pasta (Requisito 2)
    const zipFilename = `${projectName}.zip`;
    const zipBuffer = result.zipBuffer ? Buffer.from(result.zipBuffer) : await createZipArchive(result.files);
    const zipPath = path.join(outputDir, zipFilename);
    await fs.promises.writeFile(zipPath, zipBuffer);

    console.log(`[compiler] Compilation succeeded: ${result.files.length} files generated, zip created at ${zipPath}`);
    const downloadUrl = `/api/compiler/downloads/${encodeURIComponent(zipFilename)}`;

    return {
      status: 'success',
      targetPlatform,
      zipFilename,
      downloadUrl,
      outputDirectory: outputDir,
      manifest: result.manifest,
      filesCount: result.files.length,
    };
  }

  async findZipFile(filename: string): Promise<string | null> {
    const baseDir = this.getOutputDir();
    if (!fs.existsSync(baseDir)) return null;

    const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidate = path.join(baseDir, entry.name, filename);
        if (fs.existsSync(candidate)) {
          console.log(`[compiler] Serving download for "${filename}" from ${candidate}`);
          return candidate;
        }
      }
    }

    const rootCandidate = path.join(baseDir, filename);
    if (fs.existsSync(rootCandidate)) {
      return rootCandidate;
    }

    return null;
  }
}
