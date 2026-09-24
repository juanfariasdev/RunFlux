import { PluginRegistry } from '@runflux/plugin-system/plugin-registry';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
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

    const registry = new PluginRegistry();
    await registry.discover({ pluginDirectories: [this.getPluginsDir()], onLog: (message) => {
      if (process.env.NODE_ENV !== 'test') console.info(message);
    } });
    for (const manifest of registry.listManifests()) {
      this.pluginsCache.set(manifest.id, {
        manifest,
        generators: Object.fromEntries(manifest.supportedPlatforms.map((platform) => [platform, registry.resolveGenerator(manifest.id, platform)])),
      });
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
      throw new CompilerValidationError('Invalid workflow: nodes must be defined.');
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

    // 1. Compilação do scaffold através do core compiler
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

    // 3. Gravação física de cada arquivo fonte na pasta
    for (const file of result.files) {
      const filePath = path.join(outputDir, file.path);
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.writeFile(filePath, file.content, 'utf8');
    }

    // 4. Empacotamento leve com esbuild (gerando dist/ e compiled/function.zip)
    const distDir = path.join(outputDir, 'dist');
    const compiledDir = path.join(outputDir, 'compiled');
    await fs.promises.mkdir(distDir, { recursive: true });
    await fs.promises.mkdir(compiledDir, { recursive: true });

    try {
      if (targetPlatform === 'local') {
        const entryPoints = [
          path.join(outputDir, 'src', 'server.ts'),
          path.join(outputDir, 'src', 'run.ts'),
        ];
        const runCronPath = path.join(outputDir, 'src', 'run-cron.ts');
        if (fs.existsSync(runCronPath)) {
          entryPoints.push(runCronPath);
        }
        await esbuild.build({
          entryPoints,
          bundle: true,
          format: 'esm',
          splitting: true,
          packages: 'external',
          outExtension: { '.js': '.mjs' },
          platform: 'node',
          target: 'node22',
          banner: {
            js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
          },
          outdir: distDir,
        });
      } else {
        await esbuild.build({
          entryPoints: [
            path.join(outputDir, 'src', 'handler.ts'),
          ],
          bundle: true,
          format: 'esm',
          outExtension: { '.js': '.mjs' },
          platform: 'node',
          target: 'node22',
          banner: {
            js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
          },
          outdir: distDir,
        });
      }
      console.log(`[compiler] esbuild bundle created successfully in ${distDir}`);
    } catch (bundleErr) {
      throw new CompilerValidationError(`Backend build failed: ${bundleErr instanceof Error ? bundleErr.message : String(bundleErr)}`);
    }

    // 5. Coleta dos arquivos em dist/ para criar o pacote leve (function.zip e <projeto>.zip)
    const distEntries = fs.existsSync(distDir) ? await fs.promises.readdir(distDir) : [];
    const bundledFilesForZip: { path: string; content: string | Uint8Array }[] = [];

    for (const entry of distEntries) {
      const entryPath = path.join(distDir, entry);
      if (fs.statSync(entryPath).isFile()) {
        const buffer = await fs.promises.readFile(entryPath);
        bundledFilesForZip.push({ path: entry, content: buffer });
      }
    }

    const zipBuffer = bundledFilesForZip.length > 0
      ? await createZipArchive(bundledFilesForZip)
      : (result.zipBuffer ? Buffer.from(result.zipBuffer) : await createZipArchive(result.files));

    // Grava compiled/function.zip (padrão esbuild/serverless)
    const functionZipPath = path.join(compiledDir, 'function.zip');
    await fs.promises.writeFile(functionZipPath, zipBuffer);

    // Grava <projeto>.zip na raiz da pasta do backend
    const zipFilename = `${projectName.replace(/[\\/<>:"|?*\x00-\x1f]/g, '_') || 'backend'}.zip`;
    const zipPath = path.join(outputDir, zipFilename);
    const projectZip = await createZipArchive([
      ...result.files,
      ...bundledFilesForZip.map((file) => ({ ...file, path: `dist/${file.path}` })),
    ]);
    await fs.promises.writeFile(zipPath, projectZip);

    console.log(`[compiler] Compilation succeeded: ${result.files.length} source files, esbuild bundle in dist/, zip created at ${zipPath} (${zipBuffer.length} bytes)`);
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
    if (filename !== path.basename(filename) || filename.includes('\\') || !filename.endsWith('.zip')) return null;
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
        const functionZipCandidate = path.join(baseDir, entry.name, 'compiled', filename);
        if (fs.existsSync(functionZipCandidate)) {
          console.log(`[compiler] Serving download for "${filename}" from ${functionZipCandidate}`);
          return functionZipCandidate;
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
