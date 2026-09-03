import { describe, it, expect } from 'vitest';
import { manifest, execute } from '../index';

const testContext = {
  workflowId: 'wf-test',
  nodeId: 'node-webhook',
  mode: 'sandbox' as const,
};

describe('trigger-webhook plugin', () => {
  it('defines valid manifest metadata', () => {
    expect(manifest.id).toBe('trigger-webhook');
    expect(manifest.category).toBe('trigger');
    expect(manifest.supportedPlatforms).toContain('local');
    expect(manifest.supportedPlatforms).toContain('aws');
    expect(manifest.parameters.some((p) => p.name === 'path')).toBe(true);
    expect(manifest.parameters.some((p) => p.name === 'httpMethod')).toBe(true);
    expect(manifest.parameters.some((p) => p.name === 'auth')).toBe(true);
  });

  it('executes in sandbox returning sample simulation body by default', () => {
    expect(execute).toBeDefined();
    const result = execute!({ path: '/orders', httpMethod: 'POST', sampleBody: { id: 42 } }, {}, testContext);
    expect(result).toHaveProperty('path', '/orders');
    expect(result).toHaveProperty('method', 'POST');
    expect(result).toHaveProperty('body', { id: 42 });
    expect(result).toHaveProperty('receivedAt');
  });

  it('preserves real input data when passed from an actual HTTP caller', () => {
    expect(execute).toBeDefined();
    const realInput = {
      body: { customer: 'Alice' },
      headers: { authorization: 'Bearer 123' },
      query: { filter: 'active' },
    };
    const result = execute!({ path: '/hook' }, realInput, testContext);
    expect(result).toHaveProperty('body', { customer: 'Alice' });
    expect(result).toHaveProperty('headers', { authorization: 'Bearer 123' });
    expect(result).toHaveProperty('query', { filter: 'active' });
  });
});
