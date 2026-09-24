import { describe, it, expect } from 'vitest';
import {
  getSafeEnv,
  getSafeNode,
  createSafeNodeProxy,
} from '../context-helpers';

describe('Context Helpers (TDD)', () => {
  describe('getSafeEnv', () => {
    it('returns $env when provided in context', () => {
      const env = { API_KEY: 'secret123', BASE_URL: 'https://api.test' };
      expect(getSafeEnv({ $env: env })).toEqual(env);
    });

    it('falls back to process.env when $env is not provided', () => {
      const env = getSafeEnv({});
      expect(typeof env).toBe('object');
      expect(env).toBeDefined();
    });

    it('returns empty object safely if context is null or undefined', () => {
      const env = getSafeEnv(undefined);
      expect(typeof env).toBe('object');
    });
  });

  describe('createSafeNodeProxy & getSafeNode', () => {
    it('provides existing node outputs via $node["Name"].json', () => {
      const nodes = {
        'Webhook Trigger': { json: { id: 123, email: 'test@example.com' } },
        'Simple Node': { value: 'plain' },
      };
      const proxy = createSafeNodeProxy(nodes);

      expect(proxy['Webhook Trigger'].json).toEqual({ id: 123, email: 'test@example.com' });
      // When node output doesn't wrap in .json, it safely normalizes or exposes it
      expect(proxy['Simple Node']).toBeDefined();
    });

    it('returns { json: undefined } for nonexistent nodes without throwing', () => {
      const proxy = createSafeNodeProxy({});
      expect(proxy['Nonexistent Node']).toEqual({ json: undefined });
      expect(proxy['Nonexistent Node'].json).toBeUndefined();
    });

    it('getSafeNode extracts from context safely', () => {
      const context = {
        $node: {
          FetchUsers: { json: [{ id: 1 }] },
        },
      };
      const safeNode = getSafeNode(context);
      expect(safeNode['FetchUsers'].json).toEqual([{ id: 1 }]);
      expect(safeNode['MissingNode'].json).toBeUndefined();
    });
  });
});
