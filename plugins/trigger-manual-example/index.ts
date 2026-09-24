import type { PluginModule } from '@runflux/plugin-system/types';

/**
 * Minimal example trigger, used as the fixture for onboarding.md's manual walkthrough: the
 * developer fires it on demand from the editor, or with `npm run run` in an exported backend.
 */
export const manifest: PluginModule['manifest'] = {
  id: 'trigger-manual-example',
  name: 'Manual Trigger (Example)',
  category: 'trigger',
  version: '1.0.0',
  parameters: [{ name: 'label', label: 'Label', type: 'string', required: false, default: 'Manual run' }],
  supportedPlatforms: ['local'],
};

export const runtimeModule = new URL('./runtime.ts', import.meta.url);
