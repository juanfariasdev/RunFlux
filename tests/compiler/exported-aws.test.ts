import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import type { WorkflowInfrastructure } from '@runflux/compiler';
import { afterAll, afterEach, beforeAll, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { WorkflowInfrastructure as StackInfrastructure } from '../../packages/compiler/templates/aws/lib/workflow-stack';
import { ExportedProject } from '../support/exported-project';
import { compile, edge, node, workflow } from '../support/workflows';

type Handler = (event: object) => Promise<{ statusCode: number; headers: Record<string, string>; body: string }>;

const projects: ExportedProject[] = [];
afterAll(() => Promise.all(projects.map((project) => project.dispose())));
afterEach(() => vi.unstubAllEnvs());

async function exported(definition: Parameters<typeof compile>[0]): Promise<ExportedProject> {
  const project = await ExportedProject.write(await compile(definition, 'aws', "Customer's backend"));
  projects.push(project);
  return project;
}

const http = (rawPath: string, method: string, extra: object = {}) => ({ rawPath, requestContext: { http: { method } }, ...extra });

it('keeps the infrastructure settings the compiler writes and the exported stack reads identical', () => {
  expectTypeOf<WorkflowInfrastructure>().toEqualTypeOf<StackInfrastructure>();
});

describe('exported AWS Lambda function', () => {
  let handler: Handler;

  beforeAll(async () => {
    const project = await (await exported(workflow([
      node('orders', 'trigger-webhook', { path: '/orders', authentication: 'headerAuth', headerName: 'X-Orders-Key', secretEnvVar: 'ORDERS_KEY' }),
      node('events', 'trigger-webhook', { path: '/events', rawBody: true }),
      node('nightly', 'trigger-cron', { expression: '0 3 * * *' }),
      node('total', 'set', { fields: [{ name: 'total', value: '{{ $json.amount * 2 }}', type: 'number' }] }),
    ], [edge('orders', 'total')]))).build();
    ({ handler } = await project.import<{ handler: Handler }>('dist/handler.mjs'));
  });

  it('bundles one self-contained handler', async () => {
    const [project] = projects;
    expect(project.result.manifest.build).toEqual({ entryPoints: ['src/handler.ts'], bundleDependencies: true });
  });

  it('requires the secret of a webhook, even when its variable is absent', async () => {
    vi.stubEnv('ORDERS_KEY', '');
    expect((await handler(http('/orders', 'POST', { headers: {}, body: '{}' }))).statusCode).toBe(401);
  });

  it('routes a request to its trigger with the lower-cased headers and the query', async () => {
    vi.stubEnv('ORDERS_KEY', 'correct');
    const response = await handler(http('/orders', 'POST', { headers: { 'X-Orders-Key': 'correct' }, queryStringParameters: { page: '2' }, body: '{"amount":21}' }));
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({ success: true, result: { total: 42 }, nodeOutputs: { orders: { amount: 21, _query: { page: '2' } } } });
    expect(Object.keys(body.nodeOutputs)).toEqual(['orders', 'total']);
  });

  it('decodes base64 raw bodies and rejects unknown paths, other methods and invalid JSON', async () => {
    const event = http('/events', 'POST', { body: Buffer.from('plain text').toString('base64'), isBase64Encoded: true });
    expect(JSON.parse((await handler(event)).body).result).toMatchObject({ data: 'plain text' });
    expect((await handler({ ...event, rawPath: '/missing' })).statusCode).toBe(404);
    expect((await handler({ ...event, requestContext: { http: { method: 'GET' } } })).statusCode).toBe(405);
    vi.stubEnv('ORDERS_KEY', 'k');
    expect((await handler(http('/orders', 'POST', { headers: { 'x-orders-key': 'k' }, body: '{broken' }))).statusCode).toBe(400);
  });

  it('starts the trigger an EventBridge schedule names', async () => {
    const body = JSON.parse((await handler({ runfluxTriggerId: 'nightly' })).body);
    expect(body).toMatchObject({ success: true, result: { runfluxTriggerId: 'nightly', cronExpression: '0 3 * * *', timezone: 'UTC' } });
  });
});

describe('exported AWS CDK stack', () => {
  it('synthesizes the function, its URL, the environment and one schedule per cron trigger', async () => {
    const project = await exported(workflow([
      node('first', 'trigger-cron', { expression: '*/15 * * * *', timezone: 'America/Sao_Paulo' }),
      node('second', 'trigger-cron', { expression: '0 9 * * 1-5', timezone: 'America/Sao_Paulo' }),
      node('hook', 'trigger-webhook', { path: '/in', authentication: 'secret', secretEnvVar: 'HOOK_SECRET' }),
      node('db', 'database-query', { connectionEnvVar: 'ORDERS_DATABASE_URL' }),
    ], [edge('hook', 'db')], { settings: { envVars: [{ key: 'API_KEY', value: 'default-key' }] } }));
    const infrastructure = project.json('infrastructure.json');
    const { WorkflowStack } = await project.import('lib/workflow-stack.ts');
    const stack = new WorkflowStack(new App(), infrastructure.stackName, infrastructure, { code: lambda.Code.fromInline('export const handler = () => {}') });
    const template = Template.fromStack(stack);

    expect(infrastructure.stackName).toBe('CustomersbackendStack');
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs22.x',
      Handler: 'handler.handler',
      Environment: { Variables: { WORKFLOW_NAME: "Customer's backend", NODE_ENV: 'production', HOOK_SECRET: '', ORDERS_DATABASE_URL: '', API_KEY: 'default-key' } },
    });
    template.resourceCountIs('AWS::Lambda::Url', 1);
    template.resourceCountIs('AWS::Scheduler::Schedule', 2);
    template.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(*/15 * * * ? *)',
      ScheduleExpressionTimezone: 'America/Sao_Paulo',
      Target: Match.objectLike({ Input: JSON.stringify({ runfluxTriggerId: 'first' }) }),
    });
    template.hasResourceProperties('AWS::Scheduler::Schedule', { ScheduleExpression: 'cron(0 9 ? * 2-6 *)', Target: Match.objectLike({ Input: JSON.stringify({ runfluxTriggerId: 'second' }) }) });
    template.hasOutput('FunctionUrl', {});
  });

  it('gives a workflow without HTTP triggers no public URL', async () => {
    const project = await exported(workflow([node('nightly', 'trigger-cron', { expression: '0 3 * * *' })]));
    const { WorkflowStack } = await project.import('lib/workflow-stack.ts');
    const template = Template.fromStack(new WorkflowStack(new App(), 'Stack', project.json('infrastructure.json'), { code: lambda.Code.fromInline('x') }));
    template.resourceCountIs('AWS::Lambda::Url', 0);
    expect(Object.keys(template.findOutputs('*'))).not.toContain('FunctionUrl');
    template.resourceCountIs('AWS::Scheduler::Schedule', 1);
  });

  it('deploys dist/ as the function code by default', async () => {
    const project = await (await exported(workflow([node('hook', 'trigger-webhook')]))).build();
    const { WorkflowStack } = await project.import('lib/workflow-stack.ts');
    const template = Template.fromStack(new WorkflowStack(new App({ outdir: `${project.directory}/cdk.out` }), 'Stack', project.json('infrastructure.json')));
    template.hasResourceProperties('AWS::Lambda::Function', { Code: Match.objectLike({ S3Key: Match.stringLikeRegexp('\\.zip$') }) });
  });

  it('lets the deploying shell override the default of a variable', async () => {
    const project = await exported(workflow([node('hook', 'trigger-webhook')], [], { settings: { envVars: [{ key: 'API_KEY', value: 'default' }] } }));
    const { WorkflowStack } = await project.import('lib/workflow-stack.ts');
    vi.stubEnv('API_KEY', 'from-shell');
    const template = Template.fromStack(new WorkflowStack(new App(), 'Stack', project.json('infrastructure.json'), { code: lambda.Code.fromInline('x') }));
    template.hasResourceProperties('AWS::Lambda::Function', { Environment: { Variables: Match.objectLike({ API_KEY: 'from-shell' }) } });
    template.resourceCountIs('AWS::Scheduler::Schedule', 0);
  });

  it('refuses to export schedules EventBridge cannot keep', async () => {
    expect(await compile(workflow([node('cron', 'trigger-cron', { expression: '0 0 1 * 1' })]), 'aws')).toMatchObject({ status: 'failed', error: { code: 'INVALID_WORKFLOW', message: expect.stringContaining('Node "cron"') } });
  });
});
