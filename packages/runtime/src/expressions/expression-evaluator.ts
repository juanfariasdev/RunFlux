import { systemEnvironment, type EnvironmentVariables } from '../environment.js';
import { parseTemplate, singleExpression, type TemplatePart } from './expression-template.js';
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

/**
 * Evaluates the JavaScript between `{{ }}` with `$json`, `$node` and `$env` in scope. A value that
 * is exactly one expression keeps the expression's type; expressions embedded in text are
 * interpolated, rendering null and undefined as empty text.
 */
export class ExpressionEvaluator {
  private readonly compiled = new Map<string, CompiledExpression>();
  private readonly templates = new Map<string, TemplatePart[]>();

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
    const parts = this.template(text);
    const single = singleExpression(parts);
    if (single !== undefined) return this.evaluate(single, scope);
    if (!parts.some((part) => part.kind === 'expression')) return text;
    return parts.map((part) => {
      if (part.kind === 'text') return part.text;
      const value = this.evaluate(part.source, scope);
      return value === null || value === undefined ? '' : String(value);
    }).join('');
  }

  private template(text: string): TemplatePart[] {
    let parts = this.templates.get(text);
    if (!parts) {
      parts = parseTemplate(text);
      this.templates.set(text, parts);
    }
    return parts;
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
