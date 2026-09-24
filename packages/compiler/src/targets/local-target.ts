import type { HttpTrigger } from '@runflux/runtime';
import type { EnvironmentVariableDeclaration } from '@runflux/plugin-system';
import { RUNTIME_ENTRIES, VENDOR_DIRECTORY } from '../bundling/runtime-bundler.js';
import type { DeploymentPlan } from '../deployment/deployment-plan.js';
import { BuildProfile } from '../project/build-profile.js';
import { code, MarkdownDocument } from '../project/markdown.js';
import { toPackageName } from '../project/package-name.js';
import { ProjectFiles } from '../project/project-files.js';
import { sortedRecord } from '../project/records.js';
import { TemplateDirectory } from '../project/template-directory.js';
import { toYaml, type YamlValue } from '../project/yaml.js';
import type { GeneratedFile } from '../types.js';
import type { DeploymentTarget, TargetContext } from './deployment-target.js';

const DEFAULT_PORT = 3000;
const CRON_WORKER = 'src/run-cron.ts';

/** A Node.js backend: Express server, CLI, optional cron worker, Dockerfile and Compose. */
export class LocalTarget implements DeploymentTarget {
  readonly platform = 'local' as const;
  readonly entrypoint = 'src/server.ts';
  readonly runtimeEntries = [RUNTIME_ENTRIES.core, RUNTIME_ENTRIES.express, RUNTIME_ENTRIES.cron, RUNTIME_ENTRIES.cli];
  readonly hostDependencies = { cors: '^2.8.5', express: '^4.21.0', 'node-cron': '^4.6.0' };

  constructor(private readonly templates = new TemplateDirectory()) {}

  buildProfile(plan: DeploymentPlan): BuildProfile {
    return BuildProfile.server(['src/server.ts', 'src/run.ts', ...(hasSchedules(plan) ? [CRON_WORKER] : [])]);
  }

  async files({ plan, projectName, options }: TargetContext): Promise<GeneratedFile[]> {
    const port = options.port ?? DEFAULT_PORT;
    const packageName = toPackageName(projectName, 'runflux-app');
    return new ProjectFiles()
      .addAll(await this.templates.files(['shared', 'local'], (file) => hasSchedules(plan) || file !== CRON_WORKER))
      .json('src/workflow.json', plan.workflow, 'source')
      .json('package.json', this.packageJson(plan, packageName))
      .text('.env.example', environmentFile(port, hasSchedules(plan), plan.environment), 'config')
      .text('docker-compose.yml', toYaml(this.compose(plan, port)), 'infrastructure')
      .text('README.md', this.readme(plan, projectName, packageName, port), 'asset')
      .list();
  }

  private packageJson(plan: DeploymentPlan, name: string) {
    const scripts: Record<string, string> = {
      clean: 'rm -rf dist compiled',
      build: `npm run clean && ${this.buildProfile(plan).command()}`,
      start: 'node dist/server.mjs',
      run: 'node dist/run.mjs',
      dev: 'tsx watch src/server.ts',
      ...(hasSchedules(plan) ? { cron: 'node dist/run-cron.mjs' } : {}),
      'docker:build': `docker build -t ${name} .`,
      'docker:up': 'docker compose up -d',
      'docker:down': 'docker compose down',
    };
    return {
      name,
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts,
      dependencies: sortedRecord({
        '@runflux/runtime': `file:./${VENDOR_DIRECTORY}`,
        cors: this.hostDependencies.cors,
        dotenv: '^16.4.5',
        express: this.hostDependencies.express,
        ...(hasSchedules(plan) ? { 'node-cron': this.hostDependencies['node-cron'] } : {}),
        ...plan.dependencies,
      }),
      devDependencies: sortedRecord({
        '@types/cors': '^2.8.17',
        '@types/express': '^4.17.21',
        '@types/node': '^22.5.0',
        esbuild: '^0.28.2',
        tsx: '^4.19.0',
        typescript: '^5.5.4',
        ...plan.devDependencies,
      }),
    };
  }

  private compose(plan: DeploymentPlan, port: number): YamlValue {
    const companions = Object.keys(plan.composeServices);
    const services: Record<string, YamlValue> = {
      app: {
        build: '.',
        restart: 'unless-stopped',
        ports: [`\${PORT:-${port}}:${port}`],
        env_file: ['.env'],
        environment: [`PORT=${port}`, 'NODE_ENV=production'],
        depends_on: companions.length > 0 ? companions : undefined,
      },
    };
    for (const [name, service] of Object.entries(plan.composeServices)) {
      services[name] = { image: service.image, restart: 'unless-stopped', environment: service.environment, ports: service.ports, volumes: service.volumes };
    }
    return {
      services,
      volumes: plan.composeVolumes.length > 0 ? Object.fromEntries(plan.composeVolumes.map((volume) => [volume, {}])) : undefined,
    };
  }

  private readme(plan: DeploymentPlan, projectName: string, packageName: string, port: number): string {
    const { http, schedules } = plan.workflow.triggers;
    const readme = new MarkdownDocument()
      .heading(1, projectName)
      .paragraph('Standalone backend compiled with [RunFlux](https://runflux.io). It runs the workflow in `src/workflow.json` with the RunFlux runtime bundled in `vendor/`.')
      .list([`**Workflow ID:** ${code(plan.workflow.id)}`, `**Nodes:** ${plan.workflow.nodes.length}`, '**Architecture:** Express + TypeScript, bundled with `esbuild`'])
      .heading(2, 'Running the application')
      .paragraph('Use Node.js 22 or newer. Install dependencies, configure the environment and build:')
      .code('bash', ['npm install', 'cp .env.example .env', '# Edit .env with your deployment settings', 'npm run build'])
      .heading(3, 'HTTP server')
      .code('bash', ['npm run start'])
      .list([`Health check: ${code(`GET http://localhost:${port}/health`)}`, ...endpoints(http, port)])
      .heading(3, 'Command line')
      .paragraph('Runs the workflow once with a JSON payload:')
      .code('bash', ["npm run run '{\"example\": \"payload\"}'"]);
    if (schedules.length > 0) {
      readme
        .heading(3, 'Scheduled worker')
        .code('bash', ['npm run cron'])
        .list(schedules.map((schedule) => `${code(schedule.expression)} (timezone ${schedule.timezone}, trigger ${code(schedule.nodeId)})`))
        .paragraph('Set `ENABLE_INLINE_CRON=true` to run the schedules inside the HTTP server instead.');
    }
    return readme
      .heading(2, 'Docker')
      .code('bash', ['npm run docker:up   # docker compose up -d', 'npm run docker:down'])
      .paragraph(`Or build and run the image alone: ${code(`npm run docker:build && docker run -p ${port}:${port} --env-file .env ${packageName}`)}`)
      .toString();
  }
}

function hasSchedules(plan: DeploymentPlan): boolean {
  return plan.workflow.triggers.schedules.length > 0;
}

function endpoints(triggers: readonly HttpTrigger[], port: number): string[] {
  if (triggers.length === 0) return [`Run the workflow: ${code(`POST http://localhost:${port}/api/execute`)}`];
  return triggers.map((trigger) => {
    const security = trigger.authentication.type === 'none' ? 'no authentication' : `requires ${code(trigger.authentication.headerName)} = ${code(`$${trigger.authentication.secretEnvVar}`)}`;
    return `Webhook ${code(`${trigger.method} http://localhost:${port}${trigger.path}`)} (${security})`;
  });
}

function environmentFile(port: number, cron: boolean, variables: readonly EnvironmentVariableDeclaration[]): string {
  const lines = [`PORT=${port}`, 'NODE_ENV=production', ...(cron ? ['ENABLE_INLINE_CRON=false'] : [])];
  if (variables.length > 0) {
    lines.push('', '# Project Environment Variables');
    for (const variable of variables) lines.push(...(variable.description ? [`# ${variable.description}`] : []), `${variable.key}=${variable.value ?? ''}`);
  }
  return `${lines.join('\n')}\n`;
}
