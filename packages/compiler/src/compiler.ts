import type { WorkflowDefinition } from '@runflux/workflow-model';
import type {
  CompilationRequest,
  CompilationResult,
  PluginResolver,
  BuildManifest,
  GeneratedFile,
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

  // 3. Resolução e invocação dos geradores de nós
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
            const rawFileName = file.path ? file.path.replace(/^.*[\\\/]/, '') : `${node.pluginId}.ts`;
            const normalizedPath = file.path.startsWith('src/nodes/')
              ? file.path
              : `src/nodes/node-${i + 1}-${rawFileName}`;
            nodeFiles.push({
              path: normalizedPath,
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
  } else if (targetPlatform === 'aws') {
    projectFiles = generateAwsProject({
      workflow,
      projectName,
      nodeFiles,
      options,
    });
  } else {
    return {
      status: 'failed',
      error: {
        code: 'INCOMPATIBLE_NODES',
        message: `Plataforma '${targetPlatform}' não suportada.`,
      },
    };
  }

  // 5. Geração do manifesto de build (runflux-build.json)
  const buildManifest: BuildManifest = {
    runfluxVersion: '0.1.0',
    targetPlatform,
    workflowId: workflow.id,
    projectName,
    workflowVersion: projectVersion || 'v1',
    compiledAt: new Date().toISOString(),
    entrypoint: targetPlatform === 'local' ? 'src/server.ts' : 'src/handler.ts',
    nodeCount: workflow.nodes.length,
    pluginVersions,
    generatedFiles: projectFiles.map((f) => f.path),
  };

  const allFiles: GeneratedFile[] = [
    {
      path: 'runflux-build.json',
      content: JSON.stringify(buildManifest, null, 2),
      type: 'config',
    },
    ...projectFiles,
  ];

  // 6. Empacotamento zip em memória
  const zipBuffer = await createZipPackage(allFiles);

  return {
    status: 'success',
    projectName,
    targetPlatform,
    files: allFiles,
    manifest: buildManifest,
    zipBuffer,
  };
}
