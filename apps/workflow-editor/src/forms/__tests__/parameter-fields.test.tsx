import type { ParameterSchema } from '@runflux/plugin-system/sdk';
import { describe, expect, it } from 'vitest';
import { PARAMETER_FIELD_RENDERERS } from '../parameter-fields';

const kinds = ['checkbox', 'select', 'suggestions', 'json', 'sensitive', 'code', 'text'];
const parameter = (overrides: Partial<ParameterSchema>): ParameterSchema => ({ name: 'p', label: 'P', type: 'string', required: false, ...overrides });
const kindOf = (schema: ParameterSchema) => kinds[PARAMETER_FIELD_RENDERERS.findIndex((renderer) => renderer.matches(schema))];

describe('PARAMETER_FIELD_RENDERERS', () => {
  it('picks the control with the precedence the node panel always used', () => {
    const options = [{ value: 'a', label: 'A' }];
    expect(kindOf(parameter({ type: 'boolean', sensitive: true }))).toBe('checkbox');
    expect(kindOf(parameter({ options, sensitive: true }))).toBe('select');
    expect(kindOf(parameter({ options, allowCustomOptions: true }))).toBe('suggestions');
    expect(kindOf(parameter({ type: 'json', sensitive: true }))).toBe('json');
    expect(kindOf(parameter({ sensitive: true, language: 'sql' }))).toBe('sensitive');
    expect(kindOf(parameter({ language: 'javascript' }))).toBe('code');
    expect(kindOf(parameter({ type: 'number' }))).toBe('text');
    expect(kindOf(parameter({}))).toBe('text');
  });
});
