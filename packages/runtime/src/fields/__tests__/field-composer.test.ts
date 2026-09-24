import { describe, expect, it } from 'vitest';
import { ObjectParameterReader } from '../../parameters/parameter-reader.js';
import { FieldComposer, FieldTypeError, readFields, type FieldDefinition } from '../field-composer.js';

const composer = new FieldComposer();
const field = (value: unknown, type?: FieldDefinition['type']): FieldDefinition => ({ name: 'field', value, type });

describe('FieldComposer.normalize', () => {
  it.each<[unknown, FieldDefinition['type'], unknown]>([
    ['text', 'string', 'text'],
    [42, 'string', '42'],
    [true, 'string', 'true'],
    [{ a: 1 }, 'string', '{"a":1}'],
    [null, 'string', ''],
    [undefined, 'string', ''],
    [42, 'number', 42],
    ['42', 'number', 42],
    [' 2.5 ', 'number', 2.5],
    [true, 'boolean', true],
    ['false', 'boolean', false],
    ['anything', 'null', null],
    [[1, 2], 'array', [1, 2]],
    [{ a: 1 }, 'object', { a: 1 }],
    ['["a", 2]', 'array', ['a', 2]],
    [' {"a": {"b": true}} ', 'object', { a: { b: true } }],
    [{ untyped: true }, undefined, { untyped: true }],
  ])('converts %j to %s', (value, type, expected) => {
    expect(composer.normalize(field(value, type))).toEqual(expected);
  });

  it.each<[unknown, FieldDefinition['type'], string]>([
    ['abc', 'number', 'Field "field" must be a number'],
    ['', 'number', 'Field "field" must be a number'],
    [Number.NaN, 'number', 'Field "field" must be a number'],
    ['yes', 'boolean', 'Field "field" must be a boolean'],
    [{ 0: 1 }, 'array', 'Field "field" must be an array'],
    [[1], 'object', 'Field "field" must be an object'],
    [null, 'object', 'Field "field" must be an object'],
    ['a, b', 'array', 'Field "field" must be an array'],
    ['{"a": 1}', 'array', 'Field "field" must be an array'],
    ['[1]', 'object', 'Field "field" must be an object'],
    ['not json', 'object', 'Field "field" must be an object'],
  ])('rejects %j as %s', (value, type, message) => {
    expect(() => composer.normalize(field(value, type))).toThrow(FieldTypeError);
    expect(() => composer.normalize(field(value, type))).toThrow(message);
  });

  it('keeps the value of a type it does not know', () => {
    expect(composer.normalize({ name: 'field', value: 'x', type: 'date' as never })).toBe('x');
  });
});

describe('FieldComposer.compose', () => {
  it('composes fields over a copy of the base, later fields winning', () => {
    const base = { keep: true, name: 'old' };
    expect(composer.compose([field('1', 'number'), { name: 'name', value: 'new' }, { name: 'name', value: 'newest' }], base))
      .toEqual({ keep: true, name: 'newest', field: 1 });
    expect(base).toEqual({ keep: true, name: 'old' });
  });
});

describe('readFields', () => {
  const reader = (fields: unknown) => new ObjectParameterReader({ fields }, 'set');

  it('reads typed rows and skips rows without a name', () => {
    expect(readFields(reader([{ name: 'a', value: '1', type: 'number' }, { value: 'unnamed' }, { name: 'b', value: 'x' }]), 'fields'))
      .toEqual([{ name: 'a', value: '1', type: 'number' }, { name: 'b', value: 'x', type: undefined }]);
  });

  it.each([
    ['text', 'set: parameter "fields" must be a list'],
    [[1], 'set: parameter "fields" row 1 must be an object'],
    [[{ name: 'a', type: 'date' }], 'set: parameter "fields" row 1 has unknown type "date"'],
  ])('rejects %j', (fields, message) => {
    expect(() => readFields(reader(fields), 'fields')).toThrow(message);
  });
});
