import { describe, expect, it } from 'vitest';
import { evaluateExpression } from '../evaluate-expression';
import { resolveExpressions } from '../resolve-expressions';

describe('global-context: $node and $env (009-expression-global-context)', () => {
  it('evaluates $node references by node label and ID', () => {
    const context = {
      $json: { current: 'item' },
      $node: {
        'Webhook Trigger': { json: { id: 123, email: 'user@example.com' } },
        'node-1': { json: { id: 123, email: 'user@example.com' } },
        'Compute Total': { json: { total: 450.5 } },
      },
    };

    expect(evaluateExpression("$node['Webhook Trigger'].json.id", context)).toBe(123);
    expect(evaluateExpression("$node['node-1'].json.email", context)).toBe('user@example.com');
    expect(evaluateExpression("$node['Compute Total'].json.total * 2", context)).toBe(901);
  });

  it('evaluates $env references', () => {
    const context = {
      $json: {},
      $env: {
        API_KEY: 'secret-1234',
        ENDPOINT: 'https://api.runflux.dev',
      },
    };

    expect(evaluateExpression('$env.API_KEY', context)).toBe('secret-1234');
    expect(evaluateExpression('$env.ENDPOINT', context)).toBe('https://api.runflux.dev');
  });

  it('resolves templated strings with both $node and $json and $env', () => {
    const context = {
      $json: { orderId: 'ord-999' },
      $node: {
        'Auth Node': { json: { token: 'jwt-abc' } },
      },
      $env: {
        HOST: 'gateway.runflux.internal',
      },
    };

    const params = {
      url: 'https://{{ $env.HOST }}/orders/{{ $json.orderId }}',
      auth: 'Bearer {{ $node[\'Auth Node\'].json.token }}',
    };

    const resolved = resolveExpressions(params, context);
    expect(resolved.url).toBe('https://gateway.runflux.internal/orders/ord-999');
    expect(resolved.auth).toBe('Bearer jwt-abc');
  });

  it('returns undefined gracefully for non-executed nodes without crashing', () => {
    const context = {
      $json: {},
      $node: {},
    };

    // When accessing an unexecuted node or node with no output
    expect(evaluateExpression("$node['Unexecuted Node']?.json?.field", context)).toBeUndefined();
    expect(evaluateExpression("$node['Unexecuted Node'].json", context)).toBeUndefined();
  });
});
