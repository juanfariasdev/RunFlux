import type { PluginModule } from '@runflux/plugin-system/types';
import { RULE_ROW_SCHEMA } from '@runflux/plugin-system/condition-row-schema';
import { evaluateSwitch, type SwitchRule } from '@runflux/plugin-system/operators';
import { generateConditionSwitchCode } from '@runflux/plugin-system/generators';

/**
 * Switch (004-core-nodes-catalog, RF-02): evaluates a list of rules in
 * order, routing to the first one that matches (or "fallback" if enabled and
 * none match).
 */
const RULE_OUTPUTS = ['output1', 'output2', 'output3', 'output4', 'output5'];

export const manifest: PluginModule['manifest'] = {
  id: 'condition-switch',
  name: 'Switch',
  category: 'control-flow',
  version: '1.0.0',
  parameters: [
    { name: 'rules', label: 'Rules (ordered, first match wins)', type: 'json', required: true, default: [], rowSchema: RULE_ROW_SCHEMA },
    { name: 'fallbackEnabled', label: 'Enable fallback output', type: 'boolean', required: false, default: false },
  ],
  supportedPlatforms: ['local', 'aws'],
  outputs: [...RULE_OUTPUTS, 'fallback'],
};

export const generators: PluginModule['generators'] = {
  aws: (nodeConfig, ctx) => generators.local(nodeConfig, ctx),
  local: (nodeConfig) => ({
    files: [
      {
        path: 'condition-switch.ts',
        content: generateConditionSwitchCode({ ...nodeConfig, ruleOutputs: RULE_OUTPUTS }),
      },
    ],
    infra: [],
  }),
};

export const execute: PluginModule['execute'] = (params, input) => {
  const rules = Array.isArray(params.rules) ? (params.rules as SwitchRule[]) : [];
  const fallbackEnabled = Boolean(params.fallbackEnabled);
  const activeOutput = evaluateSwitch(rules, RULE_OUTPUTS, fallbackEnabled);
  return { value: input, activeOutput };
};
