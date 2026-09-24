import { CONDITION_OPERATORS, UNARY_CONDITION_OPERATORS } from '@runflux/runtime';
import { describe, expect, it } from 'vitest';
import { CONDITION_ROW_SCHEMA, OPERATOR_OPTIONS } from '../condition-row-schema.js';
import { isParameterVisible, isRowFieldHidden, isRowFieldHiddenBy } from '../visibility.js';
import type { JsonRowFieldSchema, ParameterSchema } from '../types.js';

describe('OPERATOR_OPTIONS', () => {
  it('offers exactly the operators the runtime implements, each with a label', () => {
    expect(OPERATOR_OPTIONS.map((option) => option.value)).toEqual(Object.keys(CONDITION_OPERATORS));
    expect(OPERATOR_OPTIONS.every((option) => option.label.trim().length > 0)).toBe(true);
    expect(new Set(OPERATOR_OPTIONS.map((option) => option.label)).size).toBe(OPERATOR_OPTIONS.length);
  });
});

describe('isRowFieldHidden', () => {
  const rightValue = CONDITION_ROW_SCHEMA.find((field) => field.key === 'rightValue')!;

  it('hides the right value for every unary operator only', () => {
    for (const { value } of OPERATOR_OPTIONS) {
      expect(isRowFieldHidden(rightValue, { operator: value })).toBe(UNARY_CONDITION_OPERATORS.includes(value as never));
    }
  });

  it('supports a single value, a list, both, and fields without a rule', () => {
    const field = (hideWhen?: JsonRowFieldSchema['hideWhen']): JsonRowFieldSchema => ({ key: 'x', label: 'X', kind: 'text', hideWhen });
    expect(isRowFieldHiddenBy(field({ key: 'mode', equals: 'off' }), 'off')).toBe(true);
    expect(isRowFieldHiddenBy(field({ key: 'mode', equals: 'off' }), 'on')).toBe(false);
    expect(isRowFieldHiddenBy(field({ key: 'mode', oneOf: ['a', 'b'] }), 'b')).toBe(true);
    expect(isRowFieldHiddenBy(field({ key: 'mode', equals: 'off', oneOf: ['a'] }), 'a')).toBe(true);
    expect(isRowFieldHiddenBy(field({ key: 'mode', oneOf: ['a'] }), undefined)).toBe(false);
    expect(isRowFieldHiddenBy(field(), 'anything')).toBe(false);
    expect(isRowFieldHidden(field({ key: 'mode', equals: undefined }), {})).toBe(true);
  });
});

describe('isParameterVisible', () => {
  const mode: ParameterSchema = { name: 'mode', label: 'Mode', type: 'string', required: false, default: 'none' };
  const secret: ParameterSchema = { name: 'secret', label: 'Secret', type: 'string', required: false, showWhen: { parameter: 'mode', oneOf: ['header', 'legacy'] } };

  it('shows a parameter without a condition', () => {
    expect(isParameterVisible(mode, {})).toBe(true);
  });

  it('shows a conditional parameter while the other parameter holds one of the values', () => {
    expect(isParameterVisible(secret, { mode: 'header' }, [mode, secret])).toBe(true);
    expect(isParameterVisible(secret, { mode: 'legacy' }, [mode, secret])).toBe(true);
    expect(isParameterVisible(secret, { mode: 'none' }, [mode, secret])).toBe(false);
  });

  it('reads an unset parameter as its default', () => {
    expect(isParameterVisible(secret, {}, [mode, secret])).toBe(false);
    expect(isParameterVisible(secret, {}, [{ ...mode, default: 'header' }, secret])).toBe(true);
  });
});
