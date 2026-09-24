import { defineNode, isRecord, NodeOutput, type Clock, type NodeHandler, type NodeInvocation } from '@runflux/runtime';

export interface ManualTriggerParameters {
  readonly label: string;
}

/** Starts a run on demand, stamping the payload with the trigger's label and the current time. */
export class ManualTriggerNode implements NodeHandler<ManualTriggerParameters> {
  constructor(private readonly clock: Clock) {}

  execute({ parameters, input }: NodeInvocation<ManualTriggerParameters>): NodeOutput {
    return NodeOutput.main({ ...(isRecord(input) ? input : {}), label: parameters.label, triggeredAt: this.clock.now().toISOString() });
  }
}

export default defineNode<ManualTriggerParameters>({
  parseParameters: (parameters) => ({ label: parameters.string('label', 'Manual run') }),
  createHandler: ({ clock }) => new ManualTriggerNode(clock),
});
