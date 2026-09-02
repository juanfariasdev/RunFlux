/**
 * Data available to an expression while it evaluates (004-core-nodes-catalog,
 * D-01). `$json` is the current node's resolved input — the only thing an
 * expression can reference in this minimal engine.
 */
export interface ExpressionContext {
  $json: unknown;
}
