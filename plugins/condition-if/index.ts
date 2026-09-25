import { COMBINATOR_OPTIONS, CONDITION_ROW_SCHEMA } from '@runflux/plugin-system/sdk';
import type { PluginModule } from '@runflux/plugin-system/sdk';

/**
 * If (004-core-nodes-catalog, RF-01): routes execution to one of two named outputs ("true" or
 * "false") depending on whether its conditions match the node's input. Modeled after n8n's If node.
 */
export const manifest: PluginModule['manifest'] = {
  id: 'condition-if',
  name: 'If',
  category: 'control-flow',
  version: '1.0.0',
  parameters: [
    { name: 'combinator', label: 'Combinator', type: 'string', required: false, default: 'and', options: COMBINATOR_OPTIONS },
    { name: 'conditions', label: 'Conditions', type: 'json', required: true, default: [], rowSchema: CONDITION_ROW_SCHEMA },
  ],
  supportedPlatforms: ['local', 'aws'],
  outputs: ['true', 'false'],
};

export const runtimeModule = new URL('./runtime.ts', import.meta.url);
