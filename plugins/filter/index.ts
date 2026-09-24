import { CONDITION_ROW_SCHEMA } from '@runflux/plugin-system/condition-row-schema';
import type { PluginModule } from '@runflux/plugin-system/types';

/**
 * Filter (004-core-nodes-catalog, RF-03): propagates the input unchanged through its single output
 * when its conditions match; otherwise activates no output, silently halting the branch (RN-02).
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

export const runtimeModule = new URL('./runtime.ts', import.meta.url);
