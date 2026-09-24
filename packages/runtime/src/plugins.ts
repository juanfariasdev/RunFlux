import type { NodeDefinition } from './contracts/node.js';

/**
 * The node types available to an exported backend, by plugin id.
 *
 * Empty in the RunFlux repository: when a workflow is compiled, the runtime bundler replaces this
 * module with the definitions of the plugins that workflow uses.
 */
export const plugins: Readonly<Record<string, NodeDefinition>> = {};
