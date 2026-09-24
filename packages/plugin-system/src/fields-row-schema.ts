import type { JsonRowFieldSchema } from './types.js';

/**
 * Shared by every plugin whose json parameter is a list of named, typed
 * fields — `set`'s `fields` and `trigger-webhook`'s `sampleBody` both compose
 * the same way: each row pairs a name with a JSON-typed value (`type` stores
 * the picker's choice, round-tripped as an ordinary key on the row).
 */
export const FIELDS_ROW_SCHEMA: JsonRowFieldSchema[] = [
  { key: 'name', label: 'Name', kind: 'text', initialValue: '' },
  { key: 'value', label: 'Value', kind: 'typedValue', typeKey: 'type', initialValue: '' },
  { key: 'type', label: 'Type', kind: 'text', initialValue: 'string' },
];

export interface FieldConfig {
  name: string;
  value: unknown;
  type?: 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object';
}

/** Coerces one field's `value` to match its declared `type`, throwing on a genuine mismatch. */
export function normalizeFieldValue(field: FieldConfig, valueOverride?: unknown): unknown {
  const value = valueOverride !== undefined ? valueOverride : field.value;
  const type = field.type;
  if (type === 'null') return null;
  if (type === 'array') {
    if (Array.isArray(value)) return value;
    throw new Error(`Field "${field.name}" must be an array`);
  }
  if (type === 'object') {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value;
    throw new Error(`Field "${field.name}" must be an object`);
  }
  if (type === 'number') {
    const numberValue = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
    if (Number.isFinite(numberValue)) return numberValue;
    throw new Error(`Field "${field.name}" must be a number`);
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    throw new Error(`Field "${field.name}" must be a boolean`);
  }
  if (type === 'string' && typeof value !== 'string') {
    if (value === null || value === undefined) return '';
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }
  return value;
}

/** Composes a `FIELDS_ROW_SCHEMA`-shaped array into the flat object it describes. */
export function composeFields(fields: FieldConfig[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (field && typeof field.name === 'string') {
      result[field.name] = normalizeFieldValue(field);
    }
  }
  return result;
}
