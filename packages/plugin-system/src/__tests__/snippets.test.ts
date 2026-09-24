import { describe, it, expect } from 'vitest';
import {
  STANDALONE_OPERATOR_CODE,
  STANDALONE_EXPRESSION_EVALUATOR_CODE,
} from '../snippets';

describe('Standardized Code Snippets for Compilers (TDD)', () => {
  it('STANDALONE_OPERATOR_CODE exports a working compare and combine implementation', () => {
    expect(STANDALONE_OPERATOR_CODE).toBeDefined();
    // Verify the code parses and executes in a function scope
    const factory = new Function(
      `${STANDALONE_OPERATOR_CODE}; return { compare, combine, evaluateOperator, combineConditions };`
    );
    const { compare, combine, evaluateOperator } = factory();

    expect(typeof compare).toBe('function');
    expect(typeof combine).toBe('function');
    expect(typeof evaluateOperator).toBe('function');

    // Strict type check in generated code: "1" !== 1
    expect(compare('1', 'equals', 1)).toBe(false);
    expect(compare('a', 'equals', 'a')).toBe(true);
    expect(combine([true, false], 'or')).toBe(true);
    expect(combine([true, false], 'and')).toBe(false);
  });

  it('STANDALONE_EXPRESSION_EVALUATOR_CODE exports evaluateExpression and resolveValue', () => {
    expect(STANDALONE_EXPRESSION_EVALUATOR_CODE).toBeDefined();
    const factory = new Function(
      `${STANDALONE_EXPRESSION_EVALUATOR_CODE}; return { evaluateExpression, resolveValue };`
    );
    const { evaluateExpression, resolveValue } = factory();

    expect(typeof evaluateExpression).toBe('function');
    expect(typeof resolveValue).toBe('function');

    const context = {
      $json: { role: 'admin', count: 10 },
      $node: { Trigger: { json: { id: 123 } } },
      $env: { MODE: 'prod' },
    };

    expect(resolveValue('{{ $json.role }}', context.$json, context.$node, context.$env)).toBe('admin');
    expect(resolveValue('Count: {{ $json.count }}', context.$json, context.$node, context.$env)).toBe('Count: 10');
    expect(resolveValue('{{ $node["Trigger"].json.id }}', context.$json, context.$node, context.$env)).toBe(123);
  });
});
