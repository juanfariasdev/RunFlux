import { createCodeGenerators } from '@runflux/plugin-system/generator-factory';
import type { PluginModule } from '@runflux/plugin-system/types';
import { CONDITION_ROW_SCHEMA } from '@runflux/plugin-system/condition-row-schema';
import { matchRule, type ConditionRule } from '@runflux/plugin-system/operators';
import { generateConditionIfCode } from '@runflux/plugin-system/generators';

/**
 * If (004-core-nodes-catalog, RF-01): routes execution to one of two named
 * outputs ("true"/"false") depending on whether its configured conditions
 * match the node's input. Modeled after n8n's If node.
 */
export const manifest: PluginModule['manifest'] = {
  id: 'condition-if',
  name: 'If',
  category: 'control-flow',
  version: '1.0.0',
  parameters: [
    { name: 'combinator', label: 'Combinator (and/or)', type: 'string', required: false, default: 'and' },
    { name: 'conditions', label: 'Conditions', type: 'json', required: true, default: [], rowSchema: CONDITION_ROW_SCHEMA },
  ],
  supportedPlatforms: ['local', 'aws'],
  outputs: ['true', 'false'],
};

export const generators = createCodeGenerators(manifest, generateConditionIfCode);

export const execute: PluginModule['execute'] = (params, input) => {
  const conditions = Array.isArray(params.conditions) ? (params.conditions as ConditionRule[]) : [];
  const combinator = (params.combinator as string | undefined) ?? 'and';
  const matched = matchRule(conditions, combinator);
  return { value: input, activeOutput: matched ? 'true' : 'false' };
};
