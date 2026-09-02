import { evaluateExpression } from './evaluate-expression';
import type { ExpressionContext } from './types';

const WHOLE_STRING_EXPRESSION = /^\{\{([\s\S]*)\}\}$/;
const EMBEDDED_EXPRESSION = /\{\{([\s\S]*?)\}\}/g;

function resolveString(value: string, context: ExpressionContext): unknown {
  const trimmed = value.trim();
  const wholeMatch = WHOLE_STRING_EXPRESSION.exec(trimmed);
  if (wholeMatch) {
    return evaluateExpression(wholeMatch[1].trim(), context);
  }
  return value.replace(EMBEDDED_EXPRESSION, (_match, expr: string) => String(evaluateExpression(expr.trim(), context)));
}

function resolveValue(value: unknown, context: ExpressionContext): unknown {
  if (typeof value === 'string') return resolveString(value, context);
  if (Array.isArray(value)) return value.map((item) => resolveValue(item, context));
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = resolveValue(entry, context);
    }
    return result;
  }
  return value;
}

/**
 * Resolves every `{{ }}` expression found in `params`, recursing into nested
 * objects/arrays (relevant for `json`-typed parameters such as
 * condition-switch's rules or http-output's headers/body).
 */
export function resolveExpressions<T extends Record<string, unknown>>(params: T, context: ExpressionContext): T {
  return resolveValue(params, context) as T;
}
