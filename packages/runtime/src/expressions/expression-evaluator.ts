import { systemEnvironment, type EnvironmentVariables } from '../environment.js';
import { createNodeScope } from './node-scope.js';

/** Data an expression can read. `$env` defaults to the host process environment. */
export interface ExpressionScope {
  readonly $json?: unknown;
  readonly $node?: Readonly<Record<string, unknown>>;
  readonly $env?: EnvironmentVariables;
}

export class ExpressionError extends Error {
  readonly expression: string;

  constructor(expression: string, cause: unknown) {
    super(`Expression "${expression}" failed: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'ExpressionError';
    this.expression = expression;
  }
}

type CompiledExpression = ($json: unknown, $node: unknown, $env: unknown) => unknown;

const EMBEDDED_EXPRESSION = /\{\{([\s\S]*?)\}\}/g;

/**
 * Evaluates the JavaScript between `{{ }}` with `$json`, `$node` and `$env` in scope. A value that
 * is exactly one expression keeps the expression's type; expressions embedded in text are
 * interpolated, rendering null and undefined as empty text.
 */
export class ExpressionEvaluator {
  private readonly compiled = new Map<string, CompiledExpression>();

  evaluate(expression: string, scope: ExpressionScope = {}): unknown {
    try {
      return this.compile(expression)(scope.$json, createNodeScope(scope.$node), scope.$env ?? systemEnvironment());
    } catch (error) {
      throw new ExpressionError(expression, error);
    }
  }

  /** Resolves every expression inside a string, array or object, recursively. */
  resolve(value: unknown, scope: ExpressionScope = {}): unknown {
    if (typeof value === 'string') return this.resolveText(value, scope);
    if (Array.isArray(value)) return value.map((item) => this.resolve(item, scope));
    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.resolve(item, scope)]));
    }
    return value;
  }

  private resolveText(text: string, scope: ExpressionScope): unknown {
    const single = singleExpression(text);
    if (single !== undefined) return this.evaluate(single, scope);
    return text.replace(EMBEDDED_EXPRESSION, (_match, expression: string) => {
      const value = this.evaluate(expression.trim(), scope);
      return value === null || value === undefined ? '' : String(value);
    });
  }

  private compile(expression: string): CompiledExpression {
    let compiled = this.compiled.get(expression);
    if (!compiled) {
      compiled = new Function('$json', '$node', '$env', `return (${expression})`) as CompiledExpression;
      this.compiled.set(expression, compiled);
    }
    return compiled;
  }
}

/** The expression of a text made of exactly one `{{ }}` block, ignoring surrounding whitespace. */
function singleExpression(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{{') || trimmed.indexOf('}}') !== trimmed.length - 2) return undefined;
  const body = trimmed.slice(2, -2);
  return body.includes('{{') ? undefined : body.trim();
}
