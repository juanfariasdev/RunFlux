import type { PluginModule } from '../../../../../types';

export const manifest: PluginModule['manifest'] = {
  id: 'fixture-invalid-runtime',
  name: 'Fixture Invalid Runtime',
  category: 'action',
  version: '1.0.0',
  parameters: [],
  supportedPlatforms: ['local'],
};

// The runtime module exists but its default export is not a node definition.
export const runtimeModule = new URL('./runtime.ts', import.meta.url);
