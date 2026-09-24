import { RUNTIME_ENTRIES, VENDOR_DIRECTORY } from '../bundling/runtime-bundler.js';
import type { DeploymentPlan } from '../deployment/deployment-plan.js';
import { BuildProfile } from '../project/build-profile.js';
import { code, MarkdownDocument } from '../project/markdown.js';
import { toPackageName, toStackName } from '../project/package-name.js';
import { ProjectFiles } from '../project/project-files.js';
import { sortedRecord } from '../project/records.js';
import { TemplateDirectory } from '../project/template-directory.js';
import { CompilationError, type GeneratedFile } from '../types.js';
import { toAwsCron } from './aws-schedule.js';
import type { DeploymentTarget, TargetContext } from './deployment-target.js';

/**
 * The data the exported `lib/workflow-stack.ts` reads from infrastructure.json. It mirrors the
 * interface declared there (templates/aws/lib/workflow-stack.ts); tests synthesize that stack from
 * this output to keep both in step.
 */
export interface WorkflowInfrastructure {
  readonly stackName: string;
  readonly description: string;
  readonly workflowName: string;
  readonly environment: ReadonlyArray<{ readonly key: string; readonly value?: string }>;
  readonly schedules: ReadonlyArray<{ readonly nodeId: string; readonly expression: string; readonly timezone: string }>;
}

/** An AWS Lambda backend behind a function URL, deployed with CDK; cron triggers use EventBridge. */
export class AwsTarget implements DeploymentTarget {
  readonly platform = 'aws' as const;
  readonly entrypoint = 'src/handler.ts';
  readonly runtimeEntries = [RUNTIME_ENTRIES.core, RUNTIME_ENTRIES.lambda];
  readonly hostDependencies = {};

  constructor(private readonly templates = new TemplateDirectory()) {}

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
    return {
      name,
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: {
        clean: 'rm -rf dist compiled',
        build: `npm run clean && ${this.buildProfile().command()}`,
        package: 'npm run build && mkdir -p compiled && zip -j compiled/function.zip dist/*',
        cdk: 'cdk',
        deploy: 'npm run package && cdk deploy',
      },
      dependencies: sortedRecord({
        '@runflux/runtime': `file:./${VENDOR_DIRECTORY}`,
        'aws-cdk-lib': '^2.177.0',
        constructs: '^10.3.0',
        ...plan.dependencies,
      }),
      devDependencies: sortedRecord({
        '@types/node': '^22.5.0',
        'aws-cdk': '^2.177.0',
        esbuild: '^0.28.2',
        tsx: '^4.19.0',
        typescript: '^5.5.4',
        ...plan.devDependencies,
      }),
    };
  }

  private readme(plan: DeploymentPlan, projectName: string): string {
    const { http, schedules } = plan.workflow.triggers;
    return new MarkdownDocument()
      .heading(1, `${projectName} (AWS serverless backend)`)
      .paragraph('Compiled with [RunFlux](https://runflux.io): the workflow in `src/workflow.json` runs in AWS Lambda with the RunFlux runtime bundled in `vendor/`.')
      .list([
        '**Function:** bundled with `esbuild` into `dist/handler.mjs`; the deployment zip needs no `node_modules`',
        '**Infrastructure:** AWS CDK stack in `lib/workflow-stack.ts`, configured by `infrastructure.json`',
        '**Endpoint:** Lambda function URL',
        ...http.map((trigger) => `**Webhook:** ${code(`${trigger.method} ${trigger.path}`)}${trigger.authentication.type === 'none' ? '' : `, header ${code(trigger.authentication.headerName)} must equal ${code(`$${trigger.authentication.secretEnvVar}`)}`}`),
        ...schedules.map((schedule) => `**Schedule:** ${code(schedule.expression)} (timezone ${schedule.timezone}, trigger ${code(schedule.nodeId)}) via EventBridge Scheduler`),
      ])
      .heading(2, 'Commands')
      .paragraph('Use Node.js 22 or newer and AWS credentials for the target account. Set the environment variables listed in `infrastructure.json` in the deploying shell.')
      .code('bash', ['npm install', 'npm run build    # bundle the function into dist/', 'npm run package  # zip dist/ into compiled/function.zip', 'npm run deploy   # deploy the CloudFormation stack'])
      .toString();
  }
}
