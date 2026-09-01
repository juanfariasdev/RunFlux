import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpValidationRuntimeAdapter, NoopValidationRuntimeAdapter } from '../validation-runtime-adapter';
import type { WorkflowDefinition } from '@runflux/workflow-model/types';

const workflow: WorkflowDefinition = { id: 'wf-1', name: 'Test workflow', nodes: [], connections: [] };

describe('NoopValidationRuntimeAdapter', () => {
  it('run() always resolves with status "success" and an empty nodeResults', async () => {
    const adapter = new NoopValidationRuntimeAdapter();
    const result = await adapter.run(workflow, { mode: 'sandbox' });
    expect(result).toEqual({ status: 'success', message: 'validation-runtime not yet implemented (no-op)', nodeResults: [] });
  });

  it('runNode() always resolves with a result carrying no error', async () => {
    const adapter = new NoopValidationRuntimeAdapter();
    const result = await adapter.runNode(workflow, 'n1', { mode: 'sandbox' });
    expect(result.nodeId).toBe('n1');
    expect(result.error).toBeNull();
  });
});

describe('HttpValidationRuntimeAdapter (browser-safe — posts to vite-plugin-validation-runtime.ts\'s dev-only endpoint)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('run() posts the workflow and mode to the default URL and returns the parsed result', async () => {
    const runResult = { status: 'success', nodeResults: [] };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => runResult } as Response);

    const adapter = new HttpValidationRuntimeAdapter();
    const result = await adapter.run(workflow, { mode: 'sandbox' });

    expect(fetch).toHaveBeenCalledWith(
      '/runflux-validate',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ workflow, mode: 'sandbox' }) }),
    );
    expect(result).toEqual(runResult);
  });

  it('runNode() posts the workflow, nodeId and mode, and returns the parsed NodeResult', async () => {
    const nodeResult = { nodeId: 'n1', input: null, output: 'ok', error: null, startedAt: 't0', finishedAt: 't1' };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => nodeResult } as Response);

    const adapter = new HttpValidationRuntimeAdapter();
    const result = await adapter.runNode(workflow, 'n1', { mode: 'production' });

    expect(fetch).toHaveBeenCalledWith(
      '/runflux-validate',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ workflow, nodeId: 'n1', mode: 'production' }) }),
    );
    expect(result).toEqual(nodeResult);
  });

  it('accepts a custom URL', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ status: 'success', nodeResults: [] }) } as Response);
    const adapter = new HttpValidationRuntimeAdapter('/custom-validate');
    await adapter.run(workflow, { mode: 'sandbox' });
    expect(fetch).toHaveBeenCalledWith('/custom-validate', expect.anything());
  });

  it('throws a clear error, using the server-provided message, when the HTTP response is not ok', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'plugin crashed' }) } as Response);
    const adapter = new HttpValidationRuntimeAdapter();
    await expect(adapter.run(workflow, { mode: 'sandbox' })).rejects.toThrow('plugin crashed');
  });

  it('falls back to a status-based message when the error response has no body', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) } as Response);
    const adapter = new HttpValidationRuntimeAdapter();
    await expect(adapter.run(workflow, { mode: 'sandbox' })).rejects.toThrow(/500/);
  });
});
