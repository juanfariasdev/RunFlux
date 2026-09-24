import type { NodeDefinition } from '../contracts/node.js';

/** Finds the runtime definition of a node type. */
export interface NodeCatalog {
  resolve(pluginId: string): NodeDefinition | undefined;
}

/** A catalog over a fixed set of definitions, keyed by plugin id. */
export class StaticNodeCatalog implements NodeCatalog {
  constructor(private readonly definitions: Readonly<Record<string, NodeDefinition>>) {}

  resolve(pluginId: string): NodeDefinition | undefined {
    return Object.hasOwn(this.definitions, pluginId) ? this.definitions[pluginId] : undefined;
  }
}
