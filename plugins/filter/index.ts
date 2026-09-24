import type { PluginModule } from '@runflux/plugin-system/types';
import { CONDITION_ROW_SCHEMA } from '@runflux/plugin-system/condition-row-schema';
import { matchRule, type ConditionRule } from '@runflux/plugin-system/operators';
import { generateFilterCode } from '@runflux/plugin-system/generators';

/**
 * Filter (004-core-nodes-catalog, RF-03): propagates the input unchanged
 * through its single output when its condition matches; otherwise activates
 * no output, silently halting the branch (RN-02) — same as n8n's Filter node.
 */
export const manifest: PluginModule['manifest'] = {
  id: 'filter',
  name: 'Filter',
  category: 'control-flow',
  version: '1.0.0',
  parameters: [
    { name: 'combinator', label: 'Combinator (and/or)', type: 'string', required: false, default: 'and' },
    { name: 'conditions', label: 'Conditions', type: 'json', required: true, default: [], rowSchema: CONDITION_ROW_SCHEMA },
  ],
  supportedPlatforms: ['local', 'aws'],
  outputs: ['main'],
};

export const generators: PluginModule['generators'] = {
  aws: (nodeConfig, ctx) => generators.local(nodeConfig, ctx),
  local: (nodeConfig) => ({
    files: [
      {
        path: 'filter.ts',
        content: generateFilterCode(nodeConfig),
      },
    ],
    infra: [],
  }),
};

export const execute: PluginModule['execute'] = (params, input) => {
  const conditions = Array.isArray(params.conditions) ? (params.conditions as ConditionRule[]) : [];
  const combinator = (params.combinator as string | undefined) ?? 'and';
  const matched = matchRule(conditions, combinator);
  return { value: input, activeOutput: matched ? 'main' : null };
};

