import { describe, expect, it } from 'vitest';
import { DeploymentPlanner } from '../deployment/deployment-plan.js';
import { AwsTarget } from '../targets/aws-target.js';
import { LocalTarget } from '../targets/local-target.js';
import { CompilationError, type GeneratedFile } from '../types.js';
import { resolveFixture } from './fixtures/plugins.js';
import { node, workflow } from './fixtures/workflows.js';

const planner = new DeploymentPlanner(resolveFixture);
const hostDependencies = { cors: '^2.8.5', express: '^4.21.0', 'node-cron': '^4.6.0' };
const file = (files: GeneratedFile[], path: string) => {
  const found = files.find((candidate) => candidate.path === path);
  if (!found) throw new Error(`missing ${path}`);
  return found.content;
};
const paths = (files: GeneratedFile[]) => files.map((generated) => generated.path).sort();

describe('LocalTarget', () => {
  const target = new LocalTarget();
  const generate = async (nodes: Parameters<typeof workflow>[0], options = {}, extra = {}) =>
    target.files({ plan: planner.plan(workflow(nodes, [], extra)), projectName: "Customer's backend", options, hostDependencies });

  it('generates the project around the static templates and the workflow document', async () => {
    const files = await generate([node('hook', 'webhook')]);
    expect(paths(files)).toEqual([
      '.dockerignore', '.env.example', 'Dockerfile', 'README.md', 'docker-compose.yml', 'package.json',
      'src/lifecycle.ts', 'src/run.ts', 'src/server.ts', 'src/workflow.json', 'src/workflow.ts', 'tsconfig.json',
    ]);
    expect(JSON.parse(file(files, 'src/workflow.json'))).toMatchObject({ schemaVersion: 1, triggers: { http: [{ nodeId: 'hook', path: '/hook' }] } });
  });

  it('declares the vendored runtime, the hosts at the versions it is given and the plugins dependencies', async () => {
    const manifest = JSON.parse(file(await generate([node('hook', 'webhook'), node('save', 'store')]), 'package.json'));
    expect(manifest).toMatchObject({ name: 'customer-s-backend', private: true, type: 'module', engines: { node: '>=22' } });
    expect(manifest.dependencies).toEqual({
      '@runflux/runtime': 'file:./vendor/runflux-runtime', cors: '^2.8.5', dotenv: '^16.4.5', express: '^4.21.0', 'fixture-driver': '^1.0.0',
    });
    expect(Object.keys(manifest.dependencies)).toEqual(Object.keys(manifest.dependencies).sort());
    expect(manifest.devDependencies).toMatchObject({ '@types/fixture-driver': '^1.0.0', esbuild: expect.any(String), typescript: expect.any(String) });
    expect(manifest.scripts).toMatchObject({
      build: 'npm run clean && esbuild src/server.ts src/run.ts --bundle --format=esm --splitting --packages=external --alias:@runflux/runtime=./vendor/runflux-runtime --out-extension:.js=.mjs --platform=node --target=node22 --outdir=dist',
      start: 'node dist/server.mjs',
      run: 'node dist/run.mjs',
      'docker:build': 'docker build -t customer-s-backend .',
      'docker:up': 'docker compose up -d',
      'docker:down': 'docker compose down',
    });
    expect(manifest.scripts.cron).toBeUndefined();
  });

  it('adds the cron worker, its script, its compose service and node-cron only when a schedule exists', async () => {
    const files = await generate([node('hourly', 'schedule')]);
    const manifest = JSON.parse(file(files, 'package.json'));
    expect(paths(files)).toContain('src/run-cron.ts');
    expect(manifest.scripts.cron).toBe('node dist/run-cron.mjs');
    expect(manifest.scripts.build).toContain('src/run-cron.ts');
    expect(manifest.dependencies['node-cron']).toBe('^4.6.0');
    expect(file(files, '.env.example')).toContain('ENABLE_INLINE_CRON=false');
    expect(file(files, 'README.md')).toContain('`0 * * * *` (timezone UTC, trigger `hourly`)');
    expect(file(files, 'docker-compose.yml')).toContain([
      '  cron:',
      '    build: .',
      '    restart: unless-stopped',
      '    command:',
      '      - node',
      '      - dist/run-cron.mjs',
      '    env_file:',
      '      - .env',
      '    environment:',
      '      - NODE_ENV=production',
      '    healthcheck:',
      '      disable: true',
    ].join('\n'));
    expect(file(files, 'docker-compose.yml')).toContain('      - ENABLE_INLINE_CRON=false');

    const withoutSchedules = await generate([node('hook', 'webhook')]);
    expect(paths(withoutSchedules)).not.toContain('src/run-cron.ts');
    expect(JSON.parse(file(withoutSchedules, 'package.json')).dependencies['node-cron']).toBeUndefined();
    expect(file(withoutSchedules, 'docker-compose.yml')).not.toContain('cron');
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

  it('quotes values and keeps descriptions on comment lines, so the file reads back as written', async () => {
    const env = file(await generate([node('hook', 'webhook')], {}, {
      settings: { envVars: [
        { key: 'GREETING', value: 'hello world # not a comment', description: 'First line\nSECOND=line' },
        { key: 'QUOTED', value: "it's" },
        { key: 'MULTILINE', value: 'a\nb' },
      ] },
    }), '.env.example');
    expect(env).toContain(["# First line", '# SECOND=line', "GREETING='hello world # not a comment'", `QUOTED="it's"`, 'MULTILINE="a\\nb"'].join('\n'));
  });

  it.each([
    [[{ key: 'BAD-NAME', value: '1' }], 'The workflow settings: "BAD-NAME" is not an environment variable name'],
    [[{ key: 'MIXED', value: `it's "$HOME"\n` }], 'The value of MIXED mixes quotes'],
  ])('rejects environment variables a .env file cannot hold: %j', async (envVars, message) => {
    await expect(generate([node('hook', 'webhook')], {}, { settings: { envVars } })).rejects.toThrow(message);
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

  it('builds the entry points it generates and leaves its host packages external', () => {
    const plan = planner.plan(workflow([node('hourly', 'schedule')]));
    expect(target.buildProfile(plan).entryPoints).toEqual(['src/server.ts', 'src/run.ts', 'src/run-cron.ts']);
    expect(target.buildProfile(plan).bundleDependencies).toBe(false);
    expect(target.hostPackages).toEqual(['cors', 'express', 'node-cron']);
  });
});

describe('AwsTarget', () => {
  const target = new AwsTarget();
  const plan = (nodes: Parameters<typeof workflow>[0], extra = {}) => planner.plan(workflow(nodes, [], extra));

  it('generates the Lambda handler, the CDK app and its infrastructure settings', async () => {
    const files = await target.files({ plan: plan([node('hook', 'webhook')]), projectName: "Customer's backend", options: {}, hostDependencies: {} });
    expect(paths(files)).toEqual([
      'README.md', 'bin/app.ts', 'cdk.json', 'infrastructure.json', 'lib/workflow-stack.ts', 'package.json',
      'src/handler.ts', 'src/workflow.json', 'src/workflow.ts', 'tsconfig.json',
    ]);
    const manifest = JSON.parse(file(files, 'package.json'));
    expect(manifest.scripts).toMatchObject({ clean: 'rm -rf dist', synth: 'npm run build && cdk synth', deploy: 'npm run build && cdk deploy' });
    expect(manifest.scripts.package).toBeUndefined();
    expect(manifest.scripts.build).toContain('--banner:js=');
    expect(manifest.dependencies).toMatchObject({ '@runflux/runtime': 'file:./vendor/runflux-runtime', 'aws-cdk-lib': expect.any(String), constructs: expect.any(String) });
    expect(manifest.devDependencies.tsx).toBeDefined();
    expect(target.hostPackages).toEqual([]);
  });

  it('translates every schedule and keeps its timezone and trigger', () => {
    const infrastructure = target.infrastructure(plan([node('first', 'schedule', { expression: '*/15 * * * *' }), node('second', 'schedule', { expression: '0 9 * * 1-5' })], {
      settings: { envVars: [{ key: 'API_KEY', value: 'secret' }, { key: 'EMPTY' }] },
    }), "Customer's schedules");
    expect(infrastructure).toEqual({
      stackName: 'CustomersschedulesStack',
      description: "Compiled stack by RunFlux for project Customer's schedules",
      workflowName: "Customer's schedules",
      functionUrl: false,
      environment: [{ key: 'API_KEY', value: 'secret' }, { key: 'EMPTY', value: '' }],
      schedules: [
        { nodeId: 'first', expression: 'cron(*/15 * * * ? *)', timezone: 'UTC' },
        { nodeId: 'second', expression: 'cron(0 9 ? * 2-6 *)', timezone: 'UTC' },
      ],
    });
  });

  it('gives the function a URL only when the workflow has HTTP triggers', () => {
    expect(target.infrastructure(plan([node('hook', 'webhook')]), 'X').functionUrl).toBe(true);
    expect(target.infrastructure(plan([node('run', 'echo')]), 'X').functionUrl).toBe(false);
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
