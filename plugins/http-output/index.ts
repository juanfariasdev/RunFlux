import type { PluginModule } from '@runflux/plugin-system/types';

/**
 * HTTP Request (004-core-nodes-catalog, RF-04): sends a real HTTP request, with no destination
 * allowlist (RNF Segurança, user-confirmed). A JSON body is sent unless the method is GET or HEAD.
 */
export const manifest: PluginModule['manifest'] = {
  id: 'http-output',
  name: 'HTTP Request',
  category: 'output',
  version: '1.0.0',
  parameters: [
    { name: 'method', label: 'Method', type: 'string', required: true, default: 'GET' },
    { name: 'url', label: 'URL', type: 'string', required: true },
    { name: 'headers', label: 'Headers', type: 'json', required: false, default: {} },
    { name: 'body', label: 'Body', type: 'json', required: false, default: {} },
  ],
  supportedPlatforms: ['local', 'aws'],
};

export const runtimeModule = new URL('./runtime.ts', import.meta.url);
