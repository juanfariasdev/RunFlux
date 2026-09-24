import { describe, it, expect } from 'vitest';
import {
  evaluateOperator,
  combineConditions,
  matchRule,
  compare,
  combine,
  type ConditionRule,
} from '../operators';

describe('Operators & Condition Evaluation (TDD)', () => {
  describe('Strict Equality ("equals" & "notEquals")', () => {
    it('does NOT equate different primitive types, such as "1" and 1', () => {
      // User specific requirement: "casos que não deveria como '1' ser igual 1"
      expect(evaluateOperator('1', 'equals', 1)).toBe(false);
      expect(evaluateOperator(1, 'equals', '1')).toBe(false);
      expect(evaluateOperator('1', 'notEquals', 1)).toBe(true);

      // Boolean vs String
      expect(evaluateOperator(true, 'equals', 'true')).toBe(false);
      expect(evaluateOperator('true', 'equals', true)).toBe(false);
      expect(evaluateOperator(false, 'equals', 'false')).toBe(false);

      // Null and undefined vs String
      expect(evaluateOperator(null, 'equals', 'null')).toBe(false);
      expect(evaluateOperator(undefined, 'equals', 'undefined')).toBe(false);

      // 0 vs false / empty string
      expect(evaluateOperator(0, 'equals', false)).toBe(false);
      expect(evaluateOperator(0, 'equals', '')).toBe(false);
      expect(evaluateOperator('', 'equals', false)).toBe(false);
    });

    it('correctly equates matching primitive types', () => {
      expect(evaluateOperator(1, 'equals', 1)).toBe(true);
      expect(evaluateOperator(1, 'notEquals', 1)).toBe(false);

      expect(evaluateOperator('hello', 'equals', 'hello')).toBe(true);
      expect(evaluateOperator('hello', 'notEquals', 'world')).toBe(true);

      expect(evaluateOperator(true, 'equals', true)).toBe(true);
      expect(evaluateOperator(false, 'equals', false)).toBe(true);
      expect(evaluateOperator(true, 'notEquals', false)).toBe(true);

      expect(evaluateOperator(null, 'equals', null)).toBe(true);
      expect(evaluateOperator(undefined, 'equals', undefined)).toBe(true);
      expect(evaluateOperator(null, 'equals', undefined)).toBe(false);
    });

    it('performs deep structural equality on objects and arrays (no [object Object] pitfalls)', () => {
      // Deep equal objects
      expect(evaluateOperator({ a: 1, b: 2 }, 'equals', { b: 2, a: 1 })).toBe(true);
      // Different objects
      expect(evaluateOperator({ a: 1 }, 'equals', { b: 2 })).toBe(false);
      expect(evaluateOperator({ a: 1 }, 'notEquals', { b: 2 })).toBe(true);

      // Deep equal arrays
      expect(evaluateOperator([1, 2, 3], 'equals', [1, 2, 3])).toBe(true);
      // Array type mismatch
      expect(evaluateOperator([1, 2, '3'], 'equals', [1, 2, 3])).toBe(false);
      // Different arrays
      expect(evaluateOperator([1, 2], 'equals', [1, 3])).toBe(false);
    });

    it('supports loose equality when explicitly configured', () => {
      expect(evaluateOperator('1', 'equals', 1, { strict: false })).toBe(true);
      expect(evaluateOperator('true', 'equals', true, { strict: false })).toBe(true);
      expect(evaluateOperator('0', 'equals', 0, { strict: false })).toBe(true);
    });
  });

  describe('Substrings & Collections ("contains" & "notContains")', () => {
    it('checks substring containment for strings safely', () => {
      expect(evaluateOperator('Hello World', 'contains', 'World')).toBe(true);
      expect(evaluateOperator('Hello World', 'contains', 'world')).toBe(false);
      expect(evaluateOperator('Hello World', 'notContains', 'xyz')).toBe(true);
      expect(evaluateOperator('Hello World', 'contains', '')).toBe(true);
    });

    it('checks element containment for arrays with strict item equality', () => {
      expect(evaluateOperator([10, 20, 30], 'contains', 20)).toBe(true);
      expect(evaluateOperator([10, 20, 30], 'contains', '20')).toBe(false); // strict: '20' !== 20
      expect(evaluateOperator(['apple', 'banana'], 'contains', 'apple')).toBe(true);
      expect(evaluateOperator(['apple', 'banana'], 'notContains', 'orange')).toBe(true);
      expect(evaluateOperator([{ id: 1 }, { id: 2 }], 'contains', { id: 1 })).toBe(true);
    });

    it('does not coerce null or undefined to "null" or "undefined"', () => {
      expect(evaluateOperator(null, 'contains', 'null')).toBe(false);
      expect(evaluateOperator(undefined, 'contains', 'undefined')).toBe(false);
      expect(evaluateOperator('some text', 'contains', null)).toBe(false);
    });
  });

  describe('Prefix & Suffix ("startsWith" & "endsWith")', () => {
    it('verifies string start and end accurately', () => {
      expect(evaluateOperator('RunFlux Compiler', 'startsWith', 'RunFlux')).toBe(true);
      expect(evaluateOperator('RunFlux Compiler', 'startsWith', 'Compiler')).toBe(false);
      expect(evaluateOperator('RunFlux Compiler', 'endsWith', 'Compiler')).toBe(true);
      expect(evaluateOperator('RunFlux Compiler', 'endsWith', 'RunFlux')).toBe(false);
    });

    it('returns false safely for non-string targets', () => {
      expect(evaluateOperator(12345, 'startsWith', '12')).toBe(false);
      expect(evaluateOperator(null, 'startsWith', 'a')).toBe(false);
      expect(evaluateOperator(undefined, 'endsWith', 'z')).toBe(false);
    });
  });

  describe('Numeric & Ordering Operators ("greaterThan", "lessThan", etc.)', () => {
    it('compares valid numbers accurately', () => {
      expect(evaluateOperator(10, 'greaterThan', 5)).toBe(true);
      expect(evaluateOperator(5, 'greaterThan', 10)).toBe(false);
      expect(evaluateOperator(5, 'lessThan', 10)).toBe(true);
      expect(evaluateOperator(10, 'greaterThanOrEqual', 10)).toBe(true);
      expect(evaluateOperator(10, 'lessThanOrEqual', 10)).toBe(true);
      expect(evaluateOperator(9, 'greaterThanOrEqual', 10)).toBe(false);
    });

    it('compares valid numeric strings as numbers', () => {
      expect(evaluateOperator('10', 'greaterThan', '5')).toBe(true);
      expect(evaluateOperator('2.5', 'lessThan', '3.1')).toBe(true);
      expect(evaluateOperator('100', 'greaterThanOrEqual', 100)).toBe(true);
    });

    it('does NOT coerce invalid types (null, "", false, non-numeric strings) into 0', () => {
      // In JS: Number(null) is 0, Number("") is 0, Number(false) is 0
      // But in a business rule engine, null or "" is NOT -1 or 0
      expect(evaluateOperator(null, 'greaterThan', -1)).toBe(false);
      expect(evaluateOperator('', 'greaterThan', -1)).toBe(false);
      expect(evaluateOperator(false, 'greaterThan', -1)).toBe(false);
      expect(evaluateOperator('abc', 'greaterThan', 5)).toBe(false);
      expect(evaluateOperator(10, 'greaterThan', 'xyz')).toBe(false);
    });
  });

  describe('Emptiness ("isEmpty" & "isNotEmpty")', () => {
    it('identifies genuinely empty values', () => {
      expect(evaluateOperator('', 'isEmpty')).toBe(true);
      expect(evaluateOperator(null, 'isEmpty')).toBe(true);
      expect(evaluateOperator(undefined, 'isEmpty')).toBe(true);
      expect(evaluateOperator([], 'isEmpty')).toBe(true);
      expect(evaluateOperator({}, 'isEmpty')).toBe(true);
      expect(evaluateOperator(new Set(), 'isEmpty')).toBe(true);
      expect(evaluateOperator(new Map(), 'isEmpty')).toBe(true);

      expect(evaluateOperator('', 'isNotEmpty')).toBe(false);
      expect(evaluateOperator([], 'isNotEmpty')).toBe(false);
    });

    it('preserves 0 and false as NOT empty', () => {
      expect(evaluateOperator(0, 'isEmpty')).toBe(false);
      expect(evaluateOperator(false, 'isEmpty')).toBe(false);
      expect(evaluateOperator(0, 'isNotEmpty')).toBe(true);
      expect(evaluateOperator(false, 'isNotEmpty')).toBe(true);
    });

    it('identifies non-empty values correctly', () => {
      expect(evaluateOperator(' ', 'isEmpty')).toBe(false);
      expect(evaluateOperator('text', 'isEmpty')).toBe(false);
      expect(evaluateOperator([1], 'isEmpty')).toBe(false);
      expect(evaluateOperator({ a: 1 }, 'isEmpty')).toBe(false);
    });
  });

  describe('Regular Expressions ("regex")', () => {
    it('tests regex patterns matching strings', () => {
      expect(evaluateOperator('user@example.com', 'regex', '^[\\w.-]+@[\\w.-]+\\.[a-z]{2,}$')).toBe(true);
      expect(evaluateOperator('not-an-email', 'regex', '^[\\w.-]+@[\\w.-]+\\.[a-z]{2,}$')).toBe(false);
    });

    it('handles invalid regex gracefully without throwing unhandled exceptions', () => {
      expect(evaluateOperator('test', 'regex', '[unclosed')).toBe(false);
    });
  });

  describe('Condition Combination ("combineConditions" & "matchRule")', () => {
    it('combines boolean array with "and"', () => {
      expect(combineConditions([true, true], 'and')).toBe(true);
      expect(combineConditions([true, false], 'and')).toBe(false);
      expect(combineConditions([], 'and')).toBe(true); // vacuously true
    });

    it('combines boolean array with "or"', () => {
      expect(combineConditions([false, true], 'or')).toBe(true);
      expect(combineConditions([false, false], 'or')).toBe(false);
      expect(combineConditions([], 'or')).toBe(true);
    });

    it('evaluates a list of ConditionRules via matchRule', () => {
      const rules: ConditionRule[] = [
        { leftValue: 'admin', operator: 'equals', rightValue: 'admin' },
        { leftValue: 25, operator: 'greaterThan', rightValue: 18 },
      ];
      expect(matchRule(rules, 'and')).toBe(true);

      const failingRules: ConditionRule[] = [
        { leftValue: 'guest', operator: 'equals', rightValue: 'admin' },
        { leftValue: 25, operator: 'greaterThan', rightValue: 18 },
      ];
      expect(matchRule(failingRules, 'and')).toBe(false);
      expect(matchRule(failingRules, 'or')).toBe(true);
    });
  });

  describe('Backward-Compatible Aliases ("compare" & "combine")', () => {
    it('aliases compare() and combine() for drop-in plugin replacement', () => {
      expect(compare('a', 'equals', 'a')).toBe(true);
      expect(compare('1', 'equals', 1)).toBe(false);
      expect(combine([true, false], 'or')).toBe(true);
      expect(combine([true, false], 'and')).toBe(false);
    });
  });
});
