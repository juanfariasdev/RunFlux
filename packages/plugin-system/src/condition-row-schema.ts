import type { JsonRowFieldSchema, JsonRowOption } from './types';

/**
 * Shared by every plugin that evaluates conditions the same way — condition-if,
 * filter, and condition-switch's per-rule conditions each switch on these same
 * operator values in their own `compare()`.
 */
export const OPERATOR_OPTIONS: JsonRowOption[] = [
  { value: 'equals', label: 'Equals' },
  { value: 'notEquals', label: 'Not equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'greaterThan', label: 'Greater than' },
  { value: 'lessThan', label: 'Less than' },
  { value: 'isEmpty', label: 'Is empty' },
];

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
    hideWhen: { key: 'operator', equals: 'isEmpty' },
  },
];

/** Row shape for a `rules: []` json parameter (condition-switch) — each rule is a condition group. */
export const RULE_ROW_SCHEMA: JsonRowFieldSchema[] = [
  { key: 'combinator', label: 'Combinator', kind: 'select', options: COMBINATOR_OPTIONS, initialValue: 'and' },
  {
    key: 'conditions',
    label: 'Conditions',
    kind: 'text',
    initialValue: [{ leftValue: '', operator: 'equals', rightValue: '' }],
  },
];
