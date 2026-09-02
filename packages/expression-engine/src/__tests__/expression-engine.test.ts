import { describe, expect, it } from 'vitest';
import { evaluateExpression } from '../evaluate-expression';
import { resolveExpressions } from '../resolve-expressions';

describe('evaluateExpression (004-core-nodes-catalog, D-01)', () => {
  it('evaluates a simple $json field access', () => {
    expect(evaluateExpression('$json.name', { $json: { name: 'Ada' } })).toBe('Ada');
  });

  it('evaluates arbitrary JS expressions against $json', () => {
    expect(evaluateExpression('$json.age > 18', { $json: { age: 21 } })).toBe(true);
    expect(evaluateExpression('$json.a + $json.b', { $json: { a: 2, b: 3 } })).toBe(5);
  });

  it('preserves the evaluated value type (number, boolean, object, array)', () => {
    expect(evaluateExpression('$json.count', { $json: { count: 42 } })).toBe(42);
    expect(evaluateExpression('$json.active', { $json: { active: false } })).toBe(false);
    expect(evaluateExpression('$json.nested', { $json: { nested: { a: 1 } } })).toEqual({ a: 1 });
    expect(evaluateExpression('$json.list', { $json: { list: [1, 2, 3] } })).toEqual([1, 2, 3]);
  });

  it('throws an error that names the original expression text when evaluation fails', () => {
    expect(() => evaluateExpression('$json.a.b.c', { $json: {} })).toThrow(/\$json\.a\.b\.c/);
  });

  it('throws for syntactically invalid expressions, citing the expression text', () => {
    expect(() => evaluateExpression('$json.(', { $json: {} })).toThrow(/\$json\.\(/);
  });
});

describe('resolveExpressions (004-core-nodes-catalog, D-01, RF-10)', () => {
  it('leaves a plain literal string untouched', () => {
    const result = resolveExpressions({ label: 'hello world' }, { $json: {} });
    expect(result.label).toBe('hello world');
  });

  it('leaves non-string values untouched', () => {
    const result = resolveExpressions({ count: 5, active: true, nothing: null }, { $json: {} });
    expect(result).toEqual({ count: 5, active: true, nothing: null });
  });

  it('preserves the evaluated type when the whole (trimmed) string is a single expression', () => {
    const context = { $json: { count: 42, active: true, obj: { a: 1 }, list: [1, 2] } };
    expect(resolveExpressions({ v: '{{ $json.count }}' }, context).v).toBe(42);
    expect(resolveExpressions({ v: '{{ $json.active }}' }, context).v).toBe(true);
    expect(resolveExpressions({ v: '{{ $json.obj }}' }, context).v).toEqual({ a: 1 });
    expect(resolveExpressions({ v: '{{ $json.list }}' }, context).v).toEqual([1, 2]);
  });

  it('stringifies an expression embedded inside a larger string', () => {
    const context = { $json: { id: 42, host: 'example.com' } };
    const result = resolveExpressions({ url: 'https://{{ $json.host }}/items/{{ $json.id }}' }, context);
    expect(result.url).toBe('https://example.com/items/42');
  });

  it('resolves recursively inside nested objects and arrays', () => {
    const context = { $json: { name: 'Ada', role: 'admin' } };
    const result = resolveExpressions(
      {
        headers: { Authorization: 'Bearer {{ $json.role }}' },
        rules: [{ leftValue: '{{ $json.name }}', rightValue: 'Ada' }],
      },
      context,
    );
    expect(result.headers).toEqual({ Authorization: 'Bearer admin' });
    expect(result.rules).toEqual([{ leftValue: 'Ada', rightValue: 'Ada' }]);
  });

  it('does not mutate the original params object', () => {
    const params = { v: '{{ $json.x }}' };
    resolveExpressions(params, { $json: { x: 1 } });
    expect(params.v).toBe('{{ $json.x }}');
  });

  it('propagates an evaluation error, naming the offending expression', () => {
    expect(() => resolveExpressions({ v: '{{ $json.missing.deep }}' }, { $json: {} })).toThrow(
      /\$json\.missing\.deep/,
    );
  });
});
