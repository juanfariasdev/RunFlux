import { describe, it, expect } from 'vitest';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import type { CompiledPlugin } from '../types.js';
import { compileWorkflow } from '../compiler.js';

describe('Triggers Catalog Compilation (Cron & Webhook)', () => {
  const cronPlugin: CompiledPlugin = {
    manifest: {
      id: 'trigger-cron',
      name: 'Cron Trigger',
      category: 'trigger',
      version: '1.0.0',
      parameters: [
        { name: 'expression', label: 'Cron Expression', type: 'string', required: true, default: '*/15 * * * *' },
        { name: 'timezone', label: 'Timezone', type: 'string', required: false, default: 'UTC' },
      ],
      supportedPlatforms: ['local', 'aws'],
      outputs: ['main'],
    },
    generators: {
      local: (nodeConfig) => ({
        files: [
          {
            path: 'trigger-cron.ts',
            content: `export const CRON_EXPRESSION = ${JSON.stringify(nodeConfig.expression || '*/15 * * * *')};
export const CRON_TIMEZONE = ${JSON.stringify(nodeConfig.timezone || 'UTC')};
export function run(input: any) { return { ...input, triggeredAt: new Date().toISOString() }; }`,
          },
        ],
        infra: [],
      }),
      aws: (nodeConfig, ctx) => cronPlugin.generators!.local(nodeConfig, ctx),
    },
  };

  const webhookPlugin: CompiledPlugin = {
    manifest: {
      id: 'trigger-webhook',
      name: 'Webhook Trigger',
      category: 'trigger',
      version: '1.0.0',
      parameters: [
        { name: 'path', label: 'Path', type: 'string', required: true, default: '/webhook' },
        { name: 'httpMethod', label: 'Method', type: 'string', required: true, default: 'POST' },
        { name: 'auth', label: 'Auth', type: 'string', required: false, default: 'none' },
      ],
      supportedPlatforms: ['local', 'aws'],
      outputs: ['main'],
    },
    generators: {
      local: (nodeConfig) => ({
        files: [
          {
            path: 'trigger-webhook.ts',
            content: `export const WEBHOOK_PATH = ${JSON.stringify(nodeConfig.path || '/webhook')};
export const WEBHOOK_METHOD = ${JSON.stringify(nodeConfig.httpMethod || 'POST')};
export function run(input: any) { return input; }`,
          },
        ],
        infra: [],
      }),
      aws: (nodeConfig, ctx) => webhookPlugin.generators!.local(nodeConfig, ctx),
    },
  };

  const resolver = (pluginId: string): CompiledPlugin | undefined => {
    if (pluginId === 'trigger-cron') return cronPlugin;
    if (pluginId === 'trigger-webhook') return webhookPlugin;
    return undefined;
  };

  it('compiles a workflow with trigger-cron for local and generates run-cron.ts and npm script', async () => {
    const cronWorkflow: WorkflowDefinition = {
      id: 'wf-cron-test',
      name: 'Scheduled Sync Workflow',
      nodes: [
        {
          id: 'node-cron',
          pluginId: 'trigger-cron',
          pluginVersion: '1.0.0',
          parameters: {
            expression: '*/5 * * * *',
            timezone: 'America/Sao_Paulo',
          },
          position: { x: 0, y: 0 },
        },
      ],
      connections: [],
    };

    const result = await compileWorkflow(
      {
        workflow: cronWorkflow,
        targetPlatform: 'local',
        projectName: 'Scheduled Sync',
      },
      resolver
    );

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      const paths = result.files.map((f) => f.path);
      expect(paths).toContain('src/run-cron.ts');
      expect(paths).toContain('package.json');

      const pkgJsonFile = result.files.find((f) => f.path === 'package.json');
      const parsedPkg = JSON.parse(pkgJsonFile!.content);
      expect(parsedPkg.scripts.cron).toBe('node dist/run-cron.mjs');
      expect(parsedPkg.scripts.build).toContain('src/run-cron.ts');
      expect(parsedPkg.dependencies['node-cron']).toBeDefined();

      const runCronFile = result.files.find((f) => f.path === 'src/run-cron.ts');
      expect(runCronFile!.content).toContain('CRON_EXPRESSION = "*/5 * * * *"');
      expect(runCronFile!.content).toContain('America/Sao_Paulo');
    }
  });

  it('compiles a workflow with trigger-cron for aws and includes EventBridge Rule in CDK', async () => {
    const cronWorkflow: WorkflowDefinition = {
      id: 'wf-cron-aws-test',
      name: 'AWS Scheduled Workflow',
      nodes: [
        {
          id: 'node-cron',
          pluginId: 'trigger-cron',
          pluginVersion: '1.0.0',
          parameters: {
            expression: '0 0 * * *',
          },
          position: { x: 0, y: 0 },
        },
      ],
      connections: [],
    };

    const result = await compileWorkflow(
      {
        workflow: cronWorkflow,
        targetPlatform: 'aws',
        projectName: 'AWS Scheduled Workflow',
      },
      resolver
    );

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      const stackFile = result.files.find((f) => f.path === 'lib/workflow-stack.ts');
      expect(stackFile).toBeDefined();
      expect(stackFile!.content).toContain("import * as events from 'aws-cdk-lib/aws-events';");
      expect(stackFile!.content).toContain('WorkflowCronRule');
      expect(stackFile!.content).toContain('events.Schedule.expression');
    }
  });

  it('compiles a workflow with trigger-webhook for local and generates express route with secret auth', async () => {
    const webhookWorkflow: WorkflowDefinition = {
      id: 'wf-webhook-test',
      name: 'Order Webhook Workflow',
      nodes: [
        {
          id: 'node-webhook',
          pluginId: 'trigger-webhook',
          pluginVersion: '1.0.0',
          parameters: {
            path: '/webhook/orders',
            httpMethod: 'POST',
            auth: 'secret',
            secretEnvVar: 'ORDER_SECRET',
          },
          position: { x: 0, y: 0 },
        },
      ],
      connections: [],
    };

    const result = await compileWorkflow(
      {
        workflow: webhookWorkflow,
        targetPlatform: 'local',
        projectName: 'Order Webhook',
      },
      resolver
    );

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      const serverFile = result.files.find((f) => f.path === 'src/server.ts');
      expect(serverFile).toBeDefined();
      expect(serverFile!.content).toContain("app.post('/webhook/orders'");
      expect(serverFile!.content).toContain("process.env.ORDER_SECRET");
      expect(serverFile!.content).toContain("x-webhook-secret");
      expect(serverFile!.content).toContain("401");

      const envFile = result.files.find((f) => f.path === '.env.example');
      expect(envFile!.content).toContain('WEBHOOK_SECRET');
    }
  });

  it('compiles a workflow with trigger-webhook for aws and includes secret check in handler', async () => {
    const webhookWorkflow: WorkflowDefinition = {
      id: 'wf-webhook-aws-test',
      name: 'AWS Webhook Workflow',
      nodes: [
        {
          id: 'node-webhook',
          pluginId: 'trigger-webhook',
          pluginVersion: '1.0.0',
          parameters: {
            path: '/events',
            httpMethod: 'POST',
            auth: 'secret',
            secretEnvVar: 'MY_SECRET',
          },
          position: { x: 0, y: 0 },
        },
      ],
      connections: [],
    };

    const result = await compileWorkflow(
      {
        workflow: webhookWorkflow,
        targetPlatform: 'aws',
        projectName: 'AWS Webhook',
      },
      resolver
    );

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      const handlerFile = result.files.find((f) => f.path === 'src/handler.ts');
      expect(handlerFile).toBeDefined();
      expect(handlerFile!.content).toContain("process.env.MY_SECRET");
      expect(handlerFile!.content).toContain("x-webhook-secret");
      expect(handlerFile!.content).toContain("statusCode: 401");
    }
  });
});
