import { buildLocalApp } from './templates/local-app.js';
import { generateRunnerRuntime } from './templates/runner-template.js';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import type { GeneratedFile, CompilationOptions, CompiledNodeEntry } from '../types.js';
import { generateGraphRunner } from './graph.js';

export interface LocalGeneratorContext {
  workflow: WorkflowDefinition;
  projectName: string;
  nodeFiles: GeneratedFile[];
  nodeEntries?: Record<string, CompiledNodeEntry>;
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
  const hasDatabase = workflow.nodes.some((n) => n.pluginId === 'database-query');

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
    build: `NODE_ENV=production npm run clean && esbuild ${buildEntrypoints.join(' ')} --bundle --format=esm --splitting --packages=external --out-extension:.js=.mjs --platform=node --target=node22 --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" --outdir=dist`,
    package: 'npm run build && rm -rf compiled && mkdir -p compiled && zip -j compiled/function.zip dist/*',
    start: 'node dist/server.mjs',
    run: 'node dist/run.mjs',
    dev: 'tsx watch src/server.ts',
    'docker:build': `docker build -t ${sanitizedPkgName} .`,
    'docker:up': 'docker compose up -d',
    'docker:down': 'docker compose down',
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

  if (hasDatabase) {
    dependencies['pg'] = '^8.13.0';
    devDependencies['@types/pg'] = '^8.11.10';
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
        allowJs: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
      },
      include: ['src/**/*.ts'],
    },
    null,
    2
  );

  const dockerfileContent = `# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci || npm install
COPY . .
RUN npm run build

# Stage 2: Runner
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=builder /app/dist ./dist
USER node
EXPOSE ${port}
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \\
  CMD wget -qO- http://localhost:${port}/health || exit 1
CMD ["node", "dist/server.mjs"]
`;

  let dockerComposeContent = `services:
  app:
    build: .
    restart: unless-stopped
    ports:
      - "\${PORT:-${port}}:${port}"
    env_file:
      - .env
    environment:
      - PORT=${port}
      - NODE_ENV=production
`;

  if (hasDatabase) {
    dockerComposeContent += `    depends_on:
      - postgres

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: \${POSTGRES_DB:-runflux}
    ports:
      - "\${POSTGRES_PORT:-5432}:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
`;
  }

  let envExampleContent = `PORT=${port}
NODE_ENV=production
`;
  if (hasWebhook) {
    envExampleContent += `WEBHOOK_SECRET=your-webhook-secret-token\n`;
  }
  if (hasCron) {
    envExampleContent += `ENABLE_INLINE_CRON=false\nCRON_TIMEZONE=${cronTimezone}\n`;
  }

  const customEnvVars = options?.envVars || workflow.settings?.envVars || [];
  if (customEnvVars.length > 0) {
    envExampleContent += `\n# Project Environment Variables\n`;
    customEnvVars.forEach((v) => {
      if (v.description) {
        envExampleContent += `# ${v.description}\n`;
      }
      envExampleContent += `${v.key}=${v.value ?? ''}\n`;
    });
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
      const auth = (node.parameters?.authentication as string) || (node.parameters?.auth as string) || 'none';
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

## Docker & Container Deployment

### 1. Build and Run with Docker Compose (Recommended)
\`\`\`bash
npm run docker:up
# Or directly:
docker compose up -d --build
\`\`\`
- Health Check: \`GET http://localhost:${port}/health\`
- View Logs: \`docker compose logs -f\`
- Stop Services: \`npm run docker:down\`

### 2. Standalone Docker Container
\`\`\`bash
npm run docker:build
docker run -d -p ${port}:${port} --env-file .env ${sanitizedPkgName}
\`\`\`
`;

  const runnerTsContent = generateGraphRunner(workflow, nodeFiles, context.nodeEntries);


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

  const appTsContent = buildLocalApp(workflow, projectName);
  const serverTsContent = `import 'dotenv/config';
import { app } from './app.js';
${hasCron ? "import cron from 'node-cron';" : ''}
import { runWorkflow } from './runner.js';
const port = Number(process.env.PORT || ${port});
${cronInlineCode}
app.listen(port, () => console.log('[RunFlux] Listening on port', port));
`;

  const runTsContent = `import dotenv from 'dotenv';
import { runWorkflow } from './runner.js';

dotenv.config();

export { runWorkflow };

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
  console.log(${JSON.stringify('[RunFlux CLI] Executing workflow ' + projectName + ' with input:')}, JSON.stringify(input));
  runWorkflow(input)
    .then((out) => {
      console.log('[RunFlux CLI] Execution completed successfully:');
      console.log(JSON.stringify(out, null, 2));
      process.exit(out.success ? 0 : 1);
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
    { path: 'docker-compose.yml', content: dockerComposeContent, type: 'infrastructure' },
    { path: '.env.example', content: envExampleContent, type: 'config' },
    { path: 'README.md', content: readmeContent, type: 'asset' },
    { path: 'src/runtime.js', content: generateRunnerRuntime(), type: 'source' },
    { path: 'src/runner.ts', content: runnerTsContent, type: 'source' },
    { path: 'src/app.ts', content: appTsContent, type: 'source' },
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
