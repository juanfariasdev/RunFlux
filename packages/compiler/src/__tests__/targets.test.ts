import { describe, expect, it } from 'vitest';
import { DeploymentPlanner } from '../deployment/deployment-plan.js';
import { AwsTarget } from '../targets/aws-target.js';
import { LocalTarget } from '../targets/local-target.js';
import { CompilationError, type GeneratedFile } from '../types.js';
import { resolveFixture } from './fixtures/plugins.js';
import { node, workflow } from './fixtures/workflows.js';

const planner = new DeploymentPlanner(resolveFixture);
const file = (files: GeneratedFile[], path: string) => {
  const found = files.find((candidate) => candidate.path === path);
  if (!found) throw new Error(`missing ${path}`);
  return found.content;
};

describe('LocalTarget', () => {
  const target = new LocalTarget();
  const generate = (nodes: Parameters<typeof workflow>[0], options = {}, extra = {}) =>
    target.files({ plan: planner.plan(workflow(nodes, [], extra)), projectName: "Customer's backend", options });

  it('generates the project around the static templates and the workflow document', async () => {
    const files = await generate([node('hook', 'webhook')]);
    expect(files.map((generated) => generated.path)).toEqual([
      'src/workflow.ts', '.dockerignore', 'Dockerfile', 'src/run.ts', 'src/server.ts', 'tsconfig.json',
      'src/workflow.json', 'package.json', '.env.example', 'docker-compose.yml', 'README.md',
    ]);
    expect(JSON.parse(file(files, 'src/workflow.json'))).toMatchObject({ schemaVersion: 1, triggers: { http: [{ nodeId: 'hook', path: '/hook' }] } });
  });

  it('declares the vendored runtime, the hosts and the plugins dependencies', async () => {
    const manifest = JSON.parse(file(await generate([node('hook', 'webhook'), node('save', 'store')]), 'package.json'));
    expect(manifest).toMatchObject({ name: 'customer-s-backend', private: true, type: 'module' });
    expect(manifest.dependencies).toEqual({
      '@runflux/runtime': 'file:./vendor/runflux-runtime', cors: '^2.8.5', dotenv: '^16.4.5', express: '^4.21.0', 'fixture-driver': '^1.0.0',
    });
    expect(manifest.devDependencies).toMatchObject({ '@types/fixture-driver': '^1.0.0', esbuild: expect.any(String), typescript: expect.any(String) });
    expect(manifest.scripts).toMatchObject({
      build: 'npm run clean && esbuild src/server.ts src/run.ts --bundle --format=esm --splitting --packages=external --out-extension:.js=.mjs --platform=node --target=node22 --outdir=dist',
      start: 'node dist/server.mjs',
      run: 'node dist/run.mjs',
      'docker:build': 'docker build -t customer-s-backend .',
      'docker:up': 'docker compose up -d',
      'docker:down': 'docker compose down',
    });
    expect(manifest.scripts.cron).toBeUndefined();
  });

  it('adds the cron worker, its script and node-cron only when a schedule exists', async () => {
    const files = await generate([node('hourly', 'schedule')]);
    const manifest = JSON.parse(file(files, 'package.json'));
    expect(files.map((generated) => generated.path)).toContain('src/run-cron.ts');
    expect(manifest.scripts.cron).toBe('node dist/run-cron.mjs');
    expect(manifest.scripts.build).toContain('src/run-cron.ts');
    expect(manifest.dependencies['node-cron']).toBe('^4.6.0');
    expect(file(files, '.env.example')).toContain('ENABLE_INLINE_CRON=false');
    expect(file(files, 'README.md')).toContain('`0 * * * *` (timezone UTC, trigger `hourly`)');
    expect((await generate([node('hook', 'webhook')])).map((generated) => generated.path)).not.toContain('src/run-cron.ts');
  });

  it('lists the configured port and every environment variable once, with descriptions and values', async () => {
    const env = file(await generate([node('hook', 'webhook', { secret: 'KEY' }), node('save', 'store')], { port: 8080 }, {
      settings: { envVars: [{ key: 'KEY', value: 'configured' }, { key: 'STRIPE_SECRET_KEY', value: 'sk_test', description: 'Stripe token' }] },
    }), '.env.example');
    expect(env).toBe([
      'PORT=8080', 'NODE_ENV=production', '', '# Project Environment Variables',
      'KEY=configured', '# Store connection', 'STORE_URL=', '# Stripe token', 'STRIPE_SECRET_KEY=sk_test', '',
    ].join('\n'));
  });

  it('writes a compose file with the plugins companion services and volumes', async () => {
    expect(file(await generate([node('save', 'store')]), 'docker-compose.yml')).toBe([
      'services:',
      '  app:',
      '    build: .',
      '    restart: unless-stopped',
      '    ports:',
      '      - ${PORT:-3000}:3000',
      '    env_file:',
      '      - .env',
      '    environment:',
      '      - PORT=3000',
      '      - NODE_ENV=production',
      '    depends_on:',
      '      - store',
      '  store:',
      '    image: store:1',
      '    restart: unless-stopped',
      '    ports:',
      '      - "7000:7000"',
      '    volumes:',
      '      - data:/data',
      'volumes:',
      '  data: {}',
      '',
    ].join('\n'));
    const standalone = file(await generate([node('hook', 'webhook')]), 'docker-compose.yml');
    expect(standalone).not.toContain('depends_on');
    expect(standalone).not.toContain('volumes');
  });

  it('documents the endpoints of the workflow', async () => {
    expect(file(await generate([node('hook', 'webhook', { path: '/orders', secret: 'KEY' })]), 'README.md'))
      .toContain('Webhook `POST http://localhost:3000/orders` (requires `X-Key` = `$KEY`)');
    expect(file(await generate([node('run', 'echo')]), 'README.md')).toContain('Run the workflow: `POST http://localhost:3000/api/execute`');
  });

  it('builds the entry points it generates', () => {
    const plan = planner.plan(workflow([node('hourly', 'schedule')]));
    expect(target.buildProfile(plan).entryPoints).toEqual(['src/server.ts', 'src/run.ts', 'src/run-cron.ts']);
    expect(target.buildProfile(plan).bundleDependencies).toBe(false);
  });
});

describe('AwsTarget', () => {
  const target = new AwsTarget();
  const plan = (nodes: Parameters<typeof workflow>[0], extra = {}) => planner.plan(workflow(nodes, [], extra));

  it('generates the Lambda handler, the CDK app and its infrastructure settings', async () => {
    const files = await target.files({ plan: plan([node('hook', 'webhook')]), projectName: "Customer's backend", options: {} });
    expect(files.map((generated) => generated.path)).toEqual([
      'src/workflow.ts', 'bin/app.ts', 'cdk.json', 'lib/workflow-stack.ts', 'src/handler.ts', 'tsconfig.json',
      'src/workflow.json', 'infrastructure.json', 'package.json', 'README.md',
    ]);
    const manifest = JSON.parse(file(files, 'package.json'));
    expect(manifest.scripts).toMatchObject({ package: 'npm run build && mkdir -p compiled && zip -j compiled/function.zip dist/*', deploy: 'npm run package && cdk deploy' });
    expect(manifest.scripts.build).toContain('--banner:js=');
    expect(manifest.dependencies).toMatchObject({ '@runflux/runtime': 'file:./vendor/runflux-runtime', 'aws-cdk-lib': expect.any(String), constructs: expect.any(String) });
    expect(manifest.devDependencies.tsx).toBeDefined();
  });

  it('translates every schedule and keeps its timezone and trigger', () => {
    const infrastructure = target.infrastructure(plan([node('first', 'schedule', { expression: '*/15 * * * *' }), node('second', 'schedule', { expression: '0 9 * * 1-5' })], {
      settings: { envVars: [{ key: 'API_KEY', value: 'secret' }, { key: 'EMPTY' }] },
    }), "Customer's schedules");
    expect(infrastructure).toEqual({
      stackName: 'CustomersschedulesStack',
      description: "Compiled stack by RunFlux for project Customer's schedules",
      workflowName: "Customer's schedules",
      environment: [{ key: 'API_KEY', value: 'secret' }, { key: 'EMPTY', value: '' }],
      schedules: [
        { nodeId: 'first', expression: 'cron(*/15 * * * ? *)', timezone: 'UTC' },
        { nodeId: 'second', expression: 'cron(0 9 ? * 2-6 *)', timezone: 'UTC' },
      ],
    });
  });

  it('rejects schedules EventBridge cannot express, naming the node', () => {
    expect(() => target.infrastructure(plan([node('monthly', 'schedule', { expression: '0 0 1 * 1' })]), 'X'))
      .toThrow(new CompilationError('INVALID_WORKFLOW', 'Node "monthly": AWS cron cannot combine day-of-month and day-of-week constraints'));
  });

  it('bundles the handler and its dependencies into one function', () => {
    const profile = target.buildProfile();
    expect(profile.entryPoints).toEqual(['src/handler.ts']);
    expect(profile.bundleDependencies).toBe(true);
  });
});
