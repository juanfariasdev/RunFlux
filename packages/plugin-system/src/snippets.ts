import { bundleStandalone } from './standalone.js';

// These compatibility snippets are built from the same modules used by the editor.
export const STANDALONE_OPERATOR_CODE = bundleStandalone(
  '@runflux/plugin-system/operators',
  ['evaluateOperator', 'combineConditions', 'compare', 'combine', 'matchRule', 'evaluateSwitch', 'deepEqual', 'isEmptyValue'],
  '__runfluxOperators',
);

export const STANDALONE_EXPRESSION_EVALUATOR_CODE = bundleStandalone(
  '@runflux/plugin-system/evaluator', ['evaluateExpression', 'resolveValue'], '__runfluxExpressions',
).replace('const { evaluateExpression, resolveValue } = __runfluxExpressions;', `
function evaluateExpression(expr, $json, $node, $env) {
  return __runfluxExpressions.evaluateExpression(expr, { $json, $node, $env });
}
function resolveValue(raw, $json, $node, $env) {
  return __runfluxExpressions.resolveValue(raw, { $json, $node, $env });
}`);
