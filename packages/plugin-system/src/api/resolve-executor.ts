import type { PluginRegistry } from '../plugin-registry';
import type { ExecutorFn } from '../types';

/**
 * Resolves the local executor for a plugin id (003-validation-runtime, D-04).
 * Mirrors `resolveGenerator`'s thin-wrapper shape, but never throws: returns
 * `undefined` for both an unknown plugin id and a plugin without `execute`,
 * leaving it to the caller (the validation engine) to turn that into a
 * per-node error result instead of aborting the whole run.
 */
export function resolveExecutor(registry: PluginRegistry, pluginId: string): ExecutorFn | undefined {
  return registry.getExecutor(pluginId);
}
