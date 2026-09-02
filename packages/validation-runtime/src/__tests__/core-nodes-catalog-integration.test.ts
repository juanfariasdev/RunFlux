import { PluginRegistry } from '@runflux/plugin-system/plugin-registry';
import type { DiscoveredPlugin } from '@runflux/plugin-system/types';
import type { WorkflowDefinition } from '@runflux/workflow-model/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as conditionIf from '@runflux/plugin-condition-if';
import * as httpOutput from '@runflux/plugin-http-output';
import * as setPlugin from '@runflux/plugin-set';
import { runWorkflow } from '../engine';

/**
 * End-to-end coverage of the 3 acceptance scenarios in
 * `requirements.md#7` (004-core-nodes-catalog), against the *real* plugins —
 * not stand-ins — wired through the actual validation engine.
 */
function triggerPlugin(): DiscoveredPlugin {
  return {
    manifest: { id: 'trigger', name: 'Trigger', category: 'trigger', version: '1.0.0', parameters: [], supportedPlatforms: ['local'] },
    generators: { local: () => ({ files: [], infra: [] }) },
    execute: (params) => params.seed,
    sourcePath: '/plugins/trigger',
  };
}

function registryWithRealPlugins(): PluginRegistry {
  const registry = new PluginRegistry();
  registry.register(triggerPlugin());
  registry.register({ manifest: conditionIf.manifest, generators: conditionIf.generators, execute: conditionIf.execute, sourcePath: '/plugins/condition-if' });
  registry.register({ manifest: setPlugin.manifest, generators: setPlugin.generators, execute: setPlugin.execute, sourcePath: '/plugins/set' });
  registry.register({ manifest: httpOutput.manifest, generators: httpOutput.generators, execute: httpOutput.execute, sourcePath: '/plugins/http-output' });
  return registry;
}

describe('core-nodes-catalog acceptance scenarios (004-core-nodes-catalog, requirements.md#7)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('scenario 1: trigger → condition-if (true) → http-output fires the configured HTTP call', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'content-type': 'application/json' } }));

    const wf: WorkflowDefinition = {
      id: 'wf-scenario-1',
      name: 'Scenario 1',
      nodes: [
        { id: 'trigger', pluginId: 'trigger', pluginVersion: '1.0.0', parameters: { seed: { label: 'go' } }, position: { x: 0, y: 0 } },
        {
          id: 'if',
          pluginId: 'condition-if',
          pluginVersion: '1.0.0',
          parameters: { combinator: 'and', conditions: [{ leftValue: '{{ $json.label }}', operator: 'equals', rightValue: 'go' }] },
          position: { x: 0, y: 0 },
        },
        {
          id: 'http',
          pluginId: 'http-output',
          pluginVersion: '1.0.0',
          parameters: { method: 'POST', url: 'https://example.com/hook', headers: {}, body: { ok: true } },
          position: { x: 0, y: 0 },
        },
      ],
      connections: [
        { sourceNodeId: 'trigger', sourceOutput: 'main', targetNodeId: 'if', targetInput: 'main' },
        { sourceNodeId: 'if', sourceOutput: 'true', targetNodeId: 'http', targetInput: 'main' },
      ],
    };

    const run = await runWorkflow(wf, registryWithRealPlugins(), { mode: 'sandbox' });

    expect(run.nodeResults.find((r) => r.nodeId === 'if')).toMatchObject({ error: null });
    const httpResult = run.nodeResults.find((r) => r.nodeId === 'http');
    expect(httpResult).toMatchObject({ error: null, output: { status: 200, body: { received: true } } });
    expect(fetch).toHaveBeenCalledWith('https://example.com/hook', expect.objectContaining({ method: 'POST' }));
  });

  it('scenario 2: a non-matching condition resolves "false" — http-output (wired to "true") never runs, no error', async () => {
    const wf: WorkflowDefinition = {
      id: 'wf-scenario-2',
      name: 'Scenario 2',
      nodes: [
        { id: 'trigger', pluginId: 'trigger', pluginVersion: '1.0.0', parameters: { seed: { label: 'stop' } }, position: { x: 0, y: 0 } },
        {
          id: 'if',
          pluginId: 'condition-if',
          pluginVersion: '1.0.0',
          parameters: { combinator: 'and', conditions: [{ leftValue: '{{ $json.label }}', operator: 'equals', rightValue: 'go' }] },
          position: { x: 0, y: 0 },
        },
        {
          id: 'http',
          pluginId: 'http-output',
          pluginVersion: '1.0.0',
          parameters: { method: 'POST', url: 'https://example.com/hook', headers: {}, body: {} },
          position: { x: 0, y: 0 },
        },
      ],
      connections: [
        { sourceNodeId: 'trigger', sourceOutput: 'main', targetNodeId: 'if', targetInput: 'main' },
        { sourceNodeId: 'if', sourceOutput: 'true', targetNodeId: 'http', targetInput: 'main' },
      ],
    };

    const run = await runWorkflow(wf, registryWithRealPlugins(), { mode: 'sandbox' });

    expect(run.status).toBe('success');
    expect(run.nodeResults.map((r) => r.nodeId)).toEqual(['trigger', 'if']);
    expect(run.nodeResults.find((r) => r.nodeId === 'http')).toBeUndefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('scenario 3: set molds the data before condition-if evaluates it against the transformed object, not the trigger\'s original output', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));

    const wf: WorkflowDefinition = {
      id: 'wf-scenario-3',
      name: 'Scenario 3',
      nodes: [
        { id: 'trigger', pluginId: 'trigger', pluginVersion: '1.0.0', parameters: { seed: { label: 'ready', unrelated: 'noise' } }, position: { x: 0, y: 0 } },
        {
          id: 'set',
          pluginId: 'set',
          pluginVersion: '1.0.0',
          parameters: { fields: [{ name: 'status', value: '{{ $json.label }}' }], includeOtherFields: false },
          position: { x: 0, y: 0 },
        },
        {
          id: 'if',
          pluginId: 'condition-if',
          pluginVersion: '1.0.0',
          parameters: { combinator: 'and', conditions: [{ leftValue: '{{ $json.status }}', operator: 'equals', rightValue: 'ready' }] },
          position: { x: 0, y: 0 },
        },
        {
          id: 'http',
          pluginId: 'http-output',
          pluginVersion: '1.0.0',
          parameters: { method: 'GET', url: 'https://example.com/hook', headers: {}, body: {} },
          position: { x: 0, y: 0 },
        },
      ],
      connections: [
        { sourceNodeId: 'trigger', sourceOutput: 'main', targetNodeId: 'set', targetInput: 'main' },
        { sourceNodeId: 'set', sourceOutput: 'main', targetNodeId: 'if', targetInput: 'main' },
        { sourceNodeId: 'if', sourceOutput: 'true', targetNodeId: 'http', targetInput: 'main' },
      ],
    };

    const run = await runWorkflow(wf, registryWithRealPlugins(), { mode: 'sandbox' });

    expect(run.nodeResults.find((r) => r.nodeId === 'set')).toMatchObject({ output: { status: 'ready' }, error: null });
    expect(run.nodeResults.find((r) => r.nodeId === 'if')).toMatchObject({
      input: { status: 'ready' },
      error: null,
    });
    expect(run.nodeResults.find((r) => r.nodeId === 'http')).toMatchObject({ error: null });
  });
});
