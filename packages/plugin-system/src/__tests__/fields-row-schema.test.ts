import { describe, it, expect } from 'vitest';
import {
  normalizeFieldValue,
  composeFields,
  type FieldConfig,
  FIELDS_ROW_SCHEMA,
} from '../fields-row-schema';

describe('Fields Row Schema & normalizeFieldValue (TDD)', () => {
  it('exports FIELDS_ROW_SCHEMA with name, value, and type definition', () => {
    expect(FIELDS_ROW_SCHEMA).toBeDefined();
    expect(FIELDS_ROW_SCHEMA).toHaveLength(3);
    expect(FIELDS_ROW_SCHEMA.map((s) => s.key)).toEqual(['name', 'value', 'type']);
  });

  describe('normalizeFieldValue', () => {
    it('handles "null" type returning null regardless of value', () => {
      expect(normalizeFieldValue({ name: 'empty', value: 'something', type: 'null' })).toBeNull();
      expect(normalizeFieldValue({ name: 'empty', value: null, type: 'null' })).toBeNull();
    });

    it('handles "array" type validating genuine arrays and rejecting non-arrays', () => {
      expect(normalizeFieldValue({ name: 'tags', value: ['a', 'b'], type: 'array' })).toEqual(['a', 'b']);
      expect(() =>
        normalizeFieldValue({ name: 'tags', value: 'not an array', type: 'array' })
      ).toThrow('Field "tags" must be an array');
      expect(() =>
        normalizeFieldValue({ name: 'tags', value: { a: 1 }, type: 'array' })
      ).toThrow('Field "tags" must be an array');
    });

    it('handles "object" type validating genuine objects and rejecting arrays / non-objects', () => {
      expect(normalizeFieldValue({ name: 'profile', value: { age: 30 }, type: 'object' })).toEqual({ age: 30 });
      expect(() =>
        normalizeFieldValue({ name: 'profile', value: [1, 2, 3], type: 'object' })
      ).toThrow('Field "profile" must be an object');
      expect(() =>
        normalizeFieldValue({ name: 'profile', value: null, type: 'object' })
      ).toThrow('Field "profile" must be an object');
      expect(() =>
        normalizeFieldValue({ name: 'profile', value: 'string', type: 'object' })
      ).toThrow('Field "profile" must be an object');
    });

    it('handles "number" type converting numeric strings and numbers, rejecting non-numbers', () => {
      expect(normalizeFieldValue({ name: 'count', value: 42, type: 'number' })).toBe(42);
      expect(normalizeFieldValue({ name: 'count', value: '42', type: 'number' })).toBe(42);
      expect(normalizeFieldValue({ name: 'float', value: '3.14', type: 'number' })).toBe(3.14);
      expect(() =>
        normalizeFieldValue({ name: 'count', value: 'not-a-number', type: 'number' })
      ).toThrow('Field "count" must be a number');
      expect(() =>
        normalizeFieldValue({ name: 'count', value: '', type: 'number' })
      ).toThrow('Field "count" must be a number');
      expect(() =>
        normalizeFieldValue({ name: 'count', value: null, type: 'number' })
      ).toThrow('Field "count" must be a number');
    });

    it('handles "boolean" type supporting booleans and boolean strings, rejecting others', () => {
      expect(normalizeFieldValue({ name: 'active', value: true, type: 'boolean' })).toBe(true);
      expect(normalizeFieldValue({ name: 'active', value: false, type: 'boolean' })).toBe(false);
      expect(normalizeFieldValue({ name: 'active', value: 'true', type: 'boolean' })).toBe(true);
      expect(normalizeFieldValue({ name: 'active', value: 'false', type: 'boolean' })).toBe(false);
      expect(() =>
        normalizeFieldValue({ name: 'active', value: 'other', type: 'boolean' })
      ).toThrow('Field "active" must be a boolean');
      expect(() =>
        normalizeFieldValue({ name: 'active', value: 1, type: 'boolean' })
      ).toThrow('Field "active" must be a boolean');
    });

    it('handles "string" type converting non-string values into strings', () => {
      expect(normalizeFieldValue({ name: 'label', value: 'hello', type: 'string' })).toBe('hello');
      expect(normalizeFieldValue({ name: 'label', value: 123, type: 'string' })).toBe('123');
      expect(normalizeFieldValue({ name: 'label', value: { x: 1 }, type: 'string' })).toBe('{"x":1}');
      expect(normalizeFieldValue({ name: 'label', value: null, type: 'string' })).toBe('');
      expect(normalizeFieldValue({ name: 'label', value: undefined, type: 'string' })).toBe('');
    });

    it('supports valueOverride parameter when resolving expressions', () => {
      expect(
        normalizeFieldValue({ name: 'resolvedNum', value: 'ignored', type: 'number' }, 100)
      ).toBe(100);
      expect(
        normalizeFieldValue({ name: 'resolvedStr', value: 'ignored', type: 'string' }, 555)
      ).toBe('555');
    });
  });

  describe('composeFields', () => {
    it('composes an array of FieldConfig into a typed object', () => {
      const fields: FieldConfig[] = [
        { name: 'name', value: 'Alice', type: 'string' },
        { name: 'age', value: '28', type: 'number' },
        { name: 'isAdmin', value: 'true', type: 'boolean' },
        { name: 'meta', value: null, type: 'null' },
      ];
      expect(composeFields(fields)).toEqual({
        name: 'Alice',
        age: 28,
        isAdmin: true,
        meta: null,
      });
    });

    it('ignores invalid or empty field rows safely', () => {
      const fields = [
        { name: 'valid', value: 'yes', type: 'string' },
        null as any,
        undefined as any,
        { name: '', value: 'emptyName' } as any,
      ];
      expect(composeFields(fields)).toEqual({
        valid: 'yes',
        '': 'emptyName',
      });
    });
  });
});
