import type {
  CompilationRequest,
  CompilationResult,
  PluginResolver,
  GeneratedFile,
  BuildManifest,
} from './types.js';
import { validateWorkflowCompatibility, getTopologicalNodeOrder } from './validator.js';
import { generateLocalProject } from './generators/local.js';
import { generateAwsProject } from './generators/aws.js';
import { createZipPackage } from './packager.js';

export async function compileWorkflow(
  request: CompilationRequest,
  resolver: PluginResolver
): Promise<CompilationResult> {
  const { workflow, targetPlatform, projectName, projectVersion, options } = request;

  // 1. Verificação rápida de compatibilidade (Fast-Fail)
  const validation = validateWorkflowCompatibility(workflow, targetPlatform, resolver);
  if (!validation.compatible) {
    return {
      status: 'failed',
      error: {
        code: 'INCOMPATIBLE_NODES',
        message: `O workflow contém ${validation.incompatibleNodes.length} nó(s) sem suporte à plataforma '${targetPlatform}'.`,
        details: {
          incompatibleNodes: validation.incompatibleNodes,
        },
      },
    };
  }

  // 2. Ordenação topológica do DAG
  const orderedNodes = getTopologicalNodeOrder(workflow);

  // 3. Execução dos geradores de nós declarados pelos plugins
  const nodeFiles: GeneratedFile[] = [];
  const pluginVersions: Record<string, string> = {};

  for (let i = 0; i < orderedNodes.length; i++) {
    const node = orderedNodes[i];
    const plugin = resolver(node.pluginId);
    if (!plugin) continue;

    pluginVersions[node.pluginId] = plugin.manifest.version;

    const generatorFn = plugin.generators?.[targetPlatform];
    if (typeof generatorFn === 'function') {
      try {
        const artifact = await generatorFn(node.parameters || {}, {
          workflowId: workflow.id,
          nodeId: node.id,
        });

        if (artifact && Array.isArray(artifact.files)) {
          for (const file of artifact.files) {
            nodeFiles.push({
              path: file.path || `src/nodes/node-${i + 1}-${node.pluginId}.ts`,
              content: file.content || '',
              type: 'source',
            });
          }
        }
      } catch (err: any) {
        return {
          status: 'failed',
          error: {
            code: 'GENERATOR_ERROR',
            message: `Erro no gerador do plugin '${node.pluginId}': ${err?.message || err}`,
          },
        };
      }
    } else {
      // Fallback seguro de geração caso não emita arquivo
      nodeFiles.push({
        path: `src/nodes/node-${i + 1}-${node.pluginId}.ts`,
        content: `export async function run(input: any) { return input; }`,
        type: 'source',
      });
    }
  }

  // 4. Montagem da árvore do projeto pelo gerador da plataforma
  let projectFiles: GeneratedFile[];
  if (targetPlatform === 'local') {
    projectFiles = generateLocalProject({
      workflow,
      projectName,
      nodeFiles,
      options,
    });
  } else {
    projectFiles = generateAwsProject({
      workflow,
      projectName,
      nodeFiles,
      options,
    });
  }

  // 5. Manifesto de build (runflux-build.json)
  const manifest: BuildManifest = {
    $schema: 'https://runflux.dev/schemas/v1/build-manifest.json',
    runfluxVersion: '0.1.0',
    projectName,
    workflowId: workflow.id,
    workflowVersion: projectVersion || 'v1',
    targetPlatform,
    compiledAt: new Date().toISOString(),
    entrypoint: targetPlatform === 'local' ? 'src/server.ts' : 'src/handler.ts',
    nodeCount: workflow.nodes.length,
    pluginVersions,
    generatedFiles: projectFiles.map((f) => f.path),
  };

  const manifestFile: GeneratedFile = {
    path: 'runflux-build.json',
    content: JSON.stringify(manifest, null, 2),
    type: 'config',
  };

  const allFiles = [...projectFiles, manifestFile];

  // 6. Empacotamento zip em memória
  const zipBuffer = await createZipPackage(allFiles);

  return {
    status: 'success',
    projectName,
    targetPlatform,
    files: allFiles,
    manifest,
    zipBuffer,
  };
}
