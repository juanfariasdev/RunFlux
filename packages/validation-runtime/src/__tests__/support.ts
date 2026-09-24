import { PluginRegistry } from '@runflux/plugin-system/plugin-registry';
import { testPlugin } from '@runflux/plugin-system/testing';
import type { DiscoveredPlugin, PluginManifest } from '@runflux/plugin-system/types';
import { defineNode, NodeOutput, type NodeContext } from '@runflux/runtime';

/**
 * A node behaviour written as a plain function of its parameters, input and context. A plugin
 * that declares named outputs returns `{ value, activeOutput }`; any other returns its value.
 */
export type TestBehaviour = (parameters: Readonly<Record<string, unknown>>, input: unknown, context: NodeContext) => unknown;

export function behaviourPlugin(manifest: Partial<PluginManifest> & Pick<PluginManifest, 'id'>, behaviour: TestBehaviour): DiscoveredPlugin {
  return testPlugin(manifest, defineNode({
    parseParameters: (parameters) => parameters.all(),
    createHandler: () => ({
      execute: async ({ parameters, input, context }) => {
        const result = await behaviour(parameters, input, context);
        if (!manifest.outputs) return NodeOutput.main(result);
        const { value, activeOutput } = result as { value: unknown; activeOutput: string | null };
        return NodeOutput.route(value, activeOutput);
      },
    }),
  }));
}

export function registryWith(...plugins: DiscoveredPlugin[]): PluginRegistry {
  const registry = new PluginRegistry();
  for (const plugin of plugins) registry.register(plugin);
  return registry;
}
