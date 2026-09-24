import { describe, it, expect } from 'vitest';
import {
  evaluateExpression,
  resolveValue,
  resolveTemplateObject,
} from '../evaluator';

describe('Standardized Evaluator (TDD)', () => {
  describe('evaluateExpression', () => {
    it('evaluates $json references correctly', () => {
      const res = evaluateExpression('$json.user.name', {
        $json: { user: { name: 'Alice' } },
      });
      expect(res).toBe('Alice');
    });

    it('evaluates $node references via safe proxy', () => {
      const res = evaluateExpression('$node["Trigger"].json.orderId', {
        $node: { Trigger: { json: { orderId: 999 } } },
      });
      expect(res).toBe(999);
    });

    it('accessing missing $node returns undefined instead of throwing', () => {
      const res = evaluateExpression('$node["Missing"].json?.field ?? "fallback"', {
        $node: {},
      });
      expect(res).toBe('fallback');
    });

    it('evaluates $env variables', () => {
      const res = evaluateExpression('$env.APP_NAME', {
        $env: { APP_NAME: 'RunFluxApp' },
      });
      expect(res).toBe('RunFluxApp');
    });
  });

  describe('resolveValue', () => {
    it('evaluates whole-string expressions returning raw type (number, boolean, object)', () => {
      expect(resolveValue('{{ $json.count }}', { $json: { count: 42 } })).toBe(42);
      expect(resolveValue('{{ $json.active }}', { $json: { active: true } })).toBe(true);
      expect(resolveValue('{{ $json.user }}', { $json: { user: { id: 1 } } })).toEqual({ id: 1 });
    });

    it('interpolates embedded expressions within string', () => {
      const res = resolveValue('Hello, {{ $json.name }}! Welcome to {{ $env.PLATFORM }}.', {
        $json: { name: 'Bob' },
        $env: { PLATFORM: 'Cloud' },
      });
      expect(res).toBe('Hello, Bob! Welcome to Cloud.');
    });

    it('passes literal non-string values through unchanged', () => {
      expect(resolveValue(123)).toBe(123);
      expect(resolveValue(true)).toBe(true);
      expect(resolveValue(null)).toBeNull();
      expect(resolveValue(undefined)).toBeUndefined();
    });

    it('recursively resolves arrays and objects', () => {
      const template = {
        title: 'Report for {{ $json.client }}',
        tags: ['tag1', '{{ $env.ENV_TAG }}'],
        details: {
          total: '{{ $json.amount * 2 }}',
          nested: { flag: '{{ $json.ok }}' },
        },
      };

      const resolved = resolveValue(template, {
        $json: { client: 'Acme Corp', amount: 50, ok: true },
        $env: { ENV_TAG: 'production' },
      }) as any;

      expect(resolved.title).toBe('Report for Acme Corp');
      expect(resolved.tags).toEqual(['tag1', 'production']);
      expect(resolved.details.total).toBe(100);
      expect(resolved.details.nested.flag).toBe(true);
    });
  });

  describe('resolveTemplateObject', () => {
    it('resolves an entire template parameters record', () => {
      const params = {
        url: 'https://api.example.com/items/{{ $json.id }}',
        auth: 'Bearer {{ $env.API_KEY }}',
        count: '{{ $json.items.length }}',
      };
      const result = resolveTemplateObject(params, {
        $json: { id: 'item_456', items: [1, 2, 3] },
        $env: { API_KEY: 'token_abc' },
      });
      expect(result).toEqual({
        url: 'https://api.example.com/items/item_456',
        auth: 'Bearer token_abc',
        count: 3,
      });
    });
  });
});
