import { ExpressionEvaluator, type ExpressionScope } from './expression-evaluator.js';

/** Resolves a node's parameters before execution, keeping literal ones (source code, SQL) verbatim. */
export class ParameterResolver {
  private readonly expressions: ExpressionEvaluator;

  constructor(expressions: ExpressionEvaluator = new ExpressionEvaluator()) {
    this.expressions = expressions;
  }

  resolve(
    parameters: Readonly<Record<string, unknown>>,
    literal: ReadonlySet<string>,
    scope: ExpressionScope,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(parameters).map(([name, value]) => [name, literal.has(name) ? value : this.expressions.resolve(value, scope)]),
    );
  }
}
