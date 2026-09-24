/**
 * The editor's `{{ }}` expression API (004-core-nodes-catalog, D-01): a facade over the runtime's
 * ExpressionEvaluator, so previews in the editor evaluate exactly like executed workflows.
 */
export { evaluateExpression, resolveValue } from './evaluate-expression';
export { resolveExpressions } from './resolve-expressions';
export type { ExpressionContext } from './types';
