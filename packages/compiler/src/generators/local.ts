import type { WorkflowDefinition } from '@runflux/workflow-model';
import type { GeneratedFile, CompilationOptions } from '../types.js';

export interface LocalGeneratorContext {
  workflow: WorkflowDefinition;
  projectName: string;
  nodeFiles: GeneratedFile[];
  options?: CompilationOptions;
}

export function generateLocalProject(context: LocalGeneratorContext): GeneratedFile[] {
  const { workflow, projectName, nodeFiles, options } = context;
  const port = options?.port || 3000;
  const sanitizedPkgName = projectName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'runflux-app';

  const packageJsonContent = JSON.stringify(
    {
      name: sanitizedPkgName,
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: {
        clean: 'rm -rf dist compiled',
        build: 'NODE_ENV=production npm run clean && esbuild src/server.ts src/run.ts --bundle --format=esm --splitting --out-extension:.js=.mjs --platform=node --target=node24 --banner:js="import { createRequire } from \'module\'; const require = createRequire(import.meta.url);" --outdir=dist',
        package: 'npm run build && rm -rf compiled && mkdir -p compiled && zip -j compiled/function.zip dist/*',
        start: 'node dist/server.mjs',
        run: 'node dist/run.mjs',
        dev: 'tsx watch src/server.ts',
      },
      dependencies: {
        cors: '^2.8.5',
        dotenv: '^16.4.5',
        express: '^4.21.0',
      },
      devDependencies: {
        '@types/cors': '^2.8.17',
        '@types/express': '^4.17.21',
        '@types/node': '^22.5.0',
        esbuild: '^0.28.2',
        tsx: '^4.19.0',
        typescript: '^5.5.4',
      },
    },
    null,
    2
  );

  const tsconfigContent = JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        rootDir: 'src',
        outDir: 'dist',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
      },
      include: ['src/**/*.ts'],
    },
    null,
    2
  );

  const dockerfileContent = `FROM node:20-alpine
WORKDIR /app
COPY dist ./dist
EXPOSE ${port}
CMD ["node", "dist/server.mjs"]
`;

  const envExampleContent = `PORT=${port}
NODE_ENV=production
`;

  // Montagem das importações e pipeline de execução
  const importsList: string[] = [];
  const executionsList: string[] = [];

  nodeFiles.forEach((file, index) => {
    const importName = `nodeModule_${index}`;
    const relativeModulePath = file.path.replace(/^src\//, './').replace(/\.ts$/, '.js');
    importsList.push(`import * as ${importName} from '${relativeModulePath}';`);
    executionsList.push(`
    // Executa etapa: ${file.path}
    if (typeof ${importName}.run === 'function') {
      const stepResult = await ${importName}.run(currentPayload);
      if (stepResult && typeof stepResult === 'object' && 'activeOutput' in stepResult) {
        if (stepResult.activeOutput === null) {
          console.log('[RunFlux Execution] Fluxo finalizado/filtrado no nó: ${file.path}');
          return { success: true, result: null, haltedAt: '${file.path}' };
        }
        currentPayload = stepResult.value !== undefined ? stepResult.value : stepResult;
      } else {
        currentPayload = stepResult !== undefined ? stepResult : currentPayload;
      }
    }`);
  });

  const serverTsContent = `import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
${importsList.join('\n')}

dotenv.config();

const app = express();
const port = process.env.PORT || ${port};

app.use(cors());
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    project: '${projectName}',
    workflowId: '${workflow.id}',
    nodeCount: ${workflow.nodes.length}
  });
});

app.post('/api/execute', async (req: Request, res: Response) => {
  try {
    let currentPayload: any = req.body || {};
${executionsList.join('\n')}

    res.json({
      success: true,
      result: currentPayload
    });
  } catch (error: any) {
    console.error('[RunFlux Server Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Erro durante a execução do workflow'
    });
  }
});

app.listen(port, () => {
  console.log(\`[RunFlux Server] Servidor compilado rodando na porta \${port}\`);
});
`;

  const runTsContent = `import dotenv from 'dotenv';
${importsList.join('\n')}

dotenv.config();

export async function runWorkflow(initialPayload: any = {}) {
  let currentPayload: any = initialPayload;
${executionsList.join('\n')}
  return { success: true, result: currentPayload };
}

// Execução direta como script de linha de comando
const isDirectRun =
  process.argv[1]?.endsWith('run.ts') ||
  process.argv[1]?.endsWith('run.js') ||
  process.argv[1]?.endsWith('run.mjs');

if (isDirectRun) {
  let input = {};
  if (process.argv[2]) {
    try {
      input = JSON.parse(process.argv[2]);
    } catch {
      input = { raw: process.argv[2] };
    }
  }
  console.log('[RunFlux CLI] Executando workflow "${projectName}" com entrada:', JSON.stringify(input));
  runWorkflow(input)
    .then((out) => {
      console.log('[RunFlux CLI] Execução finalizada com sucesso:');
      console.log(JSON.stringify(out, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[RunFlux CLI] Erro na execução:', err);
      process.exit(1);
    });
}
`;

  const files: GeneratedFile[] = [
    { path: 'package.json', content: packageJsonContent, type: 'config' },
    { path: 'tsconfig.json', content: tsconfigContent, type: 'config' },
    { path: 'Dockerfile', content: dockerfileContent, type: 'infrastructure' },
    { path: '.env.example', content: envExampleContent, type: 'config' },
    { path: 'src/server.ts', content: serverTsContent, type: 'source' },
    { path: 'src/run.ts', content: runTsContent, type: 'source' },
    ...nodeFiles,
  ];

  return files;
}
