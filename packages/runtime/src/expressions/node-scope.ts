import type { NodeOutputs } from '../contracts/node.js';

/**
 * `$node` as expressions and code see it: reading a node that did not run yields
 * `{ json: undefined }` instead of throwing, and a plain value is exposed as `{ json: value }`.
 */
export function createNodeScope(outputs?: Readonly<Record<string, unknown>> | null): NodeOutputs {
  return new Proxy(outputs ?? {}, {
    get(target, property) {
      if (typeof property !== 'string') return undefined;
      if (!Object.hasOwn(target, property)) return { json: undefined };
      const entry = (target as Record<string, unknown>)[property];
      return isNodeEntry(entry) ? entry : { json: entry };
    },
  }) as NodeOutputs;
}

function isNodeEntry(value: unknown): value is { json: unknown } {
  return value !== null && typeof value === 'object' && 'json' in value;
}
