import { RULE_ROW_SCHEMA } from '@runflux/plugin-system/sdk';
import type { PluginModule } from '@runflux/plugin-system/sdk';
import { FALLBACK_OUTPUT, RULE_OUTPUTS } from './outputs.js';

/**
 * Switch (004-core-nodes-catalog, RF-02): evaluates its rules in order, routing to the first one
 * that matches, or to "fallback" when enabled and none matches.
 */
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
  outputs: [...RULE_OUTPUTS, FALLBACK_OUTPUT],
};

export const runtimeModule = new URL('./runtime.ts', import.meta.url);
