import type { ExpressionContext } from './types';

function createSafeNodeProxy(nodeMap?: Record<string, { json: unknown }>): Record<string, { json: unknown }> {
  const target = nodeMap ?? {};
  return new Proxy(target, {
    get(obj, prop: string | symbol) {
      if (typeof prop === 'string') {
        if (prop in obj) {
          return obj[prop];
        }
        return { json: undefined };
      }
      return undefined;
    },
  });
}

/**
 * Evaluates a single `{{ }}`-style expression body (the text already stripped
 * of its braces) against `$json`, `$node`, and `$env` (009-expression-global-context).
 * Uses `new Function` deliberately — no sandbox, same trust level plugins already run
 * at (D-09) — to support arbitrary JS.
 */
export function evaluateExpression(expr: string, context: ExpressionContext): unknown {
  try {
    const $json = context.$json;
    const $node = createSafeNodeProxy(context.$node);
    const $env = context.$env ?? (typeof process !== 'undefined' ? process.env : {});

    // eslint-disable-next-line @typescript-eslint/no-implied-eval -- D-01: this *is* the expression engine.
    return new Function('$json', '$node', '$env', `return (${expr})`)($json, $node, $env);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Expression "${expr}" failed: ${message}`);
  }
}

