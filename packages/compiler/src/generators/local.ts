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
  const sanitizedPkgName =
    projectName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'runflux-app';

  // Detect special trigger nodes in workflow
  const cronNode = workflow.nodes.find((n) => n.pluginId === 'trigger-cron');
  const webhookNodes = workflow.nodes.filter((n) => n.pluginId === 'trigger-webhook');

  const hasCron = Boolean(cronNode);
  const hasWebhook = webhookNodes.length > 0;

  const cronExpression = (cronNode?.parameters?.expression as string) || '*/15 * * * *';
  const cronTimezone = (cronNode?.parameters?.timezone as string) || 'UTC';

  // Scripts and dependencies
  const buildEntrypoints = ['src/server.ts', 'src/run.ts'];
  if (hasCron) {
    buildEntrypoints.push('src/run-cron.ts');
  }

  const scripts: Record<string, string> = {
    clean: 'rm -rf dist compiled',
    build: `NODE_ENV=production npm run clean && esbuild ${buildEntrypoints.join(' ')} --bundle --format=esm --splitting --packages=external --out-extension:.js=.mjs --platform=node --target=node24 --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" --outdir=dist`,
    package: 'npm run build && rm -rf compiled && mkdir -p compiled && zip -j compiled/function.zip dist/*',
    start: 'node dist/server.mjs',
    run: 'node dist/run.mjs',
    dev: 'tsx watch src/server.ts',
  };

  if (hasCron) {
    scripts.cron = 'node dist/run-cron.mjs';
  }

  const dependencies: Record<string, string> = {
    cors: '^2.8.5',
    dotenv: '^16.4.5',
    express: '^4.21.0',
  };

  const devDependencies: Record<string, string> = {
    '@types/cors': '^2.8.17',
    '@types/express': '^4.17.21',
    '@types/node': '^22.5.0',
    esbuild: '^0.28.2',
    tsx: '^4.19.0',
    typescript: '^5.5.4',
  };

  if (hasCron) {
    dependencies['node-cron'] = '^3.0.3';
    devDependencies['@types/node-cron'] = '^3.0.11';
  }

  const packageJsonContent = JSON.stringify(
    {
      name: sanitizedPkgName,
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts,
      dependencies,
      devDependencies,
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

  let envExampleContent = `PORT=${port}
NODE_ENV=production
`;
  if (hasWebhook) {
    envExampleContent += `WEBHOOK_SECRET=your-webhook-secret-token\n`;
  }
  if (hasCron) {
    envExampleContent += `ENABLE_INLINE_CRON=false\nCRON_TIMEZONE=${cronTimezone}\n`;
  }

  let readmeContent = `# ${projectName}

Standalone backend compiled with [RunFlux](https://runflux.io).

## Project Overview
- **Workflow ID:** \`${workflow.id}\`
- **Total Nodes:** ${workflow.nodes.length}
- **Architecture:** Express + TypeScript, bundled with \`esbuild\`

## Running the Application

### 1. Run as Standalone CLI
Execute the workflow directly with JSON arguments:
\`\`\`bash
npm run run '{"example": "payload"}'
\`\`\`

### 2. Run as HTTP API Server
\`\`\`bash
npm run start
\`\`\`
- Health Check: \`GET http://localhost:${port}/health\`
- Execute Default Workflow: \`POST http://localhost:${port}/api/execute\`
`;

  if (hasWebhook) {
    readmeContent += `\n### 3. Configured Webhook Endpoints\n`;
    webhookNodes.forEach((node) => {
      const p = (node.parameters?.path as string) || '/webhook';
      const m = ((node.parameters?.httpMethod as string) || 'POST').toUpperCase();
      const auth = (node.parameters?.auth as string) || 'none';
      readmeContent += `- \`${m} http://localhost:${port}${p}\` (Auth: ${auth})\n`;
    });
  }

  if (hasCron) {
    readmeContent += `\n### 4. Scheduled Cron Worker
Run the dedicated background cron scheduler:
\`\`\`bash
npm run cron
\`\`\`
Schedule: \`${cronExpression}\` (Timezone: ${cronTimezone})
`;
  }

  readmeContent += `\n### Build & Package
\`\`\`bash
npm run build    # Produces optimized dist/*.mjs bundles
npm run package  # Creates compiled/function.zip
\`\`\`
`;

  // Assembly of imports and execution pipeline
  const importsList: string[] = [];
  const executionsList: string[] = [];

  nodeFiles.forEach((file, index) => {
    const importName = `nodeModule_${index}`;
    const relativeModulePath = file.path.replace(/^src\//, './').replace(/\.ts$/, '.js');
    importsList.push(`import * as ${importName} from '${relativeModulePath}';`);
    executionsList.push(`
    // Execute step: ${file.path}
    if (typeof ${importName}.run === 'function') {
      const stepResult = await ${importName}.run(currentPayload);
      if (stepResult && typeof stepResult === 'object' && 'activeOutput' in stepResult) {
        if (stepResult.activeOutput === null) {
          return { success: true, result: null, haltedAt: '${file.path}' };
        }
        currentPayload = stepResult.value !== undefined ? stepResult.value : stepResult;
      } else {
        currentPayload = stepResult !== undefined ? stepResult : currentPayload;
      }
    }`);
  });

  // Webhook express routes
  let webhookRoutesCode = '';
  if (hasWebhook) {
    webhookNodes.forEach((wn) => {
      const p = (wn.parameters?.path as string) || '/webhook';
      const m = ((wn.parameters?.httpMethod as string) || 'POST').toLowerCase();
      const method = m === 'any' ? 'all' : m;
      const auth = (wn.parameters?.auth as string) || 'none';
      const secretEnvVar = (wn.parameters?.secretEnvVar as string) || 'WEBHOOK_SECRET';

      webhookRoutesCode += `
app.${method}('${p}', async (req: Request, res: Response) => {
  ${
    auth === 'secret'
      ? `const expectedSecret = process.env.${secretEnvVar};
  const clientSecret = req.headers['x-webhook-secret'];
  if (!expectedSecret || clientSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing X-Webhook-Secret header' });
  }`
      : ''
  }

  try {
    const webhookPayload = {
      body: req.body,
      headers: req.headers,
      query: req.query,
      path: '${p}',
      method: req.method,
      receivedAt: new Date().toISOString(),
    };
    const execution = await runWorkflow(webhookPayload);
    if (!execution.success) {
      return res.status(500).json(execution);
    }
    return res.status(200).json(execution);
  } catch (err: any) {
    console.error('[RunFlux Webhook Error]', err);
    return res.status(500).json({ success: false, error: err.message || 'Error processing webhook' });
  }
});
`;
    });
  }

  let cronInlineCode = '';
  if (hasCron) {
    cronInlineCode = `
if (process.env.ENABLE_INLINE_CRON === 'true') {
  cron.schedule('${cronExpression}', async () => {
    console.log('[RunFlux Inline Cron] Triggering scheduled execution...');
    try {
      const payload = {
        triggeredAt: new Date().toISOString(),
        cronExpression: '${cronExpression}',
        timezone: '${cronTimezone}',
      };
      await runWorkflow(payload);
    } catch (err) {
      console.error('[RunFlux Inline Cron Error]', err);
    }
  }, {
    timezone: '${cronTimezone}'
  });
  console.log('[RunFlux Server] Inline cron enabled: "${cronExpression}"');
}
`;
  }

  const serverTsContent = `import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
${hasCron ? "import cron from 'node-cron';" : ''}
import { runWorkflow } from './run.js';

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
    nodeCount: ${workflow.nodes.length},
    timestamp: new Date().toISOString()
  });
});

app.post('/api/execute', async (req: Request, res: Response) => {
  try {
    const payload = req.body || {};
    const execution = await runWorkflow(payload);
    res.json(execution);
  } catch (error: any) {
    console.error('[RunFlux Server Error]', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Error during workflow execution'
    });
  }
});
${webhookRoutesCode}
${cronInlineCode}
app.listen(port, () => {
  console.log(\`[RunFlux Server] Compiled server running on port \${port}\`);
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

// Direct CLI execution
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
  console.log('[RunFlux CLI] Executing workflow "${projectName}" with input:', JSON.stringify(input));
  runWorkflow(input)
    .then((out) => {
      console.log('[RunFlux CLI] Execution completed successfully:');
      console.log(JSON.stringify(out, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('[RunFlux CLI] Execution error:', err);
      process.exit(1);
    });
}
`;

  const files: GeneratedFile[] = [
    { path: 'package.json', content: packageJsonContent, type: 'config' },
    { path: 'tsconfig.json', content: tsconfigContent, type: 'config' },
    { path: 'Dockerfile', content: dockerfileContent, type: 'infrastructure' },
    { path: '.env.example', content: envExampleContent, type: 'config' },
    { path: 'README.md', content: readmeContent, type: 'asset' },
    { path: 'src/server.ts', content: serverTsContent, type: 'source' },
    { path: 'src/run.ts', content: runTsContent, type: 'source' },
    ...nodeFiles,
  ];

  if (hasCron) {
    const runCronTsContent = `import dotenv from 'dotenv';
import cron from 'node-cron';
import { runWorkflow } from './run.js';

dotenv.config();

const CRON_EXPRESSION = ${JSON.stringify(cronExpression)};
const CRON_TIMEZONE = process.env.CRON_TIMEZONE || ${JSON.stringify(cronTimezone)};

console.log(\`[RunFlux Cron Worker] Starting cron worker for workflow "${projectName}"\`);
console.log(\`[RunFlux Cron Worker] Schedule: "\${CRON_EXPRESSION}" (Timezone: \${CRON_TIMEZONE})\`);

cron.schedule(
  CRON_EXPRESSION,
  async () => {
    const timestamp = new Date().toISOString();
    console.log(\`[RunFlux Cron Worker] [\${timestamp}] Triggering scheduled execution...\`);
    try {
      const payload = {
        triggeredAt: timestamp,
        cronExpression: CRON_EXPRESSION,
        timezone: CRON_TIMEZONE,
      };
      const result = await runWorkflow(payload);
      console.log(\`[RunFlux Cron Worker] [\${timestamp}] Execution result:\`, JSON.stringify(result));
    } catch (err) {
      console.error(\`[RunFlux Cron Worker] [\${timestamp}] Execution error:\`, err);
    }
  },
  {
    timezone: CRON_TIMEZONE,
  }
);
`;
    files.push({ path: 'src/run-cron.ts', content: runCronTsContent, type: 'source' });
  }

  return files;
}
