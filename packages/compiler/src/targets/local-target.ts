import { HOST_ROUTES, type HttpTrigger } from '@runflux/runtime';
import type { EnvironmentVariableDeclaration } from '@runflux/plugin-system';
import { RUNTIME_ENTRIES, type RuntimeEntry } from '../bundling/runtime-bundler.js';
import type { DeploymentPlan } from '../deployment/deployment-plan.js';
import { BuildProfile } from '../project/build-profile.js';
import { EnvFile, EnvFileError } from '../project/env-file.js';
import { code, MarkdownDocument } from '../project/markdown.js';
import { packageManifest } from '../project/package-manifest.js';
import { toPackageName } from '../project/package-name.js';
import { ProjectFiles } from '../project/project-files.js';
import { TemplateDirectory } from '../project/template-directory.js';
import { toYaml, type YamlValue } from '../project/yaml.js';
import { CompilationError, type CompilationOptions, type GeneratedFile } from '../types.js';
import type { DeploymentTarget, TargetContext } from './deployment-target.js';

const DEFAULT_PORT = 3000;
const CRON_WORKER = 'src/run-cron.ts';
const CRON_PACKAGE = 'node-cron';

/** A Node.js backend: Express server, CLI, optional cron worker, Dockerfile and Compose. */
export class LocalTarget implements DeploymentTarget {
  readonly platform = 'local' as const;
  readonly entrypoint = 'src/server.ts';
  private readonly templates: TemplateDirectory;

  constructor(templates = new TemplateDirectory()) {
    this.templates = templates;
  }

  runtimeEntries(plan: DeploymentPlan, options: CompilationOptions): readonly RuntimeEntry[] {
    return [
      RUNTIME_ENTRIES.core,
      RUNTIME_ENTRIES.express,
      ...(hasSchedules(plan) ? [RUNTIME_ENTRIES.cron] : []),
      ...(includeCli(options) ? [RUNTIME_ENTRIES.cli] : []),
    ];
  }

  hostPackages(plan: DeploymentPlan): readonly string[] {
    return ['cors', 'express', ...(hasSchedules(plan) ? [CRON_PACKAGE] : [])];
  }

  buildProfile(plan: DeploymentPlan, options: CompilationOptions = {}): BuildProfile {
    return BuildProfile.server([
      'src/server.ts',
      ...(includeCli(options) ? ['src/run.ts'] : []),
      ...(hasSchedules(plan) ? [CRON_WORKER] : []),
    ]);
  }

  async files({ plan, projectName, options, hostDependencies }: TargetContext): Promise<GeneratedFile[]> {
    const port = options.port ?? DEFAULT_PORT;
    const packageName = toPackageName(projectName, 'runflux-app');
    const files = new ProjectFiles()
      .addAll(await this.templates.files(['shared']))
      .addAll(await this.templates.files(['local'], (file) => {
        if (!hasSchedules(plan) && file === CRON_WORKER) return false;
        if (hasSchedules(plan) && file === 'src/server.ts') return false;
        if (!includeCli(options) && file === 'src/run.ts') return false;
        return true;
      }));
    if (hasSchedules(plan)) files.addAll(await this.templates.files(['local-scheduled']));
    return files
      .json('src/workflow.json', plan.workflow, 'source')
      .json('package.json', this.packageJson(plan, packageName, hostDependencies, options))
      .text('.env.example', environmentFile(port, hasSchedules(plan), plan.environment), 'config')
      .text('docker-compose.yml', toYaml(this.compose(plan, port)), 'infrastructure')
      .text('README.md', this.readme(plan, projectName, packageName, port, options), 'asset')
      .list();
  }

  private packageJson(plan: DeploymentPlan, name: string, hostDependencies: Readonly<Record<string, string>>, options: CompilationOptions) {
    const { [CRON_PACKAGE]: cron, ...alwaysNeeded } = hostDependencies;
    return packageManifest({
      name,
      scripts: {
        clean: 'rm -rf dist',
        build: `npm run clean && ${this.buildProfile(plan, options).command()}`,
        start: 'node dist/server.mjs',
        ...(includeCli(options) ? { run: 'node dist/run.mjs' } : {}),
        dev: 'tsx watch src/server.ts',
        ...(hasSchedules(plan) ? { cron: 'node dist/run-cron.mjs' } : {}),
        'docker:build': `docker build -t ${name} .`,
        'docker:up': 'docker compose up -d',
        'docker:down': 'docker compose down',
      },
      dependencies: {
        ...alwaysNeeded,
        dotenv: '^16.4.5',
        ...(hasSchedules(plan) && cron ? { [CRON_PACKAGE]: cron } : {}),
        ...plan.dependencies,
      },
      devDependencies: { '@types/cors': '^2.8.17', '@types/express': '^4.17.21', ...plan.devDependencies },
    });
  }

  /** The backend (`app`), its cron worker (`cron`) when the workflow has schedules, and the plugins' services. */
  private compose(plan: DeploymentPlan, port: number): YamlValue {
    const companions = Object.keys(plan.composeServices);
    const dependsOn = companions.length > 0 ? companions : undefined;
    const services: Record<string, YamlValue> = {
      app: {
        build: '.',
        restart: 'unless-stopped',
        ports: [`\${PORT:-${port}}:${port}`],
        env_file: ['.env'],
        // With schedules, the `cron` service runs them; the server must not run them too.
        environment: [`PORT=${port}`, 'NODE_ENV=production', ...(hasSchedules(plan) ? ['ENABLE_INLINE_CRON=false'] : [])],
        depends_on: dependsOn,
      },
    };
    if (hasSchedules(plan)) {
      services.cron = {
        build: '.',
        restart: 'unless-stopped',
        command: ['node', 'dist/run-cron.mjs'],
        env_file: ['.env'],
        environment: ['NODE_ENV=production'],
        // The image's health check probes the HTTP server, which this process does not run.
        healthcheck: { disable: true },
        depends_on: dependsOn,
      };
    }
    for (const [name, service] of Object.entries(plan.composeServices)) {
      services[name] = { image: service.image, restart: 'unless-stopped', environment: service.environment, ports: service.ports, volumes: service.volumes };
    }
    return {
      services,
      volumes: plan.composeVolumes.length > 0 ? Object.fromEntries(plan.composeVolumes.map((volume) => [volume, {}])) : undefined,
    };
  }

  private readme(plan: DeploymentPlan, projectName: string, packageName: string, port: number, options: CompilationOptions): string {
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
      .list([`Health check: ${code(`GET http://localhost:${port}${HOST_ROUTES.health}`)}`, ...endpoints(http, port)])
    if (includeCli(options)) {
      readme
        .heading(3, 'Command line')
        .paragraph('Runs the workflow once with a JSON payload:')
        .code('bash', ["npm run run '{\"example\": \"payload\"}'"]);
    }
    if (schedules.length > 0) {
      readme
        .heading(3, 'Scheduled worker')
        .code('bash', ['npm run cron'])
        .list(schedules.map((schedule) => `${code(schedule.expression)} (timezone ${schedule.timezone}, trigger ${code(schedule.nodeId)})`))
        .paragraph('Set `ENABLE_INLINE_CRON=true` to run the schedules inside the HTTP server instead. Docker Compose runs the worker as the `cron` service.');
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

function includeCli(options: CompilationOptions): boolean {
  return options.includeCli !== false;
}

function endpoints(triggers: readonly HttpTrigger[], port: number): string[] {
  if (triggers.length === 0) return [`Run the workflow: ${code(`POST http://localhost:${port}${HOST_ROUTES.execute}`)}`];
  return triggers.map((trigger) => {
    const security = trigger.authentication.type === 'none' ? 'no authentication' : `requires ${code(trigger.authentication.headerName)} = ${code(`$${trigger.authentication.secretEnvVar}`)}`;
    return `Webhook ${code(`${trigger.method} http://localhost:${port}${trigger.path}`)} (${security})`;
  });
}

function environmentFile(port: number, cron: boolean, variables: readonly EnvironmentVariableDeclaration[]): string {
  const file = new EnvFile().variable('PORT', String(port)).variable('NODE_ENV', 'production');
  if (cron) file.variable('ENABLE_INLINE_CRON', 'false');
  if (variables.length === 0) return file.toString();
  file.blank().comment('Project Environment Variables');
  try {
    for (const variable of variables) {
      if (variable.description) file.comment(variable.description);
      file.variable(variable.key, variable.value ?? '');
    }
  } catch (error) {
    if (error instanceof EnvFileError) throw new CompilationError('INVALID_WORKFLOW', error.message);
    throw error;
  }
  return file.toString();
}
