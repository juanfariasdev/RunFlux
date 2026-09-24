/**
 * Standardized Standalone Code Snippets for RunFlux Compilers
 *
 * Emitted by plugin generators (e.g. condition-if, condition-switch, filter, set, http-output).
 * Guarantees that compiled backends execute with the exact same robust, type-safe logic
 * as the runtime engine (including strict type checking where "1" !== 1).
 */

export const STANDALONE_OPERATOR_CODE = `
function deepEqual(a, b, strict = true) {
  if (Object.is(a, b)) return true;
  if (!strict) {
    if (
      (typeof a === 'string' || typeof a === 'number' || typeof a === 'boolean') &&
      (typeof b === 'string' || typeof b === 'number' || typeof b === 'boolean')
    ) {
      return String(a) === String(b);
    }
  }
  if (typeof a !== typeof b) return false;
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
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!deepEqual(a[key], b[key], strict)) return false;
    }
    return true;
  }
  return false;
}

function isValidNumber(value) {
  if (typeof value === 'number') return !Number.isNaN(value) && Number.isFinite(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return false;
    const num = Number(trimmed);
    return !Number.isNaN(num) && Number.isFinite(num);
  }
  return false;
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

function evaluateOperator(left, operator, right, options) {
  const strict = options?.strict ?? true;
  switch (operator) {
    case 'equals': return deepEqual(left, right, strict);
    case 'notEquals': return !deepEqual(left, right, strict);
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
    case 'notContains': return !evaluateOperator(left, 'contains', right, options);
    case 'startsWith': return typeof left === 'string' && typeof right === 'string' ? left.startsWith(right) : false;
    case 'endsWith': return typeof left === 'string' && typeof right === 'string' ? left.endsWith(right) : false;
    case 'greaterThan': return isValidNumber(left) && isValidNumber(right) ? Number(left) > Number(right) : false;
    case 'lessThan': return isValidNumber(left) && isValidNumber(right) ? Number(left) < Number(right) : false;
    case 'greaterThanOrEqual': return isValidNumber(left) && isValidNumber(right) ? Number(left) >= Number(right) : false;
    case 'lessThanOrEqual': return isValidNumber(left) && isValidNumber(right) ? Number(left) <= Number(right) : false;
    case 'isEmpty': return isEmptyValue(left);
    case 'isNotEmpty': return !isEmptyValue(left);
    case 'regex': {
      if (typeof left !== 'string' || typeof right !== 'string') return false;
      try { return new RegExp(right).test(left); } catch { return false; }
    }
    default: return false;
  }
}

function combineConditions(results, combinator = 'and') {
  if (results.length === 0) return true;
  return combinator === 'or' ? results.some(Boolean) : results.every(Boolean);
}

const compare = evaluateOperator;
const combine = combineConditions;
`;

export const STANDALONE_EXPRESSION_EVALUATOR_CODE = `
function createSafeNodeProxy(nodeMap) {
  const target = nodeMap || {};
  return new Proxy(target, {
    get(obj, prop) {
      if (typeof prop === 'string') {
        if (prop in obj) {
          const entry = obj[prop];
          if (entry !== null && typeof entry === 'object' && 'json' in entry) return entry;
          return { json: entry };
        }
        return { json: undefined };
      }
      return undefined;
    }
  });
}

function evaluateExpression(expr, $json, $node, $env) {
  const safeNode = createSafeNodeProxy($node);
  const safeEnv = $env || (typeof process !== 'undefined' ? process.env : {});
  return new Function('$json', '$node', '$env', 'return (' + expr + ')')($json, safeNode, safeEnv);
}

function resolveValue(raw, $json, $node, $env) {
  if (typeof raw !== 'string') {
    if (Array.isArray(raw)) return raw.map((v) => resolveValue(v, $json, $node, $env));
    if (raw !== null && typeof raw === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(raw)) out[k] = resolveValue(v, $json, $node, $env);
      return out;
    }
    return raw;
  }
  const trimmed = raw.trim();
  const whole = /^{{([\\s\\S]*)}}\$/.exec(trimmed);
  if (whole) return evaluateExpression(whole[1].trim(), $json, $node, $env);
  return raw.replace(/{{([\\s\\S]*?)}}/g, (_m, expr) => {
    const res = evaluateExpression(expr.trim(), $json, $node, $env);
    return res === null || res === undefined ? '' : String(res);
  });
}
`;
