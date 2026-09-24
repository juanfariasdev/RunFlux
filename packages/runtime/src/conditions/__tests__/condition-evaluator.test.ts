import { describe, expect, it } from 'vitest';
import { ConditionEvaluator, type Condition } from '../condition-evaluator.js';
import { UNARY_CONDITION_OPERATORS, type ConditionOperator } from '../condition-operators.js';

const strict = new ConditionEvaluator();
const loose = new ConditionEvaluator({ strict: false });
const test = (leftValue: unknown, operator: ConditionOperator, rightValue?: unknown) => strict.test({ leftValue, operator, rightValue });

describe('ConditionEvaluator.test', () => {
  it.each<[unknown, ConditionOperator, unknown, boolean]>([
    ['1', 'equals', 1, false],
    [1, 'equals', '1', false],
    ['1', 'notEquals', 1, true],
    [true, 'equals', 'true', false],
    [false, 'equals', 'false', false],
    [null, 'equals', 'null', false],
    [undefined, 'equals', 'undefined', false],
    [0, 'equals', false, false],
    [0, 'equals', '', false],
    ['', 'equals', false, false],
    [null, 'equals', undefined, false],
    [1, 'equals', 1, true],
    ['hello', 'equals', 'hello', true],
    ['hello', 'notEquals', 'world', true],
    [true, 'notEquals', false, true],
    [null, 'equals', null, true],
    [undefined, 'equals', undefined, true],
    [Number.NaN, 'equals', Number.NaN, true],
  ])('compares scalars strictly: %j %s %j is %s', (left, operator, right, expected) => {
    expect(test(left, operator, right)).toBe(expected);
  });

  it.each<[unknown, unknown, boolean]>([
    [{ a: 1, b: 2 }, { b: 2, a: 1 }, true],
    [{ a: 1 }, { b: 2 }, false],
    [{ a: 1 }, { a: 1, b: 2 }, false],
    [[1, 2, 3], [1, 2, 3], true],
    [[1, 2, '3'], [1, 2, 3], false],
    [[1, 2], [1, 3], false],
    [[1], { 0: 1 }, false],
    [{ nested: { list: [1, { deep: true }] } }, { nested: { list: [1, { deep: true }] } }, true],
    [new Date('2026-01-01'), new Date('2026-01-01'), true],
    [new Date('2026-01-01'), new Date('2026-01-02'), false],
    [/a/g, /a/g, true],
    [/a/g, /a/i, false],
  ])('compares structures deeply: %j equals %j is %s', (left, right, expected) => {
    expect(test(left, 'equals', right)).toBe(expected);
    expect(test(left, 'notEquals', right)).toBe(!expected);
  });

  it.each<[unknown, unknown]>([['1', 1], ['true', true], ['0', 0], [1, '1']])('equates %j and %j when not strict', (left, right) => {
    expect(loose.test({ leftValue: left, operator: 'equals', rightValue: right })).toBe(true);
  });

  it.each<[unknown, ConditionOperator, unknown, boolean]>([
    ['Hello World', 'contains', 'World', true],
    ['Hello World', 'contains', 'world', false],
    ['Hello World', 'notContains', 'xyz', true],
    ['Hello World', 'contains', '', true],
    ['total 42', 'contains', 42, true],
    [[10, 20, 30], 'contains', 20, true],
    [[10, 20, 30], 'contains', '20', false],
    [[{ id: 1 }, { id: 2 }], 'contains', { id: 1 }, true],
    [['apple'], 'notContains', 'orange', true],
    [null, 'contains', 'null', false],
    [undefined, 'contains', 'undefined', false],
    ['some text', 'contains', null, false],
    [{ key: 'value' }, 'contains', 'value', false],
    ['RunFlux Compiler', 'startsWith', 'RunFlux', true],
    ['RunFlux Compiler', 'startsWith', 'Compiler', false],
    ['RunFlux Compiler', 'endsWith', 'Compiler', true],
    ['RunFlux Compiler', 'endsWith', 'RunFlux', false],
    [12345, 'startsWith', '12', false],
    [null, 'startsWith', 'a', false],
    [undefined, 'endsWith', 'z', false],
  ])('checks text and list membership: %j %s %j is %s', (left, operator, right, expected) => {
    expect(test(left, operator, right)).toBe(expected);
  });

  it.each<[unknown, ConditionOperator, unknown, boolean]>([
    [10, 'greaterThan', 5, true],
    [5, 'greaterThan', 10, false],
    [5, 'lessThan', 10, true],
    [10, 'greaterThanOrEqual', 10, true],
    [10, 'lessThanOrEqual', 10, true],
    [9, 'greaterThanOrEqual', 10, false],
    ['10', 'greaterThan', '5', true],
    ['2.5', 'lessThan', '3.1', true],
    ['100', 'greaterThanOrEqual', 100, true],
    [null, 'greaterThan', -1, false],
    ['', 'greaterThan', -1, false],
    [false, 'greaterThan', -1, false],
    ['abc', 'greaterThan', 5, false],
    [10, 'greaterThan', 'xyz', false],
    [Number.POSITIVE_INFINITY, 'greaterThan', 1, false],
  ])('compares numbers without coercing invalid values: %j %s %j is %s', (left, operator, right, expected) => {
    expect(test(left, operator, right)).toBe(expected);
  });

  it.each<[unknown, boolean]>([
    ['', true], [null, true], [undefined, true], [[], true], [{}, true], [new Set(), true], [new Map(), true],
    [0, false], [false, false], [' ', false], ['text', false], [[1], false], [{ a: 1 }, false], [new Set([1]), false],
  ])('treats %j as empty: %s', (value, empty) => {
    expect(test(value, 'isEmpty')).toBe(empty);
    expect(test(value, 'isNotEmpty')).toBe(!empty);
  });

  it.each<[unknown, unknown, boolean]>([
    ['user@example.com', '^[\\w.-]+@[\\w.-]+\\.[a-z]{2,}$', true],
    ['not-an-email', '^[\\w.-]+@[\\w.-]+\\.[a-z]{2,}$', false],
    ['test', '[unclosed', false],
    [42, '42', false],
    ['42', 42, false],
  ])('matches %j against pattern %j: %s', (left, pattern, expected) => {
    expect(test(left, 'regex', pattern)).toBe(expected);
  });
});

describe('UNARY_CONDITION_OPERATORS', () => {
  it.each(UNARY_CONDITION_OPERATORS)('%s ignores the right value', (operator) => {
    const evaluator = new ConditionEvaluator();
    for (const left of ['', 'text', [], [1], null, 0]) {
      const results = [undefined, '', 'other', 42].map((rightValue) => evaluator.test({ leftValue: left, operator, rightValue }));
      expect(new Set(results).size).toBe(1);
    }
  });
});

describe('ConditionEvaluator.matches', () => {
  const passing: Condition[] = [{ leftValue: 1, operator: 'equals', rightValue: 1 }, { leftValue: 'a', operator: 'startsWith', rightValue: 'a' }];
  const mixed: Condition[] = [{ leftValue: 1, operator: 'equals', rightValue: 1 }, { leftValue: 1, operator: 'equals', rightValue: 2 }];

  it('requires every condition with "and" and any condition with "or"', () => {
    expect(strict.matches({ combinator: 'and', conditions: passing })).toBe(true);
    expect(strict.matches({ combinator: 'and', conditions: mixed })).toBe(false);
    expect(strict.matches({ combinator: 'or', conditions: mixed })).toBe(true);
    expect(strict.matches({ combinator: 'or', conditions: [mixed[1]] })).toBe(false);
  });

  it('holds vacuously for a group without conditions', () => {
    expect(strict.matches({ combinator: 'and', conditions: [] })).toBe(true);
    expect(strict.matches({ combinator: 'or', conditions: [] })).toBe(true);
  });

  it('finds the first group that holds, or -1', () => {
    const groups = [{ combinator: 'and' as const, conditions: [mixed[1]] }, { combinator: 'and' as const, conditions: passing }, { combinator: 'and' as const, conditions: [] }];
    expect(strict.firstMatch(groups)).toBe(1);
    expect(strict.firstMatch([groups[0]])).toBe(-1);
    expect(strict.firstMatch([])).toBe(-1);
  });
});
