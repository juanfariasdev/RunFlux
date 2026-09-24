/**
 * Standardized Operators & Condition Evaluation for RunFlux Plugins
 *
 * Implements strict, type-safe comparison preventing common type coercion pitfalls
 * (such as "1" === 1 or [object Object] equality).
 */

export type ConditionOperator =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'regex';

export type Combinator = 'and' | 'or' | string;

export interface ConditionRule {
  leftValue: unknown;
  operator: ConditionOperator | string;
  rightValue?: unknown;
}

export interface CompareOptions {
  /**
   * Whether to strictly require matching types (e.g. "1" !== 1).
   * @default true
   */
  strict?: boolean;
}

/**
 * Checks deep structural equality between two arbitrary values without string coercion.
 */
export function deepEqual(a: unknown, b: unknown, strict = true): boolean {
  if (Object.is(a, b)) return true;

  if (!strict) {
    if (
      (typeof a === 'string' || typeof a === 'number' || typeof a === 'boolean') &&
      (typeof b === 'string' || typeof b === 'number' || typeof b === 'boolean')
    ) {
      return String(a) === String(b);
    }
  }

  // Type mismatch in strict mode
  if (typeof a !== typeof b) return false;

  // Null / undefined checks (already handled by Object.is if both were same)
  if (a === null || b === null || a === undefined || b === undefined) return false;

  if (typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (!deepEqual(a[i], b[i], strict)) return false;
      }
      return true;
    }

    if (a instanceof Date && b instanceof Date) {
      return a.getTime() === b.getTime();
    }

    if (a instanceof RegExp && b instanceof RegExp) {
      return a.source === b.source && a.flags === b.flags;
    }

    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;

    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
      if (!deepEqual(aObj[key], bObj[key], strict)) return false;
    }

    return true;
  }

  return false;
}

/**
 * Checks whether a value can be legitimately treated as a number (without coercing null/""/false to 0).
 */
function isValidNumber(value: unknown): value is number | string {
  if (typeof value === 'number') {
    return !Number.isNaN(value) && Number.isFinite(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return false;
    const num = Number(trimmed);
    return !Number.isNaN(num) && Number.isFinite(num);
  }
  return false;
}

/**
 * Determines whether a value is empty (null, undefined, "", [], {}, empty Set/Map).
 * Preserves 0 and false as NOT empty.
 */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value === '';
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Set || value instanceof Map) return value.size === 0;
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

/**
 * Evaluates a condition operator against two values with type-safety.
 */
export function evaluateOperator(
  left: unknown,
  operator: ConditionOperator | string,
  right?: unknown,
  options?: CompareOptions
): boolean {
  const strict = options?.strict ?? true;

  switch (operator) {
    case 'equals':
      return deepEqual(left, right, strict);

    case 'notEquals':
      return !deepEqual(left, right, strict);

    case 'contains': {
      if (typeof left === 'string') {
        if (right === null || right === undefined) return false;
        return left.includes(String(right));
      }
      if (Array.isArray(left)) {
        return left.some((item) => deepEqual(item, right, strict));
      }
      return false;
    }

    case 'notContains': {
      return !evaluateOperator(left, 'contains', right, options);
    }

    case 'startsWith': {
      if (typeof left === 'string' && typeof right === 'string') {
        return left.startsWith(right);
      }
      return false;
    }

    case 'endsWith': {
      if (typeof left === 'string' && typeof right === 'string') {
        return left.endsWith(right);
      }
      return false;
    }

    case 'greaterThan': {
      if (!isValidNumber(left) || !isValidNumber(right)) return false;
      return Number(left) > Number(right);
    }

    case 'lessThan': {
      if (!isValidNumber(left) || !isValidNumber(right)) return false;
      return Number(left) < Number(right);
    }

    case 'greaterThanOrEqual': {
      if (!isValidNumber(left) || !isValidNumber(right)) return false;
      return Number(left) >= Number(right);
    }

    case 'lessThanOrEqual': {
      if (!isValidNumber(left) || !isValidNumber(right)) return false;
      return Number(left) <= Number(right);
    }

    case 'isEmpty':
      return isEmptyValue(left);

    case 'isNotEmpty':
      return !isEmptyValue(left);

    case 'regex': {
      if (typeof left !== 'string' || typeof right !== 'string') return false;
      try {
        const re = new RegExp(right);
        return re.test(left);
      } catch {
        return false;
      }
    }

    default:
      return false;
  }
}

/**
 * Combines an array of boolean condition outcomes with 'and' or 'or'.
 * An empty array is vacuously true.
 */
export function combineConditions(results: boolean[], combinator: Combinator = 'and'): boolean {
  if (results.length === 0) return true;
  return combinator === 'or' ? results.some(Boolean) : results.every(Boolean);
}

/**
 * Matches a list of ConditionRules according to a combinator.
 */
export function matchRule(
  conditions: ConditionRule[] | undefined | null,
  combinator: Combinator = 'and',
  options?: CompareOptions
): boolean {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;
  const results = conditions.map((c) => evaluateOperator(c.leftValue, c.operator, c.rightValue, options));
  return combineConditions(results, combinator);
}

/**
 * Backward-compatible alias for evaluateOperator used directly by plugin runtimes.
 */
export const compare = evaluateOperator;

/**
 * Backward-compatible alias for combineConditions used directly by plugin runtimes.
 */
export const combine = combineConditions;
