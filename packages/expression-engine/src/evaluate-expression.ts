import { ExpressionEvaluator, type ExpressionScope } from '@runflux/runtime';

/**
 * Data an expression reads while it evaluates: `$json` (the node's input), `$node` (earlier nodes by
 * id and label, as `{ json }`) and `$env`. The runtime's own scope type, so previews and runs agree.
 */
export type ExpressionContext = ExpressionScope;

// One evaluator for every preview, so a text typed again reuses its compiled expression.
const evaluator = new ExpressionEvaluator();

/** Evaluates one expression (the text between `{{ }}`) with the runtime's semantics. */
export function evaluateExpression(expression: string, context?: ExpressionContext): unknown {
  return evaluator.evaluate(expression, context);
}

/** Resolves every `{{ }}` expression inside a value, recursively. */
export function resolveValue(value: unknown, context?: ExpressionContext): unknown {
  return evaluator.resolve(value, context);
}

/** Resolves every `{{ }}` expression of a parameters object, keeping its shape. */
export function resolveExpressions<TTemplate extends Record<string, unknown>>(template: TTemplate, context?: ExpressionContext): TTemplate {
  return resolveValue(template, context) as TTemplate;
}
