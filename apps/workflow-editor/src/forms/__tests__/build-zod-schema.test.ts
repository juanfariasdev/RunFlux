import { describe, expect, it } from 'vitest';
import { buildZodSchema } from '../build-zod-schema';
import type { ParameterSchema } from '@runflux/plugin-system/types';

function param(overrides: Partial<ParameterSchema>): ParameterSchema {
  return { name: 'field', label: 'Field', type: 'string', required: true, ...overrides };
}

describe('buildZodSchema — required fields (RN-04)', () => {
  it('rejects a missing required string field', () => {
    const schema = buildZodSchema([param({ type: 'string', required: true })]);
    expect(schema.safeParse({}).success).toBe(false);
  });

  it('rejects an empty required string field', () => {
    const schema = buildZodSchema([param({ type: 'string', required: true })]);
    expect(schema.safeParse({ field: '' }).success).toBe(false);
  });

  it('accepts a filled required string field', () => {
    const schema = buildZodSchema([param({ type: 'string', required: true })]);
    expect(schema.safeParse({ field: 'value' }).success).toBe(true);
  });

  it('rejects a missing required number/boolean field', () => {
    expect(buildZodSchema([param({ type: 'number', required: true })]).safeParse({}).success).toBe(
      false,
    );
    expect(
      buildZodSchema([param({ type: 'boolean', required: true })]).safeParse({}).success,
    ).toBe(false);
  });
});

describe('buildZodSchema — optional fields', () => {
  it('accepts a missing optional field of every type', () => {
    for (const type of ['string', 'number', 'boolean', 'json'] as const) {
      const schema = buildZodSchema([param({ type, required: false })]);
      expect(schema.safeParse({}).success, `type "${type}" should be optional-valid`).toBe(true);
    }
  });
});

describe('buildZodSchema — sensitive fields', () => {
  it('validates a sensitive field the same as a non-sensitive one of the same type', () => {
    const sensitive = buildZodSchema([param({ type: 'string', required: true, sensitive: true })]);
    const plain = buildZodSchema([param({ type: 'string', required: true, sensitive: false })]);
    expect(sensitive.safeParse({ field: '' }).success).toBe(false);
    expect(plain.safeParse({ field: '' }).success).toBe(false);
    expect(sensitive.safeParse({ field: 'secret' }).success).toBe(true);
    expect(plain.safeParse({ field: 'secret' }).success).toBe(true);
  });
});

describe('buildZodSchema — json type', () => {
  it('accepts any value for a json-typed field, required or not', () => {
    const schema = buildZodSchema([param({ type: 'json', required: true })]);
    expect(schema.safeParse({ field: { nested: true } }).success).toBe(true);
    expect(schema.safeParse({ field: [1, 2, 3] }).success).toBe(true);
  });
});

describe('buildZodSchema — multiple parameters', () => {
  it('validates all fields of a multi-parameter manifest together', () => {
    const schema = buildZodSchema([
      param({ name: 'url', type: 'string', required: true }),
      param({ name: 'timeout', type: 'number', required: false }),
      param({ name: 'apiKey', type: 'string', required: true, sensitive: true }),
    ]);

    expect(schema.safeParse({ url: 'https://x', apiKey: 'k' }).success).toBe(true);
    expect(schema.safeParse({ url: '', apiKey: 'k' }).success).toBe(false);
    expect(schema.safeParse({ url: 'https://x' }).success).toBe(false); // missing apiKey
  });
});
