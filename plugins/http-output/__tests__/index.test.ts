import { validateManifest } from '@runflux/plugin-system/manifest-validator';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execute, manifest } from '../index';

describe('http-output plugin (004-core-nodes-catalog, RF-04)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exports a manifest that satisfies the PluginManifest contract (category output)', () => {
    const result = validateManifest(manifest);
    expect(result.success).toBe(true);
    expect(manifest.category).toBe('output');
  });

  it('returns status/headers/body, parsing a JSON response body', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const result = (await execute!(
      { method: 'GET', url: 'https://example.com/items', headers: {}, body: {} },
      undefined,
      { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' },
    )) as { status: number; headers: Record<string, string>; body: unknown };

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('https://example.com/items', expect.objectContaining({ method: 'GET' }));
  });

  it('keeps the response body as raw text when the content type is not JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('plain text', { status: 200, headers: { 'content-type': 'text/plain' } }));

    const result = (await execute!({ method: 'GET', url: 'https://example.com', headers: {}, body: {} }, undefined, {
      workflowId: 'wf-1',
      nodeId: 'n1',
      mode: 'sandbox',
    })) as { body: unknown };

    expect(result.body).toBe('plain text');
  });

  it('sends method/headers/body for a non-GET request', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } }));

    await execute!(
      { method: 'POST', url: 'https://example.com/items', headers: { Authorization: 'Bearer token' }, body: { name: 'x' } },
      undefined,
      { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' },
    );

    expect(fetch).toHaveBeenCalledWith(
      'https://example.com/items',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
        body: JSON.stringify({ name: 'x' }),
      }),
    );
  });

  it('throws (converted to a node error by the engine) on a non-2xx response, including status and a body excerpt', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('server exploded', { status: 500 }));

    await expect(
      execute!({ method: 'GET', url: 'https://example.com', headers: {}, body: {} }, undefined, {
        workflowId: 'wf-1',
        nodeId: 'n1',
        mode: 'sandbox',
      }),
    ).rejects.toThrow(/500/);
  });

  it('throws on a network failure', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));

    await expect(
      execute!({ method: 'GET', url: 'https://does-not-exist.invalid', headers: {}, body: {} }, undefined, {
        workflowId: 'wf-1',
        nodeId: 'n1',
        mode: 'sandbox',
      }),
    ).rejects.toThrow(/ENOTFOUND/);
  });

  it('throws before calling fetch when the url is empty', async () => {
    await expect(
      execute!({ method: 'GET', url: '', headers: {}, body: {} }, undefined, { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' }),
    ).rejects.toThrow(/url/i);
    expect(fetch).not.toHaveBeenCalled();
  });
});
