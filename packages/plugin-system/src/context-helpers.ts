import type { PluginExecutionContext } from './types';

/**
 * Creates a safe Proxy wrapper around $node dictionaries.
 * Prevents throwing when user code accesses missing nodes ($node['Unknown'].json returns undefined).
 */
export function createSafeNodeProxy(
  nodeMap?: Record<string, { json?: unknown }> | Record<string, unknown> | null
): Record<string, { json?: unknown }> {
  const target = (nodeMap ?? {}) as Record<string, any>;
  return new Proxy(target, {
    get(obj, prop: string | symbol) {
      if (typeof prop === 'string') {
        if (prop in obj) {
          const entry = obj[prop];
          if (entry !== null && typeof entry === 'object' && 'json' in entry) {
            return entry;
          }
          return { json: entry };
        }
        return { json: undefined };
      }
      return undefined;
    },
  });
}

/**
 * Returns a safe environment variables dictionary from context or process.env.
 */
export function getSafeEnv(
  context?: PluginExecutionContext | { $env?: Record<string, string | undefined> } | null
): Record<string, string | undefined> {
  if (context && typeof context === 'object' && '$env' in context && context.$env) {
    return context.$env;
  }
  if (typeof process !== 'undefined' && process.env) {
    return process.env;
  }
  return {};
}

/**
 * Extracts and returns a safe $node proxy from an execution context.
 */
export function getSafeNode(
  context?: PluginExecutionContext | { $node?: Record<string, unknown> } | null
): Record<string, { json?: unknown }> {
  const rawNode = context && typeof context === 'object' && '$node' in context ? context.$node : undefined;
  return createSafeNodeProxy(rawNode as any);
}
