import type { ParameterReader } from '../parameters/parameter-reader.js';
import { isRecord } from '../values.js';

export const FIELD_TYPES = ['string', 'number', 'boolean', 'null', 'array', 'object'] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** One named, optionally typed value of an object being composed. */
export interface FieldDefinition {
  readonly name: string;
  readonly value: unknown;
  readonly type?: FieldType;
}

export class FieldTypeError extends Error {
  constructor(field: string, expected: string) {
    super(`Field "${field}" must be ${expected}`);
    this.name = 'FieldTypeError';
  }
}

type FieldNormalizer = (value: unknown, field: string) => unknown;

const NORMALIZERS: Readonly<Record<FieldType, FieldNormalizer>> = {
  string: (value) => {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  },
  number: (value, field) => {
    const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
    if (!Number.isFinite(number)) throw new FieldTypeError(field, 'a number');
    return number;
  },
  boolean: (value, field) => {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === 'false') return value === 'true';
    throw new FieldTypeError(field, 'a boolean');
  },
  null: () => null,
  array: (value, field) => {
    if (!Array.isArray(value)) throw new FieldTypeError(field, 'an array');
    return value;
  },
  object: (value, field) => {
    if (!isRecord(value)) throw new FieldTypeError(field, 'an object');
    return value;
  },
};

/** Builds an object from field definitions, converting each value to its declared type. */
export class FieldComposer {
  /** Converts the value to the field's type; untyped fields and unknown types keep the value as is. */
  normalize(field: FieldDefinition): unknown {
    const type: string | undefined = field.type;
    return type && Object.hasOwn(NORMALIZERS, type) ? NORMALIZERS[type as FieldType](field.value, field.name) : field.value;
  }

  /** Composes `fields` over a copy of `base`; later fields replace earlier ones and base keys. */
  compose(fields: readonly FieldDefinition[], base: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
    const result: Record<string, unknown> = { ...base };
    for (const field of fields) result[field.name] = this.normalize(field);
    return result;
  }
}

/** Reads a list of field rows (`name`, `value`, `type`). Rows without a name are skipped. */
export function readFields(parameters: ParameterReader, name: string): FieldDefinition[] {
  return parameters.list(name).flatMap((row, index): FieldDefinition[] => {
    if (!isRecord(row)) throw parameters.error(name, `row ${index + 1} must be an object`);
    const field = row;
    if (typeof field.name !== 'string') return [];
    const type = field.type ?? undefined;
    if (type !== undefined && !FIELD_TYPES.includes(type as FieldType)) {
      throw parameters.error(name, `row ${index + 1} has unknown type "${String(type)}"`);
    }
    return [{ name: field.name, value: field.value, type: type as FieldType | undefined }];
  });
}
