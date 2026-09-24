import { expect, it, vi } from 'vitest';
import { execute, pushTestWebhook, clearPendingWebhooks } from '../../plugins/trigger-webhook/index';
import { context } from './helpers';

it('delivers interactive webhook requests only to the matching endpoint', async () => {
  vi.stubEnv('RUNFLUX_WAIT_WEBHOOK_TEST', '1');
  const pending = Promise.resolve(execute!({ path: '/orders' }, undefined, context));
  const settled = pending.catch((error) => error);
  try {
    expect(pushTestWebhook('/unrelated', { body: { wrong: true } })).toBe(false);
    expect(pushTestWebhook('/orders', { body: { id: 42 } })).toBe(true);
    await expect(pending).resolves.toMatchObject({ value: { id: 42 }, activeOutput: 'main' });
  } finally {
    clearPendingWebhooks();
    await settled;
    vi.unstubAllEnvs();
  }
});

it('does not register a listener after its workflow was already cancelled', async () => {
  vi.stubEnv('RUNFLUX_WAIT_WEBHOOK_TEST', '1');
  const controller = new AbortController();
  controller.abort();
  const pending = Promise.resolve(execute!({ path: '/cancelled' }, undefined, { ...context, signal: controller.signal }));
  const observed = pending.catch((error) => error);
  try {
    const result = await Promise.race([observed, new Promise((resolve) => setTimeout(() => resolve('still waiting'), 0))]);
    expect(result).toBeInstanceOf(Error);
    expect(pushTestWebhook('/cancelled', { body: {} })).toBe(false);
  } finally { clearPendingWebhooks(); await observed; vi.unstubAllEnvs(); }
});
