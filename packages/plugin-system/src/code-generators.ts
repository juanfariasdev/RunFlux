/**
 * Componentized Code Generators for RunFlux Plugins
 *
 * Provides standardized, professional code generation for compiled workflows.
 * Completely eliminates raw code string duplication and ad-hoc context handling in plugins.
 */

const STANDALONE_RUNTIME_PREAMBLE = `
function extractContext(context) {
  return {
    $node: context?.$node || {},
    $env: context?.$env || (typeof process !== 'undefined' ? process.env : {}),
  };
}

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
  if (
    trimmed.startsWith('{{') &&
    trimmed.endsWith('}}') &&
    trimmed.indexOf('}}') === trimmed.length - 2 &&
    !trimmed.slice(2, -2).includes('{{')
  ) {
    return evaluateExpression(trimmed.slice(2, -2).trim(), $json, $node, $env);
  }
  return raw.replace(/{{([\\s\\S]*?)}}/g, (_m, expr) => {
    const res = evaluateExpression(expr.trim(), $json, $node, $env);
    return res === null || res === undefined ? '' : String(res);
  });
}

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

function evaluateConditions(conditions, combinator, $json, $node, $env) {
  const list = Array.isArray(conditions) ? conditions : [];
  if (list.length === 0) return true;
  const results = list.map((c) =>
    evaluateOperator(
      resolveValue(c.leftValue, $json, $node, $env),
      c.operator,
      resolveValue(c.rightValue, $json, $node, $env)
    )
  );
  return combineConditions(results, combinator);
}

function evaluateSwitchRules(rules, ruleOutputs, fallbackEnabled, $json, $node, $env) {
  const list = Array.isArray(rules) ? rules : [];
  for (let i = 0; i < list.length && i < ruleOutputs.length; i++) {
    const rule = list[i];
    if (evaluateConditions(rule?.conditions, rule?.combinator || 'and', $json, $node, $env)) {
      return ruleOutputs[i];
    }
  }
  return fallbackEnabled ? 'fallback' : null;
}

function normalizeFieldValue(field, value) {
  if (field.type === 'null') return null;
  if (field.type === 'array') {
    if (Array.isArray(value)) return value;
    throw new Error('Field "' + field.name + '" must be an array');
  }
  if (field.type === 'object') {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value;
    throw new Error('Field "' + field.name + '" must be an object');
  }
  if (field.type === 'number') {
    const numberValue = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
    if (Number.isFinite(numberValue)) return numberValue;
    throw new Error('Field "' + field.name + '" must be a number');
  }
  if (field.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error('Field "' + field.name + '" must be a boolean');
  }
  if (field.type === 'string' && typeof value !== 'string') {
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return value;
}

function composeSetFields(fields, includeOtherFields, $json, $node, $env) {
  const base = includeOtherFields && $json !== null && typeof $json === 'object' ? { ...$json } : {};
  const list = Array.isArray(fields) ? fields : [];
  for (const field of list) {
    if (field && typeof field.name === 'string') {
      base[field.name] = normalizeFieldValue(field, resolveValue(field.value, $json, $node, $env));
    }
  }
  return base;
}
`;

export function generateConditionIfCode(config: { conditions?: unknown; combinator?: unknown }): string {
  const conditions = JSON.stringify(Array.isArray(config.conditions) ? config.conditions : []);
  const combinator = JSON.stringify((config.combinator as string | undefined) ?? 'and');

  return `// Generated by RunFlux for plugin "condition-if"
const CONDITIONS = ${conditions};
const COMBINATOR = ${combinator};

${STANDALONE_RUNTIME_PREAMBLE}

export function run($json, context) {
  const { $node, $env } = extractContext(context);
  const matched = evaluateConditions(CONDITIONS, COMBINATOR, $json, $node, $env);
  return { value: $json, activeOutput: matched ? 'true' : 'false' };
}
`;
}

export function generateConditionSwitchCode(config: {
  rules?: unknown;
  fallbackEnabled?: unknown;
  ruleOutputs?: string[];
}): string {
  const defaultOutputs = ['output1', 'output2', 'output3', 'output4', 'output5'];
  const rules = JSON.stringify(Array.isArray(config.rules) ? config.rules : []);
  const fallbackEnabled = JSON.stringify(Boolean(config.fallbackEnabled));
  const ruleOutputs = JSON.stringify(config.ruleOutputs || defaultOutputs);

  return `// Generated by RunFlux for plugin "condition-switch"
const RULES = ${rules};
const FALLBACK_ENABLED = ${fallbackEnabled};
const RULE_OUTPUTS = ${ruleOutputs};

${STANDALONE_RUNTIME_PREAMBLE}

export function run($json, context) {
  const { $node, $env } = extractContext(context);
  const activeOutput = evaluateSwitchRules(RULES, RULE_OUTPUTS, FALLBACK_ENABLED, $json, $node, $env);
  return { value: $json, activeOutput };
}
`;
}

export function generateFilterCode(config: { conditions?: unknown; combinator?: unknown }): string {
  const conditions = JSON.stringify(Array.isArray(config.conditions) ? config.conditions : []);
  const combinator = JSON.stringify((config.combinator as string | undefined) ?? 'and');

  return `// Generated by RunFlux for plugin "filter"
const CONDITIONS = ${conditions};
const COMBINATOR = ${combinator};

${STANDALONE_RUNTIME_PREAMBLE}

export function run($json, context) {
  const { $node, $env } = extractContext(context);
  const matched = evaluateConditions(CONDITIONS, COMBINATOR, $json, $node, $env);
  return { value: $json, activeOutput: matched ? 'main' : null };
}
`;
}

export function generateSetCode(config: { fields?: unknown; includeOtherFields?: unknown }): string {
  const fields = JSON.stringify(Array.isArray(config.fields) ? config.fields : []);
  const includeOtherFields = JSON.stringify(Boolean(config.includeOtherFields));

  return `// Generated by RunFlux for plugin "set"
const FIELDS = ${fields};
const INCLUDE_OTHER_FIELDS = ${includeOtherFields};

${STANDALONE_RUNTIME_PREAMBLE}

export function run($json, context) {
  const { $node, $env } = extractContext(context);
  return composeSetFields(FIELDS, INCLUDE_OTHER_FIELDS, $json, $node, $env);
}
`;
}

export function generateHttpOutputCode(config: {
  method?: unknown;
  url?: unknown;
  headers?: unknown;
  body?: unknown;
}): string {
  const method = JSON.stringify((config.method as string | undefined) ?? 'GET');
  const url = JSON.stringify(config.url ?? '');
  const headers = JSON.stringify(config.headers ?? {});
  const body = JSON.stringify(config.body ?? {});

  return `// Generated by RunFlux for plugin "http-output"
const METHOD = ${method};
const URL_TEMPLATE = ${url};
const HEADERS_TEMPLATE = ${headers};
const BODY_TEMPLATE = ${body};

${STANDALONE_RUNTIME_PREAMBLE}

export async function run($json, context) {
  const { $node, $env } = extractContext(context);
  const url = resolveValue(URL_TEMPLATE, $json, $node, $env);
  if (typeof url !== 'string' || url.trim() === '') {
    throw new Error('http-output: "url" is empty or invalid');
  }
  const method = METHOD.toUpperCase();
  const headers = resolveValue(HEADERS_TEMPLATE, $json, $node, $env);
  const body = resolveValue(BODY_TEMPLATE, $json, $node, $env);
  const init = { method, headers };
  if (method !== 'GET' && method !== 'HEAD') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(url, init);
  const responseHeaders = {};
  response.headers.forEach((value, key) => { responseHeaders[key] = value; });
  const contentType = response.headers.get('content-type') || '';
  const rawBody = await response.text();
  let parsedBody = rawBody;
  if (contentType.includes('application/json')) {
    try { parsedBody = JSON.parse(rawBody); } catch { parsedBody = rawBody; }
  }
  if (!response.ok) {
    throw new Error('http-output: request to ' + url + ' failed with status ' + response.status + ': ' + rawBody.slice(0, 200));
  }
  return { status: response.status, headers: responseHeaders, body: parsedBody };
}
`;
}

export function generateCodeJavascriptCode(config: { code?: unknown }): string {
  const userCode = (config.code as string | undefined)?.trim() || 'return $json;';

  return `// Generated by RunFlux for plugin "code-javascript"
${STANDALONE_RUNTIME_PREAMBLE}

export async function run($json: any, context?: any) {
  const { $node, $env } = extractContext(context);
  ${userCode}
}
`;
}

