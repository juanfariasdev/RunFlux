import type { PluginModule } from '@runflux/plugin-system/types';

/**
 * Code Node (010-code-node-plugin): runs user-authored JavaScript receiving `$json`, `$node` and
 * `$env`. The source is a literal parameter, so `{{ }}` inside it is never interpolated.
 */
export const manifest: PluginModule['manifest'] = {
  id: 'code-javascript',
  name: 'Code',
  category: 'action',
  version: '1.0.0',
  parameters: [
    {
      name: 'code',
      label: 'JavaScript Code',
      type: 'string',
      required: true,
      expressions: false,
      language: 'javascript',
      default: `// JavaScript Code Node
// Available variables: $json (input payload), $node (earlier nodes), $env (environment variables)
return {
  ...$json,
  processedAt: new Date().toISOString()
};`,
    },
  ],
  supportedPlatforms: ['local', 'aws'],
};

export const runtimeModule = new URL('./runtime.ts', import.meta.url);
