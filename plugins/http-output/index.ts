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

async function callHttp(
  method: string,
  url: unknown,
  headers: unknown,
  body: unknown,
  fetchImpl: typeof fetch,
): Promise<{ status: number; headers: Record<string, string>; body: unknown }> {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new Error('http-output: "url" is empty or invalid');
  }
  const upperMethod = method.toUpperCase();
  const requestHeaders: Record<string, string> = { ...(headers as Record<string, string> | undefined) };
  const init: RequestInit = { method: upperMethod, headers: requestHeaders };
  if (upperMethod !== 'GET' && upperMethod !== 'HEAD' && body !== undefined) {
    requestHeaders['Content-Type'] ??= 'application/json';
    init.body = JSON.stringify(body);
  }

  const response = await fetchImpl(url, init);
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });
  const contentType = response.headers.get('content-type') ?? '';
  const rawBody = await response.text();
  let parsedBody: unknown = rawBody;
  if (contentType.includes('application/json')) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = rawBody;
    }
  }

  if (!response.ok) {
    throw new Error(`http-output: request to ${url} failed with status ${response.status}: ${rawBody.slice(0, 200)}`);
  }

  return { status: response.status, headers: responseHeaders, body: parsedBody };
}

export const generators: PluginModule['generators'] = {
  aws: (nodeConfig, ctx) => generators.local(nodeConfig, ctx),
  local: (nodeConfig) => ({
    files: [
      {
        path: 'http-output.ts',
        content: generateHttpOutputCode(nodeConfig),
      },
    ],
    infra: [],
  }),
};

export const execute: PluginModule['execute'] = async (params) => {
  const method = (params.method as string | undefined) ?? 'GET';
  return callHttp(method, params.url, params.headers, params.body, fetch);
};

