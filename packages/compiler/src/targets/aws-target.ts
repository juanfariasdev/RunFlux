import { RUNTIME_ENTRIES } from '../bundling/runtime-bundler.js';
import type { DeploymentPlan } from '../deployment/deployment-plan.js';
import { BuildProfile } from '../project/build-profile.js';
import { code, MarkdownDocument } from '../project/markdown.js';
import { packageManifest } from '../project/package-manifest.js';
import { toPackageName, toStackName } from '../project/package-name.js';
import { ProjectFiles } from '../project/project-files.js';
import { TemplateDirectory } from '../project/template-directory.js';
import { CompilationError, type GeneratedFile } from '../types.js';
import { toAwsCron } from './aws-schedule.js';
import type { DeploymentTarget, TargetContext } from './deployment-target.js';

/**
 * The data the exported `lib/workflow-stack.ts` reads from infrastructure.json. It mirrors the
 * interface declared there (templates/aws/lib/workflow-stack.ts); a type test keeps both equal and
 * tests synthesize that stack from this output.
 */
export interface WorkflowInfrastructure {
  readonly stackName: string;
  readonly description: string;
  readonly workflowName: string;
  /** Whether the function gets a public URL: only workflows with HTTP triggers need one. */
  readonly functionUrl: boolean;
  readonly environment: ReadonlyArray<{ readonly key: string; readonly value?: string }>;
  readonly schedules: ReadonlyArray<{ readonly nodeId: string; readonly expression: string; readonly timezone: string }>;
}

/** An AWS Lambda backend, behind a function URL for HTTP triggers, deployed with CDK; cron triggers use EventBridge. */
export class AwsTarget implements DeploymentTarget {
  readonly platform = 'aws' as const;
  readonly entrypoint = 'src/handler.ts';
  readonly runtimeEntries = [RUNTIME_ENTRIES.core, RUNTIME_ENTRIES.lambda];
  readonly hostPackages: readonly string[] = [];
  private readonly templates: TemplateDirectory;

  constructor(templates = new TemplateDirectory()) {
    this.templates = templates;
  }

  buildProfile(): BuildProfile {
    return BuildProfile.function(['src/handler.ts']);
  }

  async files({ plan, projectName }: TargetContext): Promise<GeneratedFile[]> {
    return new ProjectFiles()
      .addAll(await this.templates.files(['shared', 'aws']))
      .json('src/workflow.json', plan.workflow, 'source')
      .json('infrastructure.json', this.infrastructure(plan, projectName), 'infrastructure')
      .json('package.json', this.packageJson(plan, toPackageName(projectName, 'runflux-aws-app')))
      .text('README.md', this.readme(plan, projectName), 'asset')
      .list();
  }

  /** Throws a CompilationError for schedules EventBridge cannot express. */
  infrastructure(plan: DeploymentPlan, projectName: string): WorkflowInfrastructure {
    return {
      stackName: toStackName(projectName),
      description: `Compiled stack by RunFlux for project ${projectName}`,
      workflowName: projectName,
      functionUrl: plan.workflow.triggers.http.length > 0,
      environment: plan.environment.map(({ key, value }) => ({ key, value: value ?? '' })),
      schedules: plan.workflow.triggers.schedules.map((schedule) => {
        try {
          return { nodeId: schedule.nodeId, expression: toAwsCron(schedule.expression), timezone: schedule.timezone };
        } catch (error) {
          throw new CompilationError('INVALID_WORKFLOW', `Node "${schedule.nodeId}": ${(error as Error).message}`);
        }
      }),
    };
  }

  private packageJson(plan: DeploymentPlan, name: string) {
    return packageManifest({
      name,
      scripts: {
        clean: 'rm -rf dist',
        build: `npm run clean && ${this.buildProfile().command()}`,
        cdk: 'cdk',
        synth: 'npm run build && cdk synth',
        deploy: 'npm run build && cdk deploy',
      },
      dependencies: { 'aws-cdk-lib': '^2.177.0', constructs: '^10.3.0', ...plan.dependencies },
      devDependencies: { 'aws-cdk': '^2.177.0', ...plan.devDependencies },
    });
  }

  private readme(plan: DeploymentPlan, projectName: string): string {
    const { http, schedules } = plan.workflow.triggers;
    return new MarkdownDocument()
      .heading(1, `${projectName} (AWS serverless backend)`)
      .paragraph('Compiled with [RunFlux](https://runflux.io): the workflow in `src/workflow.json` runs in AWS Lambda with the RunFlux runtime bundled in `vendor/`.')
      .list([
        '**Function:** bundled with `esbuild` into `dist/`, which CDK packages as the function code; no `node_modules` is deployed',
        '**Infrastructure:** AWS CDK stack in `lib/workflow-stack.ts`, configured by `infrastructure.json`',
        http.length > 0 ? '**Endpoint:** Lambda function URL (the `FunctionUrl` stack output)' : '**Endpoint:** none; the workflow has no HTTP trigger',
        ...http.map((trigger) => `**Webhook:** ${code(`${trigger.method} ${trigger.path}`)}${trigger.authentication.type === 'none' ? '' : `, header ${code(trigger.authentication.headerName)} must equal ${code(`$${trigger.authentication.secretEnvVar}`)}`}`),
        ...schedules.map((schedule) => `**Schedule:** ${code(schedule.expression)} (timezone ${schedule.timezone}, trigger ${code(schedule.nodeId)}) via EventBridge Scheduler`),
      ])
      .heading(2, 'Commands')
      .paragraph('Use Node.js 22 or newer and AWS credentials for the target account. Set the environment variables listed in `infrastructure.json` in the deploying shell.')
      .code('bash', ['npm install', 'npm run build    # bundle the function into dist/', 'npm run synth    # optional: inspect the CloudFormation template', 'npm run deploy   # build and deploy the stack'])
      .toString();
  }
}
