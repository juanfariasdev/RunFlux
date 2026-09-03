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
    expect(manifest.parameters.some((p) => p.name === 'authentication')).toBe(true);
    expect(manifest.parameters.some((p) => p.name === 'rawBody')).toBe(true);
  });

  // manifest.outputs is declared (['main']), so validation-runtime's engine (executeNode,
  // packages/validation-runtime/src/engine.ts) reads `raw.value`/`raw.activeOutput` off
  // whatever execute() returns — a plugin that forgets this wrapper silently collapses to
  // `output: null` for every real run, even though execute() itself "succeeded" (a bug this
  // plugin actually shipped with). Every case below asserts the wrapper, not just the payload.

  it('passes incoming body fields directly forward in output', async () => {
    expect(execute).toBeDefined();
    const result = (await execute!(
      { path: '/orders', httpMethod: 'POST', sampleBody: { id: 42, customer: 'Alice' } },
      {},
      testContext
    )) as any;
    expect(result.activeOutput).toBe('main');
    expect(result.value.id).toBe(42);
    expect(result.value.customer).toBe('Alice');
    expect(result.value._headers).toBeDefined();
  });

  it('composes an array-of-fields sampleBody (rowSchema shape) into the flat simulated body', async () => {
    expect(execute).toBeDefined();
    const result = (await execute!(
      {
        path: '/orders',
        httpMethod: 'POST',
        sampleBody: [
          { name: 'id', value: 42, type: 'number' },
          { name: 'customer', value: 'Alice', type: 'string' },
        ],
      },
      {},
      testContext
    )) as any;
    expect(result.activeOutput).toBe('main');
    expect(result.value.id).toBe(42);
    expect(result.value.customer).toBe('Alice');
    expect(result.value._headers).toBeDefined();
  });

  it('preserves real input data when passed from an actual HTTP caller', async () => {
    expect(execute).toBeDefined();
    const realInput = {
      body: { customer: 'Alice', total: 99 },
      headers: { authorization: 'Bearer 123' },
      query: { filter: 'active' },
    };
    const result = (await execute!({ path: '/hook' }, realInput, testContext)) as any;
    expect(result.activeOutput).toBe('main');
    expect(result.value.customer).toBe('Alice');
    expect(result.value.total).toBe(99);
    expect(result.value._headers.authorization).toBe('Bearer 123');
    expect(result.value._query.filter).toBe('active');
  });

  it('waits for incoming webhook when active and resolves body directly', async () => {
    process.env.RUNFLUX_WAIT_WEBHOOK_TEST = 'true';

    const testPromise = execute!({ path: '/test-event', httpMethod: 'POST' }, {}, testContext);

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
    expect(result.activeOutput).toBe('main');
    expect(result.value.paymentId).toBe('pay-999');
    expect(result.value.amount).toBe(150);
    expect(result.value._headers['x-event']).toBe('payment.succeeded');
    expect(result.value._query.live).toBe('false');
  });
});
