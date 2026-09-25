import { validateManifest } from '@runflux/plugin-system/sdk';
import { FetchHttpClient, type HttpClient, type HttpTransport } from '@runflux/runtime';
import { executeNode } from '@runflux/runtime/testing';
import { describe, expect, it } from 'vitest';
import { manifest } from '../index';
import http from '../runtime';

function client(respond: () => Response = () => Response.json({ accepted: true }, { status: 201 })) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const transport: HttpTransport = async (url, init) => {
    requests.push({ url, init });
    return respond();
  };
  return { requests, services: { http: new FetchHttpClient(transport) } };
}

const run = (parameters: Record<string, unknown>, services: { http: HttpClient }, input: unknown = {}) =>
  executeNode(http, { parameters, services, input, pluginId: 'http-output' });

describe('http-output', () => {
  it('declares a valid output manifest', () => {
    expect(validateManifest(manifest).success).toBe(true);
  });

  it('sends the resolved request and outputs the response', async () => {
    const { requests, services } = client();
    const record = await run({
      method: 'post',
      url: 'https://example.test/orders/{{ $json.id }}',
      headers: { Authorization: 'Bearer {{ $json.token }}' },
      body: { total: '{{ $json.total }}' },
    }, services, { id: 7, token: 't', total: 42 });
    expect(record.output).toEqual({ status: 201, headers: { 'content-type': 'application/json' }, body: { accepted: true } });
    expect(requests).toEqual([{ url: 'https://example.test/orders/7', init: {
      method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: '{"total":42}',
    } }]);
  });

  it('keeps an explicit content type and sends no body when none is configured', async () => {
    const { requests, services } = client();
    await run({ method: 'POST', url: 'https://example.test', headers: { 'content-type': 'application/custom+json' } }, services);
    expect(requests[0].init).toEqual({ method: 'POST', headers: { 'content-type': 'application/custom+json' } });
  });

  it('defaults to GET without a body', async () => {
    const { requests, services } = client();
    await run({ url: 'https://example.test', body: { ignored: true } }, services);
    expect(requests[0].init).toEqual({ method: 'GET', headers: {} });
  });

  it('reports unsuccessful responses and transport failures', async () => {
    const failing = client(() => new Response('unavailable', { status: 503 }));
    expect((await run({ url: 'https://example.test/down' }, failing.services)).error).toBe('http-output: request to https://example.test/down failed with status 503: unavailable');
    const offline = { http: new FetchHttpClient(async () => { throw new TypeError('fetch failed'); }) };
    expect((await run({ url: 'https://example.test' }, offline)).error).toBe('http-output: fetch failed');
  });

  it.each([
    [{}, 'http-output: parameter "url" is required'],
    [{ url: '  ' }, 'http-output: parameter "url" is required'],
    [{ url: 'https://x.test', method: 'FETCH' }, 'http-output: parameter "method" "FETCH" is not an HTTP method'],
    [{ url: 'https://x.test', headers: { 'X-Count': 1 } }, 'http-output: parameter "headers" header "X-Count" must be text'],
    [{ url: 'https://x.test', headers: ['a'] }, 'http-output: parameter "headers" must be an object'],
  ])('reports invalid configuration %j without sending anything', async (parameters, message) => {
    const { requests, services } = client();
    expect((await run(parameters, services)).error).toBe(message);
    expect(requests).toEqual([]);
  });
});
