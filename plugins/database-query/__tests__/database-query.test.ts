import { describe, it, expect } from 'vitest';
import { manifest, execute } from '../index.js';

describe('database-query plugin (012-database-query-plugin)', () => {
  it('exports a compliant manifest', () => {
    expect(manifest.id).toBe('database-query');
    expect(manifest.category).toBe('action');
    expect(manifest.version).toBe('1.0.0');
    expect(manifest.supportedPlatforms).toContain('local');
    expect(manifest.supportedPlatforms).toContain('aws');

    const paramNames = manifest.parameters.map((p) => p.name);
    expect(paramNames).toContain('databaseType');
    expect(paramNames).toContain('connectionEnvVar');
    expect(paramNames).toContain('query');
    expect(paramNames).toContain('outputMode');
  });

  it('executes query in "all" mode returning an array of records', async () => {
    const input = { orderId: 'ord-999', amount: 150 };
    const result = await execute!(
      { query: 'SELECT * FROM orders WHERE id = $1', outputMode: 'all' },
      input,
      {} as any
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect((result as any[])[0]).toMatchObject({
      orderId: 'ord-999',
      amount: 150,
      query_executed: 'SELECT * FROM orders WHERE id = $1',
      success: true,
    });
  });

  it('executes query in "first" mode returning a single object', async () => {
    const input = { userId: 'usr-101' };
    const result = await execute!(
      { query: 'SELECT * FROM users WHERE id = $1', outputMode: 'first' },
      input,
      {} as any
    );

    expect(Array.isArray(result)).toBe(false);
    expect(result).toMatchObject({
      userId: 'usr-101',
      query_executed: 'SELECT * FROM users WHERE id = $1',
      success: true,
    });
  });
});
