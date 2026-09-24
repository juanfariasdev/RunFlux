import { resolveValue } from './evaluate-expression';
import type { ExpressionContext } from './types';

/** Resolves every `{{ }}` expression of a parameters object, keeping its shape. */
export function resolveExpressions<TTemplate extends Record<string, unknown>>(template: TTemplate, context?: ExpressionContext): TTemplate {
  return resolveValue(template, context) as TTemplate;
}
