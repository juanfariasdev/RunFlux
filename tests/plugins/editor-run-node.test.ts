import { createServer as createViteServer } from 'vite';
import request from 'supertest';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { PluginRegistryCache } from '../../apps/workflow-editor/vite-plugin-registry';
import { runfluxValidationPlugin } from '../../apps/workflow-editor/vite-plugin-validation-runtime';

const node = (id: string, pluginId: string, parameters: Record<string, unknown>) => ({ id, pluginId, pluginVersion: '1.0.0', parameters, position: { x: 0, y: 0 } });
const workflow = {
  id: 'wf', name: 'Test single node',
  nodes: [
    node('enrich', 'set', { fields: [{ name: 'amount', value: 250, type: 'number' }] }),
    node('big', 'condition-if', { conditions: [{ leftValue: '{{ $json.amount }}', operator: 'greaterThan', rightValue: 100 }] }),
  ],
  connections: [{ sourceNodeId: 'enrich', sourceOutput: 'main', targetNodeId: 'big', targetInput: 'main' }],
};

it('tests a single node in the editor with the output of an upstream node tested earlier', async () => {
  const vite = await createViteServer({ configFile: false, server: { middlewareMode: true }, plugins: [runfluxValidationPlugin(new PluginRegistryCache([resolve('plugins')]))] });
  try {
    const upstream = await request(vite.middlewares).post('/runflux-validate').send({ workflow, nodeId: 'enrich', mode: 'sandbox' });
    expect(upstream.body).toMatchObject({ output: { amount: 250 }, error: null });
    const target = await request(vite.middlewares).post('/runflux-validate').send({ workflow, nodeId: 'big', mode: 'sandbox', cachedResults: [upstream.body] });
    expect(target.body).toMatchObject({ input: { amount: 250 }, error: null });
  } finally {
    await vite.close();
  }
});
