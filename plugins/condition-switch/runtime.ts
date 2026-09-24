import {
  ConditionEvaluator,
  defineNode,
  NodeOutput,
  readConditionGroups,
  type ConditionGroup,
  type NodeHandler,
  type NodeInvocation,
} from '@runflux/runtime';
import { FALLBACK_OUTPUT, RULE_OUTPUTS } from './outputs.js';

export interface SwitchParameters {
  readonly rules: readonly ConditionGroup[];
  readonly fallbackEnabled: boolean;
}

/**
 * Routes its input to the output of the first rule that holds. When none does, it uses the
 * fallback output if enabled, or ends the branch.
 */
export class SwitchNode implements NodeHandler<SwitchParameters> {
  constructor(private readonly conditions = new ConditionEvaluator()) {}

  execute({ parameters, input }: NodeInvocation<SwitchParameters>): NodeOutput {
    const rule = this.conditions.firstMatch(parameters.rules.slice(0, RULE_OUTPUTS.length));
    const fallback = parameters.fallbackEnabled ? FALLBACK_OUTPUT : null;
    return NodeOutput.route(input, rule === -1 ? fallback : RULE_OUTPUTS[rule]);
  }
}

export default defineNode<SwitchParameters>({
  parseParameters: (parameters) => ({
    rules: readConditionGroups(parameters, 'rules'),
    fallbackEnabled: parameters.boolean('fallbackEnabled', false),
  }),
  createHandler: () => new SwitchNode(),
});
