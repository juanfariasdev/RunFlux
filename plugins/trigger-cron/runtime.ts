import { defineNode, isRecord, NodeOutput, type Clock, type NodeHandler, type NodeInvocation, type ParameterReader } from '@runflux/runtime';

export interface CronParameters {
  readonly expression: string;
  readonly timezone: string;
}

export function readCronParameters(parameters: ParameterReader): CronParameters {
  return { expression: parameters.string('expression', '*/15 * * * *'), timezone: parameters.string('timezone', 'UTC') };
}

/** Starts a run on its schedule, stamping the payload with the firing time and the schedule. */
export class CronTriggerNode implements NodeHandler<CronParameters> {
  constructor(private readonly clock: Clock) {}

  execute({ parameters, input }: NodeInvocation<CronParameters>): NodeOutput {
    return NodeOutput.main({
      ...(isRecord(input) ? input : {}),
      triggeredAt: this.clock.now().toISOString(),
      cronExpression: parameters.expression,
      timezone: parameters.timezone,
    });
  }
}

export default defineNode<CronParameters>({
  parseParameters: readCronParameters,
  createHandler: ({ clock }) => new CronTriggerNode(clock),
});
