/**
 * Minimal `{{ }}` expression engine (004-core-nodes-catalog, D-01). Plugin
 * parameters never see `{{ }}` — @runflux/validation-runtime's engine calls
 * `resolveExpressions` on every node's params before `execute()` runs;
 * `evaluateExpression` is its single-expression building block, exposed for
 * callers (like a plugin's own `generators.local` output) that need it directly.
 */
export { evaluateExpression } from './evaluate-expression';
export { resolveExpressions } from './resolve-expressions';
export type { ExpressionContext } from './types';
