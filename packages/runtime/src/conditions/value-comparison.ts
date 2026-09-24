/**
 * Structural equality without string coercion. In non-strict mode, strings, numbers and booleans
 * compare by their text ("1" equals 1).
 */
export function deepEqual(left: unknown, right: unknown, strict = true): boolean {
  if (Object.is(left, right)) return true;
  if (!strict && isScalar(left) && isScalar(right)) return String(left) === String(right);
  if (typeof left !== typeof right || left === null || right === null || typeof left !== 'object') return false;

  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => deepEqual(item, right[index], strict));
  }
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (left instanceof RegExp && right instanceof RegExp) return left.source === right.source && left.flags === right.flags;

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const keys = Object.keys(leftRecord);
  return keys.length === Object.keys(rightRecord).length
    && keys.every((key) => Object.hasOwn(rightRecord, key) && deepEqual(leftRecord[key], rightRecord[key], strict));
}

/** Null, undefined, "", [], {} and empty Set/Map are empty; 0 and false are not. */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value === '';
  if (Array.isArray(value)) return value.length === 0;
  if (value instanceof Set || value instanceof Map) return value.size === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/** A finite number, or text holding one. Null, "" and false are not numeric. */
export function isNumeric(value: unknown): value is number | string {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}
