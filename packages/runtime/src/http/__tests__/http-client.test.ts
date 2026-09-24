import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpClient, HttpRequestError, type HttpTransport } from '../http-client.js';

function recordingTransport(response: () => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const transport: HttpTransport = async (url, init) => {
    calls.push({ url, init });
    return response();
  };
  return { calls, client: new HttpClient(transport) };
}

const json = (value: unknown, status = 200) => () => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('HttpClient', () => {
  it('sends a JSON body with a default content type and parses a JSON response', async () => {
    const { calls, client } = recordingTransport(json({ accepted: true }, 201));
    const response = await client.send({ method: 'post', url: 'https://example.test/events', body: { id: 1 } });
    expect(response).toEqual({ status: 201, headers: { 'content-type': 'application/json' }, body: { accepted: true } });
    expect(calls[0]).toEqual({ url: 'https://example.test/events', init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"id":1}' } });
  });

  it('keeps an explicit content type, in any letter case', async () => {
    const { calls, client } = recordingTransport(json({}));
    await client.send({ method: 'PUT', url: 'https://example.test', headers: { 'content-type': 'application/custom+json' }, body: {} });
    expect(calls[0].init.headers).toEqual({ 'content-type': 'application/custom+json' });
  });

  it.each(['GET', 'HEAD', 'get'])('sends no body with %s', async (method) => {
    const { calls, client } = recordingTransport(json({}));
    await client.send({ method, url: 'https://example.test', body: { ignored: true } });
    expect(calls[0].init.body).toBeUndefined();
  });

  it('sends no body when none was given', async () => {
    const { calls, client } = recordingTransport(json({}));
    await client.send({ method: 'POST', url: 'https://example.test' });
    expect(calls[0].init).toEqual({ method: 'POST', headers: {} });
  });

  it('returns text for other content types and for invalid JSON', async () => {
    expect((await recordingTransport(() => new Response('plain', { headers: { 'content-type': 'text/plain' } })).client.send({ method: 'GET', url: 'https://x.test' })).body).toBe('plain');
    expect((await recordingTransport(() => new Response('{broken', { headers: { 'content-type': 'application/json' } })).client.send({ method: 'GET', url: 'https://x.test' })).body).toBe('{broken');
  });

  it('rejects unsuccessful responses with their status and a preview of the body', async () => {
    const { client } = recordingTransport(() => new Response('x'.repeat(300), { status: 503 }));
    const failure = client.send({ method: 'GET', url: 'https://example.test/down' });
    await expect(failure).rejects.toBeInstanceOf(HttpRequestError);
    await expect(client.send({ method: 'GET', url: 'https://example.test/down' })).rejects.toThrow(`request to https://example.test/down failed with status 503: ${'x'.repeat(200)}`);
  });

  it('uses the global fetch at call time by default', async () => {
    const fetch = vi.fn(async () => json({ ok: true })());
    const client = new HttpClient();
    vi.stubGlobal('fetch', fetch);
    expect((await client.send({ method: 'GET', url: 'https://example.test' })).body).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
