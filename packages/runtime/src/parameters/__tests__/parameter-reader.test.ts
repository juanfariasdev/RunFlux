import { describe, expect, it } from 'vitest';
import { ParameterError, ParameterReader } from '../parameter-reader.js';

const reader = (values: Record<string, unknown>) => new ParameterReader(values, 'example');

describe('ParameterReader', () => {
  it.each([undefined, null, '', '   '])('treats %j as missing and uses the default', (value) => {
    const parameters = reader({ value });
    expect(parameters.string('value', 'default')).toBe('default');
    expect(parameters.optionalString('value')).toBeUndefined();
    expect(parameters.boolean('value', true)).toBe(true);
    expect(parameters.list('value')).toEqual([]);
    expect(parameters.record('value')).toEqual({});
    expect(parameters.choice('value', ['a', 'b'], 'b')).toBe('b');
  });

  it('returns configured values of the right type', () => {
    const parameters = reader({ text: ' spaced ', flag: false, textFlag: 'true', list: [1], object: { a: 1 }, option: 'a' });
    expect(parameters.string('text', 'default')).toBe(' spaced ');
    expect(parameters.requiredString('text')).toBe(' spaced ');
    expect(parameters.boolean('flag', true)).toBe(false);
    expect(parameters.boolean('textFlag', false)).toBe(true);
    expect(parameters.list('list')).toEqual([1]);
    expect(parameters.record('object')).toEqual({ a: 1 });
    expect(parameters.choice('option', ['a', 'b'], 'b')).toBe('a');
    expect(parameters.raw('object')).toEqual({ a: 1 });
    expect(parameters.all()).toEqual({ text: ' spaced ', flag: false, textFlag: 'true', list: [1], object: { a: 1 }, option: 'a' });
  });

  it.each<[string, (parameters: ParameterReader) => unknown, string]>([
    ['text', (p) => p.string('value', 'x'), 'example: parameter "value" must be text'],
    ['required text', (p) => p.requiredString('absent'), 'example: parameter "absent" is required'],
    ['a boolean', (p) => p.boolean('value', false), 'example: parameter "value" must be true or false'],
    ['a list', (p) => p.list('value'), 'example: parameter "value" must be a list'],
    ['an object', (p) => p.record('value'), 'example: parameter "value" must be an object'],
    ['an object, not a list', (p) => p.record('list'), 'example: parameter "list" must be an object'],
    ['a known option', (p) => p.choice('option', ['a', 'b'], 'a'), 'example: parameter "option" must be one of "a", "b"'],
  ])('rejects a value that is not %s', (_kind, read, message) => {
    const parameters = reader({ value: 42, list: [], option: 'c' });
    expect(() => read(parameters)).toThrow(ParameterError);
    expect(() => read(parameters)).toThrow(message);
  });
});
