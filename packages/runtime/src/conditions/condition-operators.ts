import { deepEqual, isEmptyValue, isNumeric } from './value-comparison.js';

type OperatorTest = (left: unknown, right: unknown, strict: boolean) => boolean;

function numeric(compare: (left: number, right: number) => boolean): OperatorTest {
  return (left, right) => isNumeric(left) && isNumeric(right) && compare(Number(left), Number(right));
}

function contains(left: unknown, right: unknown, strict: boolean): boolean {
  if (typeof left === 'string') return right !== null && right !== undefined && left.includes(String(right));
  return Array.isArray(left) && left.some((item) => deepEqual(item, right, strict));
}

function matchesPattern(left: unknown, right: unknown): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  try {
    return new RegExp(right).test(left);
  } catch {
    return false;
  }
}

/** Every comparison a condition row can use, by operator name. */
export const CONDITION_OPERATORS = {
  equals: (left, right, strict) => deepEqual(left, right, strict),
  notEquals: (left, right, strict) => !deepEqual(left, right, strict),
  contains,
  notContains: (left, right, strict) => !contains(left, right, strict),
  startsWith: (left, right) => typeof left === 'string' && typeof right === 'string' && left.startsWith(right),
  endsWith: (left, right) => typeof left === 'string' && typeof right === 'string' && left.endsWith(right),
  greaterThan: numeric((left, right) => left > right),
  lessThan: numeric((left, right) => left < right),
  greaterThanOrEqual: numeric((left, right) => left >= right),
  lessThanOrEqual: numeric((left, right) => left <= right),
  isEmpty: (left) => isEmptyValue(left),
  isNotEmpty: (left) => !isEmptyValue(left),
  regex: matchesPattern,
} satisfies Record<string, OperatorTest>;

export type ConditionOperator = keyof typeof CONDITION_OPERATORS;

/** Operators that test the left value alone; their rows have no right value. */
export const UNARY_CONDITION_OPERATORS: readonly ConditionOperator[] = ['isEmpty', 'isNotEmpty'];

export function isConditionOperator(name: string): name is ConditionOperator {
  return Object.hasOwn(CONDITION_OPERATORS, name);
}
