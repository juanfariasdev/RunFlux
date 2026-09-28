import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import { HttpCompilerApiAdapter } from '../compiler-api-adapter';

const workflow: WorkflowDefinition = { id: 'wf', name: 'Orders', nodes: [], connections: [] };

describe('HttpCompilerApiAdapter', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('posts the workflow, target and project name, and returns the compilation', async () => {
    const compiled = { status: 'success', compilationId: 'Orders-local-1-abcdef12', zipFilename: 'Orders-local.zip', downloadUrl: '/x' };
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => compiled } as Response);
    await expect(new HttpCompilerApiAdapter('http://server').compile({ workflow, targetPlatform: 'aws', projectName: 'Orders', options: { includeCli: false } })).resolves.toEqual(compiled);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('http://server/api/compiler/compile');
    expect(JSON.parse(init!.body as string)).toEqual({ workflow, targetPlatform: 'aws', projectName: 'Orders', options: { includeCli: false } });
  });

  it('calls the project server through the editor\'s own origin by default (feature 015, D-04)', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    await new HttpCompilerApiAdapter().compile({ workflow, targetPlatform: 'local' });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/compiler/compile');
  });

  it('uses the fetch function it is given', async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    await new HttpCompilerApiAdapter('', send).compile({ workflow, targetPlatform: 'local' });
    expect(send).toHaveBeenCalledWith('/api/compiler/compile', expect.objectContaining({ method: 'POST' }));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('throws the server message with its code and details', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { code: 'INCOMPATIBLE_NODES', message: 'Incompatible', details: [{ nodeId: 'n' }] } }) } as Response);
    await expect(new HttpCompilerApiAdapter().compile({ workflow, targetPlatform: 'aws' })).rejects.toMatchObject({ message: 'Incompatible', code: 'INCOMPATIBLE_NODES', details: [{ nodeId: 'n' }] });
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('not json'); } } as unknown as Response);
    await expect(new HttpCompilerApiAdapter().compile({ workflow, targetPlatform: 'aws' })).rejects.toThrow('Compilation error: HTTP 502');
  });

  it('builds download links for one compilation or the latest one with that file', () => {
    const adapter = new HttpCompilerApiAdapter('http://server');
    expect(adapter.getDownloadUrl('My backend-local.zip', 'My_backend-local-1-abcdef12')).toBe('http://server/api/compiler/downloads/My_backend-local-1-abcdef12/My%20backend-local.zip');
    expect(adapter.getDownloadUrl('My backend-local.zip')).toBe('http://server/api/compiler/downloads/My%20backend-local.zip');
  });

  it('downloads through fetch, so the token travels in a header, and saves the archive through an object URL (D-15)', async () => {
    const archive = new Blob(['zip']);
    const send = vi.fn().mockResolvedValue({ ok: true, status: 200, blob: async () => archive } as Response);
    const createObjectURL = vi.fn(() => 'blob:archive');
    const revokeObjectURL = vi.fn();
    // jsdom has no object URLs; the adapter only needs these two functions.
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await new HttpCompilerApiAdapter('', send).download('Orders-local.zip', 'Orders-local-1');

    expect(send).toHaveBeenCalledWith('/api/compiler/downloads/Orders-local-1/Orders-local.zip');
    expect(createObjectURL).toHaveBeenCalledWith(archive);
    const link = click.mock.contexts[0] as HTMLAnchorElement;
    expect([link.href, link.download]).toEqual(['blob:archive', 'Orders-local.zip']);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:archive');
    click.mockRestore();
  });

  it('throws when the download is refused', async () => {
    const send = vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => ({ error: { message: 'Arquivo não encontrado' } }) } as Response);
    await expect(new HttpCompilerApiAdapter('', send).download('missing.zip')).rejects.toThrow('Arquivo não encontrado');
  });
});
