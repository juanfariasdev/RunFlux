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
        dev: 'tsx watch src/server.ts',
        build: 'tsc',
        start: 'node dist/server.js',
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
        "strict": true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
      },
      include: ['src/**/*.ts'],
    },
    null,
    2
  );

  const dockerfileContent = `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

EXPOSE ${port}
CMD ["node", "dist/server.js"]
`;

  const envExampleContent = `PORT=${port}
NODE_ENV=production
`;

  // Montagem do server.ts
  const importsList: string[] = [];
  const executionsList: string[] = [];

  nodeFiles.forEach((file, index) => {
    const importName = `nodeModule_${index}`;
    const relativeModulePath = file.path.replace(/^src\//, './').replace(/\.ts$/, '.js');
    importsList.push(`import * as ${importName} from '${relativeModulePath}';`);
    executionsList.push(`
    // Executa etapa: ${file.path}
    if (typeof ${importName}.run === 'function') {
      currentPayload = await ${importName}.run(currentPayload);
    } else if (typeof ${importName}.execute === 'function') {
      currentPayload = await ${importName}.execute(currentPayload);
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

  const files: GeneratedFile[] = [
    { path: 'package.json', content: packageJsonContent, type: 'config' },
    { path: 'tsconfig.json', content: tsconfigContent, type: 'config' },
    { path: 'Dockerfile', content: dockerfileContent, type: 'infrastructure' },
    { path: '.env.example', content: envExampleContent, type: 'config' },
    { path: 'src/server.ts', content: serverTsContent, type: 'source' },
    ...nodeFiles,
  ];

  return files;
}
