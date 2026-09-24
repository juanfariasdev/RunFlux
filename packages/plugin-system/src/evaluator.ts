import { createSafeNodeProxy, getSafeEnv } from './context-helpers';

export interface EvaluatorContext {
  $json?: unknown;
  $node?: Record<string, unknown>;
  $env?: Record<string, string | undefined>;
}

const WHOLE_STRING_EXPRESSION = /^\{\{([\s\S]*)\}\}$/;
const EMBEDDED_EXPRESSION = /\{\{([\s\S]*?)\}\}/g;

/**
 * Evaluates an expression string in the scope of ($json, $node, $env).
 */
export function evaluateExpression(expr: string, context?: EvaluatorContext): unknown {
  const $json = context?.$json;
  const $node = createSafeNodeProxy(context?.$node);
  const $env = getSafeEnv(context);

  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function('$json', '$node', '$env', `return (${expr})`)($json, $node, $env);
  } catch (err: any) {
    throw new Error(`Expression "${expr}" failed: ${err.message || String(err)}`);
  }
}

/**
 * Resolves template expressions in a string or raw data structure recursively.
 */
export function resolveValue(raw: unknown, context?: EvaluatorContext): unknown {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const whole = WHOLE_STRING_EXPRESSION.exec(trimmed);
    if (whole) {
      return evaluateExpression(whole[1].trim(), context);
    }
    return raw.replace(EMBEDDED_EXPRESSION, (_match, expr: string) => {
      const val = evaluateExpression(expr.trim(), context);
      return val === null || val === undefined ? '' : String(val);
    });
  }

  if (Array.isArray(raw)) {
    return raw.map((item) => resolveValue(item, context));
  }

  if (raw !== null && typeof raw === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
      result[key] = resolveValue(val, context);
    }
    return result;
  }

  return raw;
}

/**
 * Resolves all template fields in an object (parameters map).
 */
export function resolveTemplateObject<T extends Record<string, unknown>>(template: T, context?: EvaluatorContext): T {
  return resolveValue(template, context) as T;
}
