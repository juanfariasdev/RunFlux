import { getSchedules, toAwsCron } from './schedules.js';
import { getEnvironmentVariables } from './environment.js';
import { getWebhookConfig } from '@runflux/plugin-system/webhook-config';
import { buildAwsHandler } from './templates/aws-handler.js';
import { generateRunnerRuntime } from './templates/runner-template.js';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import type { GeneratedFile, CompilationOptions, CompiledNodeEntry } from '../types.js';
import { generateGraphRunner } from './graph.js';

export interface AwsGeneratorContext {
  workflow: WorkflowDefinition;
  projectName: string;
  nodeFiles: GeneratedFile[];
  nodeEntries?: Record<string, CompiledNodeEntry>;
  options?: CompilationOptions;
}

export function generateAwsProject(context: AwsGeneratorContext): GeneratedFile[] {
  const { workflow, projectName, nodeFiles, options } = context;
  const sanitizedPkgName =
    projectName
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'runflux-aws-app';

  const stackName = projectName.replace(/[^a-zA-Z0-9]/g, '') + 'Stack' || 'WorkflowStack';

  // Detect triggers
  const schedules = getSchedules(workflow);
  const webhooks = workflow.nodes.filter((node) => node.pluginId === 'trigger-webhook').map((node) => getWebhookConfig(node.parameters));
  const hasDatabase = workflow.nodes.some((node) => node.pluginId === 'database-query');
  const hasCron = schedules.length > 0;

  const dependencies: Record<string, string> = {
    'aws-cdk-lib': '^2.177.0',
    constructs: '^10.3.0',
    'source-map-support': '^0.5.21',
  };
  if (hasDatabase) {
    dependencies['pg'] = '^8.13.0';
  }

  const packageJsonContent = JSON.stringify(
    {
      name: sanitizedPkgName,
      version: '1.0.0',
      private: true,
      type: 'module',
      bin: {
        [sanitizedPkgName]: 'bin/app.js',
      },
      scripts: {
        clean: 'rm -rf dist compiled',
        build: 'NODE_ENV=production npm run clean && esbuild src/handler.ts --bundle --format=esm --out-extension:.js=.mjs --platform=node --target=node22 --banner:js="import { createRequire } from \'module\'; const require = createRequire(import.meta.url);" --outdir=dist',
        package: 'npm run build && rm -rf compiled && mkdir -p compiled && zip -j compiled/function.zip dist/*',
        cdk: 'cdk',
        deploy: 'npm run package && cdk deploy',
      },
      dependencies,
      devDependencies: {
        '@types/aws-lambda': '^8.10.145',
        '@types/node': '^22.5.0',
        'aws-cdk': '^2.177.0',
        esbuild: '^0.28.2',
        typescript: '^5.5.4',
        tsx: '^4.19.0',
        ...(hasDatabase ? { '@types/pg': '^8.11.10' } : {}),
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
        rootDir: '.',
        outDir: 'dist',
        strict: true,
        allowJs: true,
        esModuleInterop: true,
        skipLibCheck: true,
      },
      include: ['bin/**/*.ts', 'lib/**/*.ts', 'src/**/*.ts'],
    },
    null,
    2
  );

  const cdkJsonContent = JSON.stringify(
    {
      app: 'npx tsx bin/app.ts',
      watch: {
        include: ['**'],
        exclude: ['README.md', 'cdk*.json', '**/*.d.ts', '**/*.js', 'tsconfig.json', 'package*.json'],
      },
    },
    null,
    2
  );

  let readmeContent = `# ${projectName} (AWS Serverless Backend)

Compiled serverless backend for AWS Lambda and AWS CDK generated with [RunFlux](https://runflux.io).

## Architecture
- **Lambda Function:** Bundled via \`esbuild\` into \`dist/handler.mjs\`
- **Zero Runtime Dependencies:** No \`node_modules\` required inside the deployment zip
- **Infrastructure as Code:** AWS CDK Stack in \`lib/workflow-stack.ts\`
- **Endpoint:** AWS Lambda Function URL (Public HTTP endpoint with CORS support)
`;

  for (const schedule of schedules) {
    readmeContent += `\n- **Schedule:** ${schedule.expression} (timezone: ${schedule.timezone}, trigger: ${schedule.nodeId}) via EventBridge Scheduler\n`;
  }
  for (const webhook of webhooks) {
    readmeContent += `\n- **Webhook:** ${webhook.method} ${webhook.path}; authentication: ${webhook.authentication}${webhook.authentication === 'none' ? '' : '; header: ' + webhook.headerName + '; secret environment variable: ' + webhook.secretEnvVar}\n`;
  }

  readmeContent += `\n## Commands
Use Node.js 22 or newer and AWS credentials configured for the target account. Set the required environment variables in the deployment shell before running CDK.
\`\`\`bash
npm install
npm run build    # Compile TypeScript & bundle with esbuild
npm run package  # Package dist/* into compiled/function.zip
npm run deploy   # Deploy the CloudFormation stack to AWS
\`\`\`
`;

  const binAppContent = `#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WorkflowStack } from '../lib/workflow-stack.js';

const app = new cdk.App();
new WorkflowStack(app, '${stackName}', {
  description: ${JSON.stringify('Compiled stack by RunFlux for project ' + projectName)},
});
`;

  // CDK lib/workflow-stack.ts
  const cdkImports = [
    "import * as cdk from 'aws-cdk-lib';",
    "import { Stack, StackProps } from 'aws-cdk-lib';",
    "import * as lambda from 'aws-cdk-lib/aws-lambda';",
    "import { Construct } from 'constructs';",
    "import { fileURLToPath } from 'node:url';",
  ];

  if (hasCron) {
    cdkImports.push("import * as scheduler from 'aws-cdk-lib/aws-scheduler';");
    cdkImports.push("import * as iam from 'aws-cdk-lib/aws-iam';");
  }

  const cronCdkBlock = hasCron ? `
    const schedulerRole = new iam.Role(this, 'SchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    workflowFunction.grantInvoke(schedulerRole);
${schedules.map((schedule, index) => `
    new scheduler.CfnSchedule(this, 'WorkflowSchedule${index + 1}', {
      scheduleExpression: ${JSON.stringify(toAwsCron(schedule.expression))},
      scheduleExpressionTimezone: ${JSON.stringify(schedule.timezone)},
      flexibleTimeWindow: { mode: 'OFF' },
      target: { arn: workflowFunction.functionArn, roleArn: schedulerRole.roleArn,
        input: ${JSON.stringify(JSON.stringify({ runfluxTriggerId: schedule.nodeId }))} },
    });`).join('\n')}
` : '';

  const customEnvVars = getEnvironmentVariables(workflow, options);
  const customEnvEntries = customEnvVars.map(
    (v) => `        ${JSON.stringify(v.key)}: process.env[${JSON.stringify(v.key)}] || ${JSON.stringify(v.value ?? '')},`
  );
  const customEnvBlock = customEnvEntries.length > 0 ? `\n${customEnvEntries.join('\n')}` : '';

  const libStackContent = `${cdkImports.join('\n')}

export class WorkflowStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const workflowFunction = new lambda.Function(this, 'WorkflowFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset(fileURLToPath(new URL('../compiled/function.zip', import.meta.url))),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        WORKFLOW_NAME: ${JSON.stringify(projectName)},
        NODE_ENV: 'production',
        ${customEnvBlock}
      },
    });

    const functionUrl = workflowFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
      },
    });

    new cdk.CfnOutput(this, 'FunctionUrl', {
      value: functionUrl.url,
      description: 'Public endpoint to invoke the compiled workflow',
    });
${cronCdkBlock}
  }
}
`;

  const runnerTsContent = generateGraphRunner(workflow, nodeFiles, context.nodeEntries);


  const handlerContent = buildAwsHandler(workflow);

  const files: GeneratedFile[] = [
    { path: 'package.json', content: packageJsonContent, type: 'config' },
    { path: 'tsconfig.json', content: tsconfigContent, type: 'config' },
    { path: 'cdk.json', content: cdkJsonContent, type: 'config' },
    { path: 'README.md', content: readmeContent, type: 'asset' },
    { path: 'bin/app.ts', content: binAppContent, type: 'infrastructure' },
    { path: 'lib/workflow-stack.ts', content: libStackContent, type: 'infrastructure' },
    { path: 'src/runtime.js', content: generateRunnerRuntime(), type: 'source' },
    { path: 'src/runner.ts', content: runnerTsContent, type: 'source' },
    { path: 'src/handler.ts', content: handlerContent, type: 'source' },
    ...nodeFiles,
  ];

  return files;
}
