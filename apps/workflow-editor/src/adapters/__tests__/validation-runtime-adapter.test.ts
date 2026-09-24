import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpValidationRuntimeAdapter } from '../validation-runtime-adapter';
import type { WorkflowDefinition } from '@runflux/workflow-model/types';

const workflow: WorkflowDefinition = { id: 'wf-1', name: 'Test workflow', nodes: [], connections: [] };

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
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ workflow, nodeId: 'n1', mode: 'production', cachedResults: [] }) }),
    );
    expect(result).toEqual(nodeResult);
  });

  it('runToNode() posts the workflow target and returns all results up to that node', async () => {
    const runResult = { status: 'success', nodeResults: [{ nodeId: 'n1', input: null, output: 'ok', error: null, startedAt: 't0', finishedAt: 't1' }] };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => runResult } as Response);

    const result = await new HttpValidationRuntimeAdapter().runToNode(workflow, 'n1', { mode: 'sandbox' });

    expect(fetch).toHaveBeenCalledWith(
      '/runflux-validate',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ workflow, untilNodeId: 'n1', mode: 'sandbox' }) }),
    );
    expect(result).toEqual(runResult);
  });

  it('runNode() sends the cached results of nodes tested earlier so upstream output is reused (RN-03)', async () => {
    const upstream = { nodeId: 'n0', input: null, output: { amount: 250 }, error: null, startedAt: 't0', finishedAt: 't1' };
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => upstream } as Response);

    await new HttpValidationRuntimeAdapter().runNode(workflow, 'n1', { mode: 'sandbox' }, [upstream]);

    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).cachedResults).toEqual([upstream]);
  });

  it('passes the abort signal to the request, so aborting cancels the run on the server', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ status: 'success', nodeResults: [] }) } as Response);
    const controller = new AbortController();
    const adapter = new HttpValidationRuntimeAdapter();
    await adapter.run(workflow, { mode: 'sandbox', signal: controller.signal });
    await adapter.runToNode(workflow, 'n1', { mode: 'sandbox', signal: controller.signal });
    await adapter.runNode(workflow, 'n1', { mode: 'sandbox', signal: controller.signal });
    expect(vi.mocked(fetch).mock.calls.map(([, init]) => init?.signal)).toEqual([controller.signal, controller.signal, controller.signal]);
  });

  it('sends the project variables of a run as its environment, and none when there are none', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ status: 'success', nodeResults: [] }) } as Response);
    const adapter = new HttpValidationRuntimeAdapter();
    await adapter.run(workflow, { mode: 'production', environment: { DATABASE_URL: 'postgres://db' } });
    await adapter.runNode(workflow, 'n1', { mode: 'sandbox', environment: { API_KEY: 'k' } });
    await adapter.run(workflow, { mode: 'sandbox' });
    const bodies = vi.mocked(fetch).mock.calls.map(([, init]) => JSON.parse(init!.body as string));
    expect(bodies.map((body) => body.environment)).toEqual([{ DATABASE_URL: 'postgres://db' }, { API_KEY: 'k' }, undefined]);
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
