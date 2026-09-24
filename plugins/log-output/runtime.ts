import { defineNode, NodeOutput, type Logger, type NodeHandler, type NodeInvocation } from '@runflux/runtime';

export interface LogParameters {
  readonly label: string;
}

/** Logs its input under a label and passes it through unchanged. */
export class LogNode implements NodeHandler<LogParameters> {
  constructor(private readonly logger: Logger) {}

  execute({ parameters, input }: NodeInvocation<LogParameters>): NodeOutput {
    this.logger.info(`[log-output] ${parameters.label}:`, input);
    return NodeOutput.main(input);
  }
}

export default defineNode<LogParameters>({
  parseParameters: (parameters) => ({ label: parameters.string('label', 'Log') }),
  createHandler: ({ logger }) => new LogNode(logger),
});
