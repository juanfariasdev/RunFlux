import type { NodeDefinition } from '../contracts/node.js';

/** Finds the runtime definition of a node type. */
export interface NodeCatalog {
  resolve(pluginId: string): NodeDefinition | undefined;
}

/** A catalog over a fixed set of definitions, keyed by plugin id. */
export class StaticNodeCatalog implements NodeCatalog {
  private readonly definitions: Readonly<Record<string, NodeDefinition>>;

  constructor(definitions: Readonly<Record<string, NodeDefinition>>) {
    this.definitions = definitions;
  }

  resolve(pluginId: string): NodeDefinition | undefined {
    return Object.hasOwn(this.definitions, pluginId) ? this.definitions[pluginId] : undefined;
  }
}
