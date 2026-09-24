import { ExpressionEvaluator } from '@runflux/runtime';
import type { ExpressionContext } from './types';

const evaluator = new ExpressionEvaluator();

/** Evaluates one expression (the text between `{{ }}`) with the runtime's semantics. */
export function evaluateExpression(expression: string, context?: ExpressionContext): unknown {
  return evaluator.evaluate(expression, context);
}

/** Resolves every `{{ }}` expression inside a value, recursively. */
export function resolveValue(value: unknown, context?: ExpressionContext): unknown {
  return evaluator.resolve(value, context);
}
