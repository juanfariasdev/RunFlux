import { describe, it, expect, afterEach } from 'vitest';
import { manifest, execute, pushTestWebhook, clearPendingWebhooks } from '../index.js';

const testContext = {
  workflowId: 'wf-test',
  nodeId: 'node-webhook',
  mode: 'sandbox' as const,
};

describe('trigger-webhook plugin', () => {
  afterEach(() => {
    clearPendingWebhooks();
    delete process.env.RUNFLUX_WAIT_WEBHOOK_TEST;
  });

  it('defines valid manifest metadata', () => {
    expect(manifest.id).toBe('trigger-webhook');
    expect(manifest.category).toBe('trigger');
    expect(manifest.supportedPlatforms).toContain('local');
    expect(manifest.supportedPlatforms).toContain('aws');
    expect(manifest.parameters.some((p) => p.name === 'path')).toBe(true);
    expect(manifest.parameters.some((p) => p.name === 'httpMethod')).toBe(true);
    expect(manifest.parameters.some((p) => p.name === 'auth')).toBe(true);
  });

  it('executes in test mode returning sample simulation body by default', async () => {
    expect(execute).toBeDefined();
    const result = await execute!({ path: '/orders', httpMethod: 'POST', sampleBody: { id: 42 } }, {}, testContext);
    expect(result).toHaveProperty('path', '/orders');
    expect(result).toHaveProperty('method', 'POST');
    expect(result).toHaveProperty('body', { id: 42 });
    expect(result).toHaveProperty('receivedAt');
  });

  it('preserves real input data when passed from an actual HTTP caller', async () => {
    expect(execute).toBeDefined();
    const realInput = {
      body: { customer: 'Alice' },
      headers: { authorization: 'Bearer 123' },
      query: { filter: 'active' },
    };
    const result = await execute!({ path: '/hook' }, realInput, testContext);
    expect(result).toHaveProperty('body', { customer: 'Alice' });
    expect(result).toHaveProperty('headers', { authorization: 'Bearer 123' });
    expect(result).toHaveProperty('query', { filter: 'active' });
  });

  it('waits for incoming webhook when active and resolves via pushTestWebhook', async () => {
    process.env.RUNFLUX_WAIT_WEBHOOK_TEST = 'true';

    const testPromise = execute!({ path: '/test-event', httpMethod: 'POST' }, {}, testContext);

    // Simulate incoming HTTP webhook call after 50ms
    setTimeout(() => {
      const delivered = pushTestWebhook('/test-event', {
        body: { paymentId: 'pay-999', amount: 150 },
        headers: { 'x-event': 'payment.succeeded' },
        query: { live: 'false' },
        method: 'POST',
      });
      expect(delivered).toBe(true);
    }, 50);

    const result = (await testPromise) as any;
    expect(result.path).toBe('/test-event');
    expect(result.body).toEqual({ paymentId: 'pay-999', amount: 150 });
    expect(result.headers['x-event']).toBe('payment.succeeded');
    expect(result.query.live).toBe('false');
  });
});
