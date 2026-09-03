import { describe, it, expect } from 'vitest';
import { manifest, execute } from '../index';

const testContext = {
  workflowId: 'wf-test',
  nodeId: 'node-cron',
  mode: 'sandbox' as const,
};

describe('trigger-cron plugin', () => {
  it('defines valid manifest metadata', () => {
    expect(manifest.id).toBe('trigger-cron');
    expect(manifest.category).toBe('trigger');
    expect(manifest.supportedPlatforms).toContain('local');
    expect(manifest.supportedPlatforms).toContain('aws');
    expect(manifest.parameters.some((p) => p.name === 'expression')).toBe(true);
    expect(manifest.parameters.some((p) => p.name === 'timezone')).toBe(true);
  });

  it('executes in sandbox and returns structured cron payload', () => {
    expect(execute).toBeDefined();
    const result = execute!({ expression: '0 0 * * *', timezone: 'America/New_York' }, { previous: 123 }, testContext);
    expect(result).toHaveProperty('triggeredAt');
    expect(result).toHaveProperty('cronExpression', '0 0 * * *');
    expect(result).toHaveProperty('timezone', 'America/New_York');
    expect(result).toHaveProperty('previous', 123);
  });

  it('applies fallback defaults when params are omitted', () => {
    expect(execute).toBeDefined();
    const result = execute!({}, {}, testContext);
    expect(result).toHaveProperty('cronExpression', '*/15 * * * *');
    expect(result).toHaveProperty('timezone', 'UTC');
  });
});
