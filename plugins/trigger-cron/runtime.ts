import { defineNode, isRecord, NodeOutput, type Clock, type NodeHandler, type NodeInvocation } from '@runflux/runtime';
import { readCronSchedule, type CronSchedule } from './schedule.js';

/** Starts a run on its schedule, stamping the payload with the firing time and the schedule. */
export class CronTriggerNode implements NodeHandler<CronSchedule> {
  constructor(private readonly clock: Clock) {}

  execute({ parameters, input }: NodeInvocation<CronSchedule>): NodeOutput {
    return NodeOutput.main({
      ...(isRecord(input) ? input : {}),
      triggeredAt: this.clock.now().toISOString(),
      cronExpression: parameters.expression,
      timezone: parameters.timezone,
    });
  }
}

export default defineNode<CronSchedule>({
  parseParameters: readCronSchedule,
  createHandler: ({ clock }) => new CronTriggerNode(clock),
});
