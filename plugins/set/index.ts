import { FIELDS_ROW_SCHEMA } from '@runflux/plugin-system/fields-row-schema';
import type { PluginModule } from '@runflux/plugin-system/types';

/**
 * Set (004-core-nodes-catalog, RF-11): composes an output object from manually defined fields
 * (literal or `{{ }}` expression values), optionally keeping the rest of the input object.
 * Modeled after n8n's "Edit Fields (Set)" node, manual-mapping mode only.
 */
export const manifest: PluginModule['manifest'] = {
  id: 'set',
  name: 'Edit Fields (Set)',
  category: 'action',
  version: '1.0.0',
  parameters: [
    { name: 'fields', label: 'Fields', type: 'json', required: true, default: [], rowSchema: FIELDS_ROW_SCHEMA },
    { name: 'includeOtherFields', label: 'Include other input fields', type: 'boolean', required: false, default: false },
  ],
  supportedPlatforms: ['local', 'aws'],
};

export const runtimeModule = new URL('./runtime.ts', import.meta.url);
