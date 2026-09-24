import { createCodeGenerators } from '@runflux/plugin-system/generator-factory';
import type { PluginModule } from '@runflux/plugin-system/types';
import { FIELDS_ROW_SCHEMA, composeFields, type FieldConfig } from '@runflux/plugin-system/fields-row-schema';
import { generateSetCode } from '@runflux/plugin-system/generators';

/**
 * Set (004-core-nodes-catalog, RF-11): composes an output object from
 * manually defined fields (literal or `{{ }}` expression values), optionally
 * keeping the rest of the input object. Modeled after n8n's "Edit Fields
 * (Set)" node (packages/nodes-base/nodes/Set/v2/SetV2.node.ts), manual-mapping
 * mode only — the JSON mode is out of scope for v1.
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

function compose(fields: FieldConfig[], includeOtherFields: boolean, input: unknown): Record<string, unknown> {
  const base: Record<string, unknown> =
    includeOtherFields && input !== null && typeof input === 'object' ? { ...(input as Record<string, unknown>) } : {};
  return { ...base, ...composeFields(fields) };
}

export const generators = createCodeGenerators(manifest, generateSetCode);

export const execute: PluginModule['execute'] = (params, input) => {
  const fields = Array.isArray(params.fields) ? (params.fields as FieldConfig[]) : [];
  const includeOtherFields = Boolean(params.includeOtherFields);
  return compose(fields, includeOtherFields, input);
};

