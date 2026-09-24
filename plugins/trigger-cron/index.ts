import type { PluginModule } from '@runflux/plugin-system/types';
import { readCronParameters } from './runtime.js';

/** Cron Trigger: starts the workflow on a five-field Unix cron schedule in a given timezone. */
export const manifest: PluginModule['manifest'] = {
  id: 'trigger-cron',
  name: 'Cron Trigger',
  category: 'trigger',
  version: '1.0.0',
  parameters: [
    { name: 'preset', label: 'Schedule Preset', type: 'string', required: false, default: 'every15Minutes' },
    { name: 'expression', label: 'Cron Expression', type: 'string', required: true, default: '*/15 * * * *' },
    { name: 'timezone', label: 'Timezone', type: 'string', required: false, default: 'UTC' },
  ],
  supportedPlatforms: ['local', 'aws'],
  outputs: ['main'],
};

export const runtimeModule = new URL('./runtime.ts', import.meta.url);

export const deployment: PluginModule['deployment'] = {
  triggers: (parameters) => [{ kind: 'schedule', ...readCronParameters(parameters) }],
};
