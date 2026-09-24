import type { PluginModule } from '@runflux/plugin-system/types';

/**
 * Log (004-core-nodes-catalog, RF-05): a deterministic, network-free output — passes the input
 * through unchanged, giving a workflow an observable end point without depending on an external
 * HTTP endpoint being available.
 */
export const manifest: PluginModule['manifest'] = {
  id: 'log-output',
  name: 'Log',
  category: 'output',
  version: '1.0.0',
  parameters: [{ name: 'label', label: 'Label', type: 'string', required: false, default: 'Log' }],
  supportedPlatforms: ['local', 'aws'],
};

export const runtimeModule = new URL('./runtime.ts', import.meta.url);
