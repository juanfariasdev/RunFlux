import { defineNode, NodeOutput, type NodeDefinition } from '@runflux/runtime';
import type { DiscoveredPlugin, PluginManifest } from './types.js';

/** A node definition that passes its input through its main output. */
export const passThroughDefinition: NodeDefinition = defineNode({
  parseParameters: () => ({}),
  createHandler: () => ({ execute: ({ input }) => NodeOutput.main(input) }),
});

/**
 * A plugin ready to register, for tests: the manifest defaults to an action supporting the local
 * target, and the definition to one that passes its input through.
 */
export function testPlugin(manifest: Partial<PluginManifest> & Pick<PluginManifest, 'id'>, definition: NodeDefinition = passThroughDefinition): DiscoveredPlugin {
  return {
    manifest: { name: manifest.id, category: 'action', version: '1.0.0', parameters: [], supportedPlatforms: ['local'], ...manifest },
    runtimeModule: `memory:${manifest.id}`,
    definition,
    sourcePath: `/plugins/${manifest.id}`,
  };
}
