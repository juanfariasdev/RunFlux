import { createCodeGenerators } from '@runflux/plugin-system/generator-factory';
import { callHttp } from '@runflux/plugin-system/http-client';
import type { PluginModule } from '@runflux/plugin-system/types';
import { generateHttpOutputCode } from '@runflux/plugin-system/generators';

/**
 * HTTP Request (Output) (004-core-nodes-catalog, RF-04): fires a real HTTP
 * request via native `fetch`, no destination allowlist (RNF Segurança,
 * `requirements.md#6`, user-confirmed). See `interfaces/http-output.md` for
 * the full request/response/error contract.
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

export const generators = createCodeGenerators(manifest, generateHttpOutputCode);

export const execute: PluginModule['execute'] = async (params) => {
  const method = (params.method as string | undefined) ?? 'GET';
  return callHttp(method, params.url, params.headers, params.body, fetch);
};

