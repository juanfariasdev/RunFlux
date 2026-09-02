import type { ExpressionContext } from './types';

/**
 * Evaluates a single `{{ }}`-style expression body (the text already stripped
 * of its braces) against `$json` (004-core-nodes-catalog, D-01). Uses `new
 * Function` deliberately — no sandbox, same trust level plugins already run
 * at (D-09) — to support arbitrary JS, not just a fixed operator set.
 */
export function evaluateExpression(expr: string, context: ExpressionContext): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- D-01: this *is* the expression engine.
    return new Function('$json', `return (${expr})`)(context.$json);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Expression "${expr}" failed: ${message}`);
  }
}
