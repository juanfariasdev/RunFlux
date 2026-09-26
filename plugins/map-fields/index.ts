import { FIELDS_ROW_SCHEMA } from '@runflux/plugin-system/sdk';
import type { PluginModule } from '@runflux/plugin-system/sdk';
import { ELEMENT_ERROR_OPTIONS, MODE_OPTIONS } from './parameters.js';

/**
 * Map Fields (014-map-fields-per-element): maps each element of a list input, evaluating its
 * expressions once per element with `$json` bound to that element. Fields mode builds one object
 * per element, as the Set node does for a whole input; value mode yields one value per element.
 * An input that is not a list is mapped as one element and keeps its shape.
 */
export const manifest: PluginModule['manifest'] = {
  id: 'map-fields',
  name: 'Map Fields',
  category: 'action',
  version: '1.0.0',
  parameters: [
    { name: 'mode', label: 'Mode', type: 'string', required: false, default: 'fields', options: MODE_OPTIONS },
    { name: 'fields', label: 'Fields', type: 'json', required: false, default: [], rowSchema: FIELDS_ROW_SCHEMA, expressions: 'perElement', showWhen: { parameter: 'mode', oneOf: ['fields'] } },
    { name: 'includeOtherFields', label: 'Include other element fields', type: 'boolean', required: false, default: false, showWhen: { parameter: 'mode', oneOf: ['fields'] } },
    { name: 'value', label: 'Value', type: 'string', required: false, default: '', expressions: 'perElement', showWhen: { parameter: 'mode', oneOf: ['value'] } },
    { name: 'onElementError', label: 'On element error', type: 'string', required: false, default: 'fail', options: ELEMENT_ERROR_OPTIONS },
  ],
  supportedPlatforms: ['local', 'aws'],
};

export const runtimeModule = new URL('./runtime.ts', import.meta.url);
