import type { PluginModule } from '@runflux/plugin-system/types';
import { DEFAULT_SCHEDULE, readCronSchedule, SCHEDULE_PRESETS } from './schedule.js';

/** Cron Trigger: starts the workflow on a five-field Unix cron schedule in a given timezone. */
export const manifest: PluginModule['manifest'] = {
  id: 'trigger-cron',
  name: 'Cron Trigger',
  category: 'trigger',
  version: '1.0.0',
  parameters: [
    {
      name: 'expression',
      label: 'Cron Expression',
      type: 'string',
      required: true,
      default: DEFAULT_SCHEDULE.expression,
      options: SCHEDULE_PRESETS,
      allowCustomOptions: true,
    },
    { name: 'timezone', label: 'Timezone', type: 'string', required: false, default: DEFAULT_SCHEDULE.timezone },
  ],
  supportedPlatforms: ['local', 'aws'],
  outputs: ['main'],
};

export const runtimeModule = new URL('./runtime.ts', import.meta.url);

export const deployment: PluginModule['deployment'] = {
  triggers: (parameters) => [{ kind: 'schedule', ...readCronSchedule(parameters) }],
};
