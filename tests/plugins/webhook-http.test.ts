import { createServer as createViteServer } from 'vite';
import request from 'supertest';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { runfluxValidationPlugin } from '../../apps/workflow-editor/vite-plugin-validation-runtime';
import { createServer } from '../../apps/project-server/src/server';
import { execute, clearPendingWebhooks } from '../../plugins/trigger-webhook/index';
import { context } from './helpers';

it.each(['editor', 'server'])('%s delivers test webhooks only to the requested endpoint', async (target) => {
  vi.stubEnv('RUNFLUX_WAIT_WEBHOOK_TEST', '1');
  const vite = target === 'editor' ? await createViteServer({
    configFile: false, server: { middlewareMode: true },
    plugins: [runfluxValidationPlugin([])],
  }) : undefined;
  const app = vite?.middlewares ?? createServer();
  if (target === 'server') vi.spyOn(process, 'cwd').mockReturnValue(resolve('apps/project-server'));
  const pending = Promise.resolve(execute!({ path: '/orders' }, undefined, context));
  const observed = pending.catch((error) => error);
  try {
    const unrelated = await request(app).post('/api/webhooks/test/unrelated').send({ wrong: true });
    expect(unrelated.status).toBe(200);
    expect(unrelated.body.captured).toBe(false);
    const matching = await request(app).post('/api/webhooks/test/orders?source=test').send({ id: 42 });
    expect(matching.status).toBe(200);
    expect(matching.body.captured).toBe(true);
    await expect(pending).resolves.toMatchObject({ value: { id: 42, _query: { source: 'test' } }, activeOutput: 'main' });
  } finally {
    clearPendingWebhooks();
    await observed;
    await vite?.close();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  }
});
