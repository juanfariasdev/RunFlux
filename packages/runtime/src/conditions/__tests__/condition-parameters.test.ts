import { describe, expect, it } from 'vitest';
import { ParameterError, ObjectParameterReader } from '../../parameters/parameter-reader.js';
import { readCombinator, readConditionGroups, readConditions } from '../condition-parameters.js';

const reader = (values: Record<string, unknown>) => new ObjectParameterReader(values, 'condition-if');

describe('readConditions', () => {
  it('reads rows, defaulting a missing operator to equals', () => {
    expect(readConditions(reader({ conditions: [{ leftValue: 1, operator: 'greaterThan', rightValue: 0 }, { leftValue: 'a', rightValue: 'a' }] }), 'conditions'))
      .toEqual([{ leftValue: 1, operator: 'greaterThan', rightValue: 0 }, { leftValue: 'a', operator: 'equals', rightValue: 'a' }]);
  });

  it('reads a missing list as no conditions', () => {
    expect(readConditions(reader({}), 'conditions')).toEqual([]);
  });

  it.each([
    [{ conditions: 'x > 1' }, 'condition-if: parameter "conditions" must be a list'],
    [{ conditions: ['x'] }, 'condition-if: parameter "conditions" row 1 must be an object'],
    [{ conditions: [{ operator: 'between' }] }, 'condition-if: parameter "conditions" row 1 uses unknown operator "between"'],
    [{ conditions: [{ operator: 'toString' }] }, 'uses unknown operator "toString"'],
  ])('rejects malformed rows: %j', (values, message) => {
    expect(() => readConditions(reader(values), 'conditions')).toThrow(ParameterError);
    expect(() => readConditions(reader(values), 'conditions')).toThrow(message);
  });
});

describe('readCombinator', () => {
  it.each([[{}, 'and'], [{ combinator: 'or' }, 'or'], [{ combinator: 'and' }, 'and']])('reads %j as %s', (values, expected) => {
    expect(readCombinator(reader(values), 'combinator')).toBe(expected);
  });

  it('rejects other combinators', () => {
    expect(() => readCombinator(reader({ combinator: 'xor' }), 'combinator')).toThrow('must be one of "and", "or"');
  });
});

describe('readConditionGroups', () => {
  it('reads each rule with its own combinator and conditions', () => {
    const rules = [{ combinator: 'or', conditions: [{ leftValue: 1, operator: 'equals', rightValue: 1 }] }, {}];
    expect(readConditionGroups(reader({ rules }), 'rules')).toEqual([
      { combinator: 'or', conditions: [{ leftValue: 1, operator: 'equals', rightValue: 1 }] },
      { combinator: 'and', conditions: [] },
    ]);
  });

  it.each([
    [[null], 'rule 1 must be an object'],
    [[{ combinator: 'xor' }], 'rule 1 must combine its conditions with "and" or "or"'],
    [[{}, { conditions: {} }], 'rule 2 must have a list of conditions'],
    [[{ conditions: [{ operator: 'nope' }] }], 'rule 1 condition row 1 uses unknown operator "nope"'],
  ])('rejects malformed rules: %j', (rules, message) => {
    expect(() => readConditionGroups(reader({ rules }), 'rules')).toThrow(message);
  });
});
