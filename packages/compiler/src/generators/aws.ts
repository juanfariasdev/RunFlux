import type { WorkflowDefinition } from '@runflux/workflow-model';
import type { GeneratedFile, CompilationOptions } from '../types.js';

export interface AwsGeneratorContext {
  workflow: WorkflowDefinition;
  projectName: string;
  nodeFiles: GeneratedFile[];
  options?: CompilationOptions;
}

export function generateAwsProject(context: AwsGeneratorContext): GeneratedFile[] {
  const { workflow, projectName, nodeFiles } = context;
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
  const cronNode = workflow.nodes.find((n) => n.pluginId === 'trigger-cron');
  const webhookNode = workflow.nodes.find((n) => n.pluginId === 'trigger-webhook');

  const hasCron = Boolean(cronNode);
  const hasWebhook = Boolean(webhookNode);

  const cronExpression = (cronNode?.parameters?.expression as string) || '*/15 * * * *';
  const webhookSecretEnvVar = (webhookNode?.parameters?.secretEnvVar as string) || 'WEBHOOK_SECRET';
  const webhookAuth = (webhookNode?.parameters?.authentication as string) || (webhookNode?.parameters?.auth as string) || "none";
  const webhookHeaderName = (webhookNode?.parameters?.headerName as string) || "X-Webhook-Secret";

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
        build: 'NODE_ENV=production npm run clean && esbuild src/handler.ts --bundle --format=esm --out-extension:.js=.mjs --platform=node --target=node24 --banner:js="import { createRequire } from \'module\'; const require = createRequire(import.meta.url);" --outdir=dist',
        package: 'npm run build && rm -rf compiled && mkdir -p compiled && zip -j compiled/function.zip dist/*',
        cdk: 'cdk',
        deploy: 'cdk deploy',
      },
      dependencies: {
        'aws-cdk-lib': '^2.155.0',
        constructs: '^10.3.0',
        'source-map-support': '^0.5.21',
      },
      devDependencies: {
        '@types/aws-lambda': '^8.10.145',
        '@types/node': '^22.5.0',
        'aws-cdk': '^2.155.0',
        esbuild: '^0.28.2',
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
        rootDir: '.',
        outDir: 'dist',
        strict: true,
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
      app: 'node --loader tsx bin/app.ts',
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
- **Lambda Function:** Bundled via \`esbuild\` into ultra-lightweight \`dist/handler.mjs\` (~2.5 KB)
- **Zero Runtime Dependencies:** No \`node_modules\` required inside the deployment zip
- **Infrastructure as Code:** AWS CDK Stack in \`lib/workflow-stack.ts\`
- **Endpoint:** AWS Lambda Function URL (Public HTTP endpoint with CORS support)
`;

  if (hasCron) {
    readmeContent += `\n- **Scheduled Cron:** AWS EventBridge Rule triggering Lambda on schedule: \`${cronExpression}\`\n`;
  }
  if (hasWebhook) {
    readmeContent += `\n- **Webhook Security:** Protected via \`${webhookSecretEnvVar}\` environment variable (Auth: ${webhookAuth})\n`;
  }

  readmeContent += `\n## Commands
\`\`\`bash
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
  description: 'Compiled stack by RunFlux for project ${projectName}',
});
`;

  // CDK lib/workflow-stack.ts
  const cdkImports = [
    "import * as cdk from 'aws-cdk-lib';",
    "import { Stack, StackProps } from 'aws-cdk-lib';",
    "import * as lambda from 'aws-cdk-lib/aws-lambda';",
    "import { Construct } from 'constructs';",
    "import * as path from 'node:path';",
  ];

  if (hasCron) {
    cdkImports.push("import * as events from 'aws-cdk-lib/aws-events';");
    cdkImports.push("import * as targets from 'aws-cdk-lib/aws-events-targets';");
  }

  let cronCdkBlock = '';
  if (hasCron) {
    cronCdkBlock = `
    // Scheduled EventBridge Rule
    const cronRule = new events.Rule(this, 'WorkflowCronRule', {
      schedule: events.Schedule.expression('cron(${cronExpression})'),
      description: 'Scheduled trigger for workflow ${projectName}',
    });
    cronRule.addTarget(new targets.LambdaFunction(workflowFunction));
`;
  }

  const libStackContent = `${cdkImports.join('\n')}

export class WorkflowStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const workflowFunction = new lambda.Function(this, 'WorkflowFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/handler.mjs',
      code: lambda.Code.fromAsset(path.join(__dirname, '..', 'compiled', 'function.zip')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        WORKFLOW_NAME: '${projectName}',
        NODE_ENV: 'production',
        ${hasWebhook ? `${webhookSecretEnvVar}: process.env.${webhookSecretEnvVar} || '',` : ''}
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
          return {
            statusCode: 200,
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
              'Access-Control-Allow-Headers': '*',
              'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
            },
            body: JSON.stringify({ success: true, result: null, haltedAt: '${file.path}' }),
          };
        }
        currentPayload = stepResult.value !== undefined ? stepResult.value : stepResult;
      } else {
        currentPayload = stepResult !== undefined ? stepResult : currentPayload;
      }
    }`);
  });

  let webhookAuthCheck = '';
  if (hasWebhook && (webhookAuth === "secret" || webhookAuth === "headerAuth")) {
    webhookAuthCheck = `
    const expectedSecret = process.env.${webhookSecretEnvVar};
    if (expectedSecret) {
      const clientSecret = event?.headers?.['x-webhook-secret'] || event?.headers?.['X-Webhook-Secret'];
      if (!clientSecret || clientSecret !== expectedSecret) {
        return {
          statusCode: 401,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
          },
          body: JSON.stringify({ error: 'Unauthorized: invalid or missing X-Webhook-Secret header' }),
        };
      }
    }
`;
  }

  const handlerContent = `import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
${importsList.join('\n')}

export const handler = async (event: APIGatewayProxyEventV2 | any): Promise<APIGatewayProxyResultV2> => {
  try {
${webhookAuthCheck}
    let currentPayload: any = {};
    if (event && event.body !== undefined) {
      currentPayload = typeof event.body === 'string' ? JSON.parse(event.body || '{}') : event.body;
    } else if (event && typeof event === 'object' && Object.keys(event).length > 0) {
      currentPayload = event;
    }
${executionsList.join('\n')}

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
      },
      body: JSON.stringify({
        success: true,
        result: currentPayload,
      }),
    };
  } catch (error: any) {
    console.error('[RunFlux Lambda Error]', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
      },
      body: JSON.stringify({
        success: false,
        error: error.message || 'Error during workflow execution on AWS',
      }),
    };
  }
};
`;

  const files: GeneratedFile[] = [
    { path: 'package.json', content: packageJsonContent, type: 'config' },
    { path: 'tsconfig.json', content: tsconfigContent, type: 'config' },
    { path: 'cdk.json', content: cdkJsonContent, type: 'config' },
    { path: 'README.md', content: readmeContent, type: 'asset' },
    { path: 'bin/app.ts', content: binAppContent, type: 'infrastructure' },
    { path: 'lib/workflow-stack.ts', content: libStackContent, type: 'infrastructure' },
    { path: 'src/handler.ts', content: handlerContent, type: 'source' },
    ...nodeFiles,
  ];

  return files;
}
