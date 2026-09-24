import type { PluginModule } from '@runflux/plugin-system/types';
import { extractContext } from '@runflux/plugin-system/context-helpers';
import { generateCodeJavascriptCode } from '@runflux/plugin-system/generators';

/**
 * Code Node (010-code-node-plugin): executes arbitrary user-authored
 * JavaScript / TypeScript functions receiving ($json, $node, $env).
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

export const generators: PluginModule['generators'] = {
  aws: (nodeConfig, ctx) => generators.local(nodeConfig, ctx),
  local: (nodeConfig) => ({
    files: [
      {
        path: 'code-javascript.ts',
        content: generateCodeJavascriptCode(nodeConfig),
      },
    ],
    infra: [],
  }),
};

export const execute: PluginModule['execute'] = async (params, input, context) => {
  const rawCode = (params.code as string | undefined)?.trim() || 'return $json;';
  try {
    const { $node, $env } = extractContext(context);
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('$json', '$node', '$env', rawCode);
    return await fn(input, $node, $env);
  } catch (err: any) {
    throw new Error(`[code-javascript]: Execution error: ${err.message || String(err)}`);
  }
};
