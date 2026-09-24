import { CONDITION_OPERATORS, UNARY_CONDITION_OPERATORS, type ConditionOperator } from '@runflux/runtime';
import type { JsonRowFieldSchema, JsonRowOption } from './types.js';

const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: 'Equals',
  notEquals: 'Not equals',
  contains: 'Contains',
  notContains: 'Does not contain',
  startsWith: 'Starts with',
  endsWith: 'Ends with',
  greaterThan: 'Greater than',
  lessThan: 'Less than',
  greaterThanOrEqual: 'Greater than or equal',
  lessThanOrEqual: 'Less than or equal',
  isEmpty: 'Is empty',
  isNotEmpty: 'Is not empty',
  regex: 'Matches regex',
};

/**
 * Every operator the runtime's ConditionEvaluator implements, as editor choices. The labels map is
 * typed by the runtime's operator names, so an operator added there fails to compile until it has
 * a label here.
 */
export const OPERATOR_OPTIONS: JsonRowOption[] = (Object.keys(CONDITION_OPERATORS) as ConditionOperator[])
  .map((value) => ({ value, label: OPERATOR_LABELS[value] }));

export const COMBINATOR_OPTIONS: JsonRowOption[] = [
  { value: 'and', label: 'AND' },
  { value: 'or', label: 'OR' },
];

/** Row shape for a `conditions: []` json parameter (condition-if, filter). */
export const CONDITION_ROW_SCHEMA: JsonRowFieldSchema[] = [
  { key: 'leftValue', label: 'Left value', kind: 'text', initialValue: '' },
  { key: 'operator', label: 'Operator', kind: 'select', options: OPERATOR_OPTIONS, initialValue: 'equals' },
  {
    key: 'rightValue',
    label: 'Right value',
    kind: 'text',
    initialValue: '',
    hideWhen: { key: 'operator', oneOf: UNARY_CONDITION_OPERATORS },
  },
];

/** Row shape for a `rules: []` json parameter (condition-switch): each rule is a condition group. */
export const RULE_ROW_SCHEMA: JsonRowFieldSchema[] = [
  { key: 'combinator', label: 'Combinator', kind: 'select', options: COMBINATOR_OPTIONS, initialValue: 'and' },
  {
    key: 'conditions',
    label: 'Conditions',
    kind: 'text',
    initialValue: [{ leftValue: '', operator: 'equals', rightValue: '' }],
  },
];
