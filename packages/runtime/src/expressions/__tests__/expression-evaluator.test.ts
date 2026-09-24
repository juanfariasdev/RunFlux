import { afterEach, describe, expect, it, vi } from 'vitest';
import { containsExpression } from '../expression-template.js';
import { ExpressionError, ExpressionEvaluator } from '../expression-evaluator.js';
import { createNodeScope } from '../node-scope.js';
import { ParameterResolver } from '../parameter-resolver.js';

const expressions = new ExpressionEvaluator();

afterEach(() => vi.unstubAllEnvs());

describe('ExpressionEvaluator.evaluate', () => {
  it('reads $json, $node and $env', () => {
    const scope = { $json: { user: { name: 'Alice' } }, $node: { Trigger: { json: { orderId: 999 } } }, $env: { APP: 'RunFlux' } };
    expect(expressions.evaluate('$json.user.name', scope)).toBe('Alice');
    expect(expressions.evaluate('$node["Trigger"].json.orderId', scope)).toBe(999);
    expect(expressions.evaluate('$env.APP', scope)).toBe('RunFlux');
  });

  it('reads a node that did not run as { json: undefined }', () => {
    expect(expressions.evaluate('$node["Missing"].json?.field ?? "fallback"', { $node: {} })).toBe('fallback');
  });

  it('defaults $env to the process environment', () => {
    vi.stubEnv('RUNFLUX_EXPRESSION_TEST', 'from-process');
    expect(expressions.evaluate('$env.RUNFLUX_EXPRESSION_TEST')).toBe('from-process');
  });

  it('reports runtime and syntax errors with the failing expression', () => {
    expect(() => expressions.evaluate('$json.missing.field', { $json: {} })).toThrow(ExpressionError);
    expect(() => expressions.evaluate('$json.missing.field', { $json: {} })).toThrow('Expression "$json.missing.field" failed: Cannot read properties of undefined');
    expect(() => expressions.evaluate('1 +', {})).toThrow('Expression "1 +" failed');
  });

  it('reuses compiled expressions across evaluations with different data', () => {
    expect(expressions.evaluate('$json.count * 2', { $json: { count: 2 } })).toBe(4);
    expect(expressions.evaluate('$json.count * 2', { $json: { count: 5 } })).toBe(10);
  });
});

describe('ExpressionEvaluator.resolve', () => {
  it('keeps the type of a value that is exactly one expression', () => {
    expect(expressions.resolve('{{ $json.count }}', { $json: { count: 42 } })).toBe(42);
    expect(expressions.resolve('  {{ $json.active }}  ', { $json: { active: true } })).toBe(true);
    expect(expressions.resolve('{{ $json.user }}', { $json: { user: { id: 1 } } })).toEqual({ id: 1 });
  });

  it('interpolates embedded expressions, rendering null and undefined as empty text', () => {
    const scope = { $json: { name: 'Bob', none: null }, $env: { PLATFORM: 'Cloud' } };
    expect(expressions.resolve('Hello, {{ $json.name }}! Welcome to {{ $env.PLATFORM }}.', scope)).toBe('Hello, Bob! Welcome to Cloud.');
    expect(expressions.resolve('[{{ $json.none }}|{{ $json.absent }}]', scope)).toBe('[|]');
    expect(expressions.resolve('{{ 1 }} and {{ 2 }}', scope)).toBe('1 and 2');
  });

  it.each([
    ['{{ "}}" }}', '}}'],
    ['{{ { a: { b: 1 }} }}', { a: { b: 1 } }],
    ['{{ `a}}b` }}', 'a}}b'],
    ["[{{ 'x' + \"}}\" }}]", '[x}}]'],
    ['{{ $json.a }} and {{ $json.b }}', '1 and 2'],
  ])('ends %s at the braces that close the expression', (template, expected) => {
    expect(expressions.resolve(template, { $json: { a: 1, b: 2 } })).toEqual(expected);
  });

  it('tells texts with expressions from plain ones', () => {
    expect(containsExpression('Hello {{ $json.name }}')).toBe(true);
    expect(containsExpression('{{ "}}" }}')).toBe(true);
    expect(containsExpression('{{ never closed')).toBe(false);
    expect(containsExpression('plain {text}')).toBe(false);
  });

  it('keeps text without a closed block as it is and reports unbalanced JavaScript', () => {
    expect(expressions.resolve('{{ not closed', {})).toBe('{{ not closed');
    expect(expressions.resolve('a {{ b', {})).toBe('a {{ b');
    expect(() => expressions.resolve('{{ "open }}', {})).toThrow('Expression ""open" failed');
  });

  it('passes other values through and resolves arrays and objects recursively', () => {
    expect(expressions.resolve(123)).toBe(123);
    expect(expressions.resolve(null)).toBeNull();
    expect(expressions.resolve(undefined)).toBeUndefined();
    expect(expressions.resolve('plain text')).toBe('plain text');
    expect(expressions.resolve({
      title: 'Report for {{ $json.client }}',
      tags: ['tag', '{{ $env.TAG }}'],
      details: { total: '{{ $json.amount * 2 }}', nested: { flag: '{{ $json.ok }}' } },
    }, { $json: { client: 'Acme', amount: 50, ok: true }, $env: { TAG: 'production' } })).toEqual({
      title: 'Report for Acme', tags: ['tag', 'production'], details: { total: 100, nested: { flag: true } },
    });
  });

  it('does not mutate the template', () => {
    const template = { value: '{{ $json.n }}' };
    expressions.resolve(template, { $json: { n: 1 } });
    expect(template).toEqual({ value: '{{ $json.n }}' });
  });
});

describe('createNodeScope', () => {
  it('exposes node entries, wraps plain values and never throws for unknown nodes', () => {
    const scope = createNodeScope({ Trigger: { json: { id: 1 } }, Plain: 'value' });
    expect(scope.Trigger.json).toEqual({ id: 1 });
    expect(scope.Plain).toEqual({ json: 'value' });
    expect(scope.Missing).toEqual({ json: undefined });
    expect(scope.toString).toEqual({ json: undefined });
    expect(createNodeScope(null).Anything).toEqual({ json: undefined });
  });
});

describe('ParameterResolver', () => {
  it('resolves every parameter except the literal ones', () => {
    const resolver = new ParameterResolver();
    expect(resolver.resolve(
      { query: 'SELECT {{ literal }}', queryParams: ['{{ $json.id }}'], label: 'Order {{ $json.id }}' },
      new Set(['query']),
      { $json: { id: 7 } },
    )).toEqual({ query: 'SELECT {{ literal }}', queryParams: [7], label: 'Order 7' });
  });
});
