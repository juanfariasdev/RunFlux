import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowDefinition } from '@runflux/workflow-model';
import { HttpCompilerApiAdapter } from '../compiler-api-adapter';

const workflow: WorkflowDefinition = { id: 'wf', name: 'Orders', nodes: [], connections: [] };

describe('HttpCompilerApiAdapter', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('posts the workflow, target and project name, and returns the compilation', async () => {
    const compiled = { status: 'success', compilationId: 'Orders-local-1-abcdef12', zipFilename: 'Orders-local.zip', downloadUrl: '/x' };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => compiled } as Response);
    await expect(new HttpCompilerApiAdapter('http://server').compile({ workflow, targetPlatform: 'aws', projectName: 'Orders', options: { includeCli: false } })).resolves.toEqual(compiled);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('http://server/api/compiler/compile');
    expect(JSON.parse(init!.body as string)).toEqual({ workflow, targetPlatform: 'aws', projectName: 'Orders', options: { includeCli: false } });
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
});
