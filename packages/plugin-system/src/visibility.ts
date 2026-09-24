import type { JsonRowFieldSchema, ParameterSchema } from './types.js';

/** Whether `field` is hidden in a row whose `hideWhen` key holds `value`. */
export function isRowFieldHiddenBy(field: JsonRowFieldSchema, value: unknown): boolean {
  const rule = field.hideWhen;
  if (!rule) return false;
  return ('equals' in rule && rule.equals === value) || (rule.oneOf?.includes(value) ?? false);
}

/** Whether `field` is hidden in `row`. */
export function isRowFieldHidden(field: JsonRowFieldSchema, row: Readonly<Record<string, unknown>>): boolean {
  return field.hideWhen !== undefined && isRowFieldHiddenBy(field, row[field.hideWhen.key]);
}

/**
 * Whether the editor shows `parameter` for a node whose parameters are `values`. A parameter the
 * condition refers to that is unset counts as its default.
 */
export function isParameterVisible(
  parameter: ParameterSchema,
  values: Readonly<Record<string, unknown>>,
  parameters: readonly ParameterSchema[] = [],
): boolean {
  const rule = parameter.showWhen;
  if (!rule) return true;
  const value = values[rule.parameter] ?? parameters.find((candidate) => candidate.name === rule.parameter)?.default;
  return rule.oneOf.includes(value);
}
