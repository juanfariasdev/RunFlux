import type { JsonRowFieldSchema } from './types.js';

/**
 * Editor row shape shared by every json parameter that lists named, typed fields: `set`'s
 * `fields` and `trigger-webhook`'s `sampleBody`. The runtime composes them with FieldComposer.
 */
export const FIELDS_ROW_SCHEMA: JsonRowFieldSchema[] = [
  { key: 'name', label: 'Name', kind: 'text', initialValue: '' },
  { key: 'value', label: 'Value', kind: 'typedValue', typeKey: 'type', initialValue: '' },
  { key: 'type', label: 'Type', kind: 'text', initialValue: 'string' },
];
