import {
  ConditionEvaluator,
  defineNode,
  MAIN_OUTPUT,
  NodeOutput,
  readCombinator,
  readConditions,
  type ConditionGroup,
  type NodeHandler,
  type NodeInvocation,
} from '@runflux/runtime';

export interface FilterParameters {
  readonly condition: ConditionGroup;
}

/** Passes its input on when its conditions hold; otherwise ends the branch without an error. */
export class FilterNode implements NodeHandler<FilterParameters> {
  constructor(private readonly conditions = new ConditionEvaluator()) {}

  execute({ parameters, input }: NodeInvocation<FilterParameters>): NodeOutput {
    return NodeOutput.route(input, this.conditions.matches(parameters.condition) ? MAIN_OUTPUT : null);
  }
}

export default defineNode<FilterParameters>({
  parseParameters: (parameters) => ({
    condition: { combinator: readCombinator(parameters, 'combinator'), conditions: readConditions(parameters, 'conditions') },
  }),
  createHandler: () => new FilterNode(),
});
