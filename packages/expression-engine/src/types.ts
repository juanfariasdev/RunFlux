/**
 * Data available to an expression while it evaluates (009-expression-global-context).
 * - `$json`: the current node's resolved input payload.
 * - `$node`: dictionary of executed nodes keyed by node ID and label, containing `{ json }`.
 * - `$env`: environment variables accessible to expressions.
 */
export interface ExpressionContext {
  $json?: unknown;
  $node?: Record<string, { json: unknown }>;
  $env?: Record<string, string | undefined>;
}

