import {
  ConditionEvaluator,
  defineNode,
  NodeOutput,
  readCombinator,
  readConditions,
  type ConditionGroup,
  type NodeHandler,
  type NodeInvocation,
} from '@runflux/runtime';

export interface IfParameters {
  readonly condition: ConditionGroup;
}

/** Routes its input to the `true` or `false` output depending on whether its conditions hold. */
export class IfNode implements NodeHandler<IfParameters> {
  constructor(private readonly conditions = new ConditionEvaluator()) {}

  execute({ parameters, input }: NodeInvocation<IfParameters>): NodeOutput {
    return NodeOutput.route(input, this.conditions.matches(parameters.condition) ? 'true' : 'false');
  }
}

export default defineNode<IfParameters>({
  parseParameters: (parameters) => ({
    condition: { combinator: readCombinator(parameters, 'combinator'), conditions: readConditions(parameters, 'conditions') },
  }),
  createHandler: () => new IfNode(),
});
