import { fileURLToPath } from 'node:url';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import type { Construct } from 'constructs';

/** The deployment settings RunFlux exports next to the stack, in infrastructure.json. */
export interface WorkflowInfrastructure {
  readonly stackName: string;
  readonly description: string;
  readonly workflowName: string;
  /** Whether the function gets a public URL: only workflows with HTTP triggers need one. */
  readonly functionUrl: boolean;
  /** Function variables. A variable set in the shell that deploys the stack wins over `value`. */
  readonly environment: ReadonlyArray<{ readonly key: string; readonly value?: string }>;
  /** EventBridge Scheduler expressions, each starting one cron trigger. */
  readonly schedules: ReadonlyArray<{ readonly nodeId: string; readonly expression: string; readonly timezone: string }>;
}

export interface WorkflowStackProps extends cdk.StackProps {
  /** The function code. Defaults to dist/, produced by `npm run build`. */
  readonly code?: lambda.Code;
}

/**
 * One Lambda function, behind a public function URL when the workflow has HTTP triggers, plus one
 * EventBridge schedule per cron trigger.
 */
export class WorkflowStack extends cdk.Stack {
  readonly function: lambda.Function;

  constructor(scope: Construct, id: string, infrastructure: WorkflowInfrastructure, props: WorkflowStackProps = {}) {
    super(scope, id, props);
    this.function = new lambda.Function(this, 'WorkflowFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'handler.handler',
      code: props.code ?? lambda.Code.fromAsset(fileURLToPath(new URL('../dist', import.meta.url))),
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      environment: {
        WORKFLOW_NAME: infrastructure.workflowName,
        NODE_ENV: 'production',
        ...Object.fromEntries(infrastructure.environment.map(({ key, value }) => [key, process.env[key] || value || ''])),
      },
    });

    if (infrastructure.functionUrl) this.addFunctionUrl();
    if (infrastructure.schedules.length > 0) this.addSchedules(infrastructure.schedules);
  }

  /** Webhooks authenticate themselves (see the triggers' header secrets), so the URL is public. */
  private addFunctionUrl(): void {
    const functionUrl = this.function.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: { allowedOrigins: ['*'], allowedMethods: [lambda.HttpMethod.ALL], allowedHeaders: ['*'] },
    });
    new cdk.CfnOutput(this, 'FunctionUrl', { value: functionUrl.url, description: 'Public endpoint of the workflow webhooks' });
  }

  private addSchedules(schedules: WorkflowInfrastructure['schedules']): void {
    const role = new iam.Role(this, 'SchedulerRole', { assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com') });
    this.function.grantInvoke(role);
    schedules.forEach((schedule, index) => {
      new scheduler.CfnSchedule(this, `WorkflowSchedule${index + 1}`, {
        scheduleExpression: schedule.expression,
        scheduleExpressionTimezone: schedule.timezone,
        flexibleTimeWindow: { mode: 'OFF' },
        target: { arn: this.function.functionArn, roleArn: role.roleArn, input: JSON.stringify({ runfluxTriggerId: schedule.nodeId }) },
      });
    });
  }
}
