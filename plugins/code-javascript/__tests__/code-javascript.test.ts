import { describe, expect, it } from 'vitest';
import { execute, manifest } from '../index';

const testContext = { workflowId: 'wf-1', nodeId: 'n1', mode: 'sandbox' as const };

describe('code-javascript plugin (010-code-node-plugin)', () => {
  it('declares a valid manifest with category "action"', () => {
    expect(manifest.id).toBe('code-javascript');
    expect(manifest.name).toBe('Code');
    expect(manifest.category).toBe('action');
    expect(manifest.supportedPlatforms).toContain('local');
    expect(manifest.supportedPlatforms).toContain('aws');
    const codeParam = manifest.parameters.find((p) => p.name === 'code');
    expect(codeParam).toBeDefined();
    expect(codeParam?.type).toBe('string');
    expect(codeParam?.required).toBe(true);
  });

  it('executes user JavaScript returning transformed $json synchronously', async () => {
    const code = `
      return {
        total: $json.items.reduce((acc, item) => acc + item.price, 0),
        count: $json.items.length
      };
    `;
    const input = { items: [{ price: 10 }, { price: 25 }] };
    const result = await execute!({ code }, input, testContext);

    expect(result).toEqual({ total: 35, count: 2 });
  });

  it('supports async functions and Promise resolutions', async () => {
    const code = `
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      await delay(5);
      return { asyncWorked: true, upper: $json.name.toUpperCase() };
    `;
    const input = { name: 'runflux' };
    const result = await execute!({ code }, input, testContext);

    expect(result).toEqual({ asyncWorked: true, upper: 'RUNFLUX' });
  });

  it('accesses $node and $env in the execution context', async () => {
    const code = `
      return {
        fromTrigger: $node['Webhook']?.json?.userId,
        apiKey: $env.TEST_API_KEY,
        current: $json.item
      };
    `;
    const input = { item: 'sample' };
    const context = {
      ...testContext,
      $node: {
        Webhook: { json: { userId: 'usr-888' } },
      },
      $env: {
        TEST_API_KEY: 'secret-xyz',
      },
    };

    const result = await execute!({ code }, input, context);
    expect(result).toEqual({
      fromTrigger: 'usr-888',
      apiKey: 'secret-xyz',
      current: 'sample',
    });
  });

  it('throws friendly descriptive errors on runtime exceptions', async () => {
    const code = `
      $json.missing.deepProp;
      return $json;
    `;
    await expect(execute!({ code }, {}, testContext)).rejects.toThrow(/\[code-javascript\]/);
  });

  it('returns $json unchanged when code is empty or fallback', async () => {
    const input = { status: 'pass' };
    const result = await execute!({ code: '' }, input, testContext);
    expect(result).toEqual({ status: 'pass' });
  });
});
