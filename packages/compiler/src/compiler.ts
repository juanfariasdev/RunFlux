import { CyclicWorkflowError } from '@runflux/workflow-model';
import { transformSync } from 'esbuild';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import type {
  CompilationRequest,
  CompilationResult,
  PluginResolver,
  BuildManifest,
  GeneratedFile,
  CompiledNodeEntry,
} from './types.js';
import { validateWorkflowCompatibility, getTopologicalNodeOrder, validateGraphReferences } from './validator.js';
import { generateLocalProject } from './generators/local.js';
import { generateAwsProject } from './generators/aws.js';
import { createZipPackage } from './packager.js';

export async function compileWorkflow(
  request: CompilationRequest,
  resolver: PluginResolver
): Promise<CompilationResult> {
  const { workflow, targetPlatform, projectName, projectVersion, options } = request;

  // 1. Fast-fail compatibility validation
  const validation = validateWorkflowCompatibility(workflow, targetPlatform, resolver);
  if (!validation.compatible) {
    return {
      status: 'failed',
      error: {
        code: 'INCOMPATIBLE_NODES',
        message: `Workflow contains ${validation.incompatibleNodes.length} node(s) without support for target platform '${targetPlatform}'.`,
        details: {
          incompatibleNodes: validation.incompatibleNodes,
        },
      },
    };
  }

  // 2. DAG topological node ordering
  let orderedNodes;
  try {
    validateGraphReferences(workflow, resolver);
    orderedNodes = getTopologicalNodeOrder(workflow);
  } catch (error) {
    return { status: 'failed', error: {
      code: error instanceof CyclicWorkflowError ? 'CYCLE_DETECTED' : 'INVALID_WORKFLOW',
      message: error instanceof Error ? error.message : String(error),
    } };
  }

  // 3. Resolve plugins and invoke node generators
  const nodeFiles: GeneratedFile[] = [];
  const nodeEntries: Record<string, CompiledNodeEntry> = Object.create(null);
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

        if (!artifact?.files?.length) throw new Error('Generator returned no entrypoint');
        if (artifact && Array.isArray(artifact.files)) {
          for (const file of artifact.files) {
            const relativePath = file.path.replace(/\\/g, '/').replace(/^src\/nodes\//, '');
            if (!relativePath || relativePath.startsWith('/') || relativePath.split('/').some((part) => part === '..' || part === '.') || relativePath.includes(':')) {
              throw new Error(`Unsafe artifact path "${file.path}"`);
            }
            const isTypeScript = relativePath.endsWith('.ts');
            const normalizedPath = `src/nodes/node-${i + 1}/${relativePath.replace(/\.ts$/, '.js')}`;
            if (nodeFiles.some((file) => file.path === normalizedPath)) throw new Error(`Duplicate artifact path "${file.path}"`);
            nodeEntries[node.id] ??= { path: normalizedPath, isTrigger: plugin.manifest.category === 'trigger', outputs: plugin.manifest.outputs };
            nodeFiles.push({
              path: normalizedPath,
              content: isTypeScript ? transformSync(file.content, { loader: 'ts', format: 'esm', target: 'node22' }).code : file.content,
              type: 'source',
            });
          }
        }
      } catch (err: any) {
        return {
          status: 'failed',
          error: {
            code: 'GENERATOR_ERROR',
            message: `Generator error in plugin '${node.pluginId}': ${err?.message || err}`,
          },
        };
      }
    } else {
      // Safe fallback generator
      nodeFiles.push({
        path: `src/nodes/node-${i + 1}-${node.pluginId}.ts`,
        content: `export async function run(input: any) { return input; }`,
        type: 'source',
      });
    }
  }

  // 4. Assemble project tree via target platform generator
  let projectFiles: GeneratedFile[];

  try {
  if (targetPlatform === 'local') {
    projectFiles = generateLocalProject({
      workflow,
      projectName,
      nodeFiles,
      nodeEntries,
      options,
    });
  } else if (targetPlatform === 'aws') {
    projectFiles = generateAwsProject({
      workflow,
      projectName,
      nodeFiles,
      nodeEntries,
      options,
    });
  } else {
    return {
      status: 'failed',
      error: {
        code: 'INCOMPATIBLE_NODES',
        message: `Target platform '${targetPlatform}' is not supported.`,
      },
    };
  }
  } catch (error) {
    return { status: 'failed', error: { code: 'INVALID_WORKFLOW', message: error instanceof Error ? error.message : String(error) } };
  }

  // 5. Build manifest generation (runflux-build.json)
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

  // 6. In-memory ZIP package creation
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
