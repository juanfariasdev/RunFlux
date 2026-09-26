/**
 * Version of the contract between this runtime and the node handlers it runs: `NodeDefinition`,
 * `NodeHandler`, `NodeOutput` and `RuntimeServices`. A minor version adds to it; a major version
 * breaks it. Every compiled backend records it in `runflux-build.json`.
 */
export const RUNTIME_CONTRACT_VERSION = '1.1.0';
